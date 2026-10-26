#!/usr/bin/env node
/**
 * Contraste lido do CSS REAL do tema (sem lista de pares curada à mão).
 *
 * Para cada regra CSS que define `color` e um fundo juntos, resolve as duas cores
 * com a paleta pedida e mede o contraste. É o que o PageSpeed/Lighthouse faz, só
 * que sem precisar publicar o tema.
 *
 *   node scripts/contraste-css.js config/paletas/black-november.json
 *   node scripts/contraste-css.js config/paletas/black-november.json --base config/paletas/loja-clara.json
 *        → mostra só o que reprova na paleta e NÃO reprovava na base (o que o tema escuro quebrou)
 *   node scripts/contraste-css.js <paleta> --tudo      → também as que passam
 *
 * O QUE ESTE SCRIPT NÃO SABE:
 *  · o tamanho do texto: trata tudo como texto normal (4,5:1). Texto grande e ícones
 *    pedem só 3:1, então uma reprovação entre 3 e 4,5 pode ser falso alarme — confira.
 *  · regra com `color` mas sem fundo na mesma regra (herda o fundo do pai) é ignorada;
 *  · fundo translúcido é composto sobre o Fundo da página;
 *  · imagens, vídeos e cores escolhidas dentro de seções do Personalizar.
 */
const fs = require('fs');
const path = require('path');
const { RAIZ, hex, sobre, razao, carregar } = require('./lib/paleta');

const args = process.argv.slice(2);
const val = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : null; };
const arqBase = val('--base');
const tudo = args.includes('--tudo');
const arqPaleta = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--base');

// ── arquivos com CSS do tema ─────────────────────────────────────────────────
const ARQUIVOS = ['assets/critical.css'];
for (const d of ['sections', 'snippets', 'blocks']) for (const f of fs.readdirSync(path.join(RAIZ, d))) if (f.endsWith('.liquid')) ARQUIVOS.push(`${d}/${f}`);
// páginas com identidade própria (variáveis --atl-*/--eb-*) são medidas pelo contraste.js
const IGNORAR = new Set(['sections/atelier-coleira.liquid', 'sections/collection-esquenta-black.liquid']);

// Texto sobre foto/vídeo: o fundo real é uma imagem, que este script não enxerga.
const SOBRE_FOTO = /(banner|hero|lightbox|vs-modal|collist__card|col-banner|story__|__video|overlay|lookbook|depoimentos__bg)/i;
// Onde um fundo TRANSLÚCIDO se apoia (em vez da página): o container da regra.
function apoio(sel, P, pagina) {
  const t = (n) => { try { return P.T(n); } catch { return pagina; } };
  if (/\.ame-footer/.test(sel)) return t('--color-footer-bg');
  if (/\.ame-newsletter/.test(sel)) return t('--color-primary');
  if (/\.ame-announce/.test(sel)) return t('--color-announce-bg');
  if (/\.ame-cart-(drawer|item|totals|crosssell|freight|shipping|empty|gift)|\.ame-gift-/.test(sel)) return t('--color-cart-bg');
  return pagina;
}

// ── resolução de uma expressão de cor ────────────────────────────────────────
function criar(P) {
  const pagina = P.T('--color-background');
  function cor(expr, prof = 0) {
    if (!expr || prof > 8) return null;
    let e = expr.trim().replace(/\s*!important$/, '');
    // {{ block.settings.x | default: 'var(--token)' }} → o token (campo em branco)
    e = e.replace(/\{\{[^}]*\|\s*default:\s*'(var\([^']*\))'\s*\}\}/g, '$1');
    if (/\{\{|\{%/.test(e)) return null;
    if (/^(transparent|inherit|currentcolor|initial|unset|none)$/i.test(e)) return null;
    let m;
    if ((m = e.match(/^#[0-9a-f]{3,8}$/i))) return hex(e);
    if ((m = e.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/))) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    if ((m = e.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/))) {
      const t = P.token(m[1]);
      if (t) return hex(t);
      if (/^--(atl|eb|ame|pdp-btn|cashback)/.test(m[1]) && !m[2]) return null;
      return m[2] ? cor(m[2], prof + 1) : null;     // variável de seção/bloco: usa o fallback, se houver
    }
    if ((m = e.match(/^color-mix\(\s*in srgb\s*,\s*([\s\S]+?)\s+([\d.]+)%\s*,\s*(transparent|#[0-9a-f]{3,8})\s*\)$/i))) {
      const a = cor(m[1], prof + 1); if (!a) return null;
      if (m[3].toLowerCase() === 'transparent') return { ...a, a: a.a * (+m[2] / 100) };
      const b = hex(m[3]); const k = +m[2] / 100;
      return { r: a.r * k + b.r * (1 - k), g: a.g * k + b.g * (1 - k), b: a.b * k + b.b * (1 - k), a: 1 };
    }
    return null;
  }
  /** todas as cores sólidas de um `background` (gradientes: cada parada) */
  function fundos(valor) {
    const v = valor.trim();
    if (/^(none|transparent)$/i.test(v)) return [];
    if (/gradient\(/i.test(v)) {
      const miolo = v.slice(v.indexOf('(') + 1, v.lastIndexOf(')'));
      const partes = []; let nivel = 0, atual = '';
      for (const ch of miolo) { if (ch === '(') nivel++; if (ch === ')') nivel--; if (ch === ',' && !nivel) { partes.push(atual); atual = ''; } else atual += ch; }
      partes.push(atual);
      return partes.map((p) => p.trim().replace(/\s+[\d.]+%$/, '')).map((p) => cor(p)).filter(Boolean);
    }
    if (/url\(|image-set\(/i.test(v)) return [];
    // shorthand "red url(...) no-repeat": pega o primeiro token que é cor
    const c = cor(v) || cor(v.split(/\s+(?![^(]*\))/)[0]);
    return c ? [c] : [];
  }
  return { cor, fundos, pagina };
}

// ── varredura ────────────────────────────────────────────────────────────────
function achados(P) {
  const { cor, fundos, pagina } = criar(P);
  const out = [];
  for (const rel of ARQUIVOS) {
    if (IGNORAR.has(rel)) continue;
    let t = fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
    if (rel.endsWith('.liquid')) t = t.split('{% schema %}')[0];
    t = t.replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /([^{}]+)\{([^{}]*)\}/g; let m;
    while ((m = re.exec(t))) {
      const sel = m[1].trim().replace(/\s+/g, ' ');
      if (sel.startsWith('@') || /^\d+%|^(from|to)\b/.test(sel) || SOBRE_FOTO.test(sel)) continue;
      const decl = {};
      for (const d of m[2].split(';')) { const i = d.indexOf(':'); if (i > 0) decl[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim(); }
      if (!decl.color || !(decl.background || decl['background-color'])) continue;
      const fg = cor(decl.color);
      const bgs = fundos(decl['background-color'] || decl.background);
      if (!fg || !bgs.length) continue;
      const linha = t.slice(0, m.index + m[1].length).split('\n').length;
      let pior = Infinity;
      for (const bg of bgs) {
        const base = sobre(bg, apoio(sel, P, pagina));
        pior = Math.min(pior, razao(sobre(fg, base), base));
      }
      out.push({ arq: rel, linha, sel: sel.split(',').pop().trim().slice(0, 70), r: pior, chave: rel + '|' + sel });
    }
  }
  return out;
}

const P = carregar(arqPaleta);
const rel = achados(P);
const reprovadas = rel.filter((x) => x.r < 4.5 - 1e-9);
let mostrar = tudo ? rel : reprovadas;
let titulo = '';
if (arqBase) {
  const B = carregar(arqBase);
  const baseRuins = new Set(achados(B).filter((x) => x.r < 4.5 - 1e-9).map((x) => x.chave));
  const novas = reprovadas.filter((x) => !baseRuins.has(x.chave));
  titulo = `\n  Reprovam em "${P.nome}" e passavam em "${B.nome}": ${novas.length}   (já reprovavam antes: ${reprovadas.length - novas.length})`;
  mostrar = tudo ? rel : novas;
}
console.log(`\nContraste lido do CSS — paleta: ${P.nome}\n  ${rel.length} regras com texto e fundo medidas; ${reprovadas.length} abaixo de 4,5:1.${titulo}\n`);
const ordem = [...mostrar].sort((a, b) => a.r - b.r);
for (const x of ordem) console.log(`  ${x.r >= 4.5 - 1e-9 ? '✓' : x.r >= 3 ? '~' : '✗'} ${x.r.toFixed(2).padStart(5)}:1  ${x.arq}:${x.linha}  ${x.sel}`);
console.log('\n  ✗ abaixo de 3:1 (reprova até como texto grande)   ~ entre 3 e 4,5 (reprova texto normal; ok se for texto grande/ícone)');
process.exit(!arqBase && reprovadas.length ? 1 : (arqBase && mostrar.length ? 1 : 0));
