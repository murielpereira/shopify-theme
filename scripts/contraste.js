#!/usr/bin/env node
/**
 * Confere o contraste (WCAG / PageSpeed Insights) dos pares texto × fundo que o
 * tema realmente usa, para uma paleta.
 *
 *   node scripts/contraste.js                      → a paleta salva hoje no editor (settings_data.json)
 *   node scripts/contraste.js config/paletas/black-november.json
 *                                                  → padrões do schema + SÓ essa paleta (não mistura com o editor)
 *   node scripts/contraste.js <paleta> --so-falhas → só o que reprova
 *
 * Como funciona: lê os tokens de snippets/css-variables.liquid (a mesma regra que
 * a loja usa — nada é duplicado aqui), aplica por cima os padrões do schema, o
 * settings_data.json e a paleta pedida, e mede cada par da lista PARES.
 *
 * Critério: texto normal 4,5:1 (AA). O PSI/Lighthouse reprova abaixo disso, exceto
 * texto grande (≥24px, ou ≥18,66px em negrito), que pede 3:1 — marcado `grande`.
 * Sai com código 1 se algum par reprovar, para poder ir num CI.
 *
 * LIMITES (o que este script NÃO enxerga): texto sobre FOTO, cores escolhidas dentro
 * de seções/blocos no Personalizar e o que o app da Konfidency/Shopify pinta. Para
 * isso, rode o PSI na loja de verdade.
 */
const { hex, sobre, razao, carregar } = require('./lib/paleta');

const args = process.argv.slice(2);
const soFalhas = args.includes('--so-falhas');
const arqPaleta = args.find((a) => !a.startsWith('--'));

// Paleta + tokens (lidos de snippets/css-variables.liquid, respeitando o Modo de cores)
const { settings, nome: nomePaleta, token, T, valorSetting } = carregar(arqPaleta);
const modoEscuro = valorSetting('modo_cores') === 'escuro';

// ── pares (fg, fundo). `a` = opacidade do texto; `sobre` = fundo translúcido sobre outra cor ─────────
const PAGINA = '--color-background';
const P = (grupo, nome, fg, bg, extra = {}) => ({ grupo, nome, fg, bg, ...extra });
const PARES = [
  ...[['página', '--color-background'], ['campos/janelas', '--color-surface-container-lowest'], ['cartões', '--color-surface-container'], ['chips', '--color-surface-container-high'], ['atrás das fotos', '--color-surface-container-highest']]
    .flatMap(([n, bg]) => [
      P('Texto', `Texto principal sobre ${n}`, '--color-on-background', bg),
      P('Texto', `Texto secundário sobre ${n}`, '--color-on-surface-variant', bg),
      P('Texto', `Texto discreto sobre ${n}`, '--color-on-surface-muted', bg),
    ]),
  P('Cor Principal', 'Cor Principal (links, preços) sobre a página', '--color-primary', PAGINA),
  P('Cor Principal', 'Cor Principal sobre campos/janelas', '--color-primary', '--color-surface-container-lowest'),
  P('Cor Principal', 'Cor Principal sobre cartões', '--color-primary', '--color-surface-container'),
  P('Cor Principal', 'Variação da Cor Principal (títulos dos blocos) sobre a página', '--color-primary-container', PAGINA),
  P('Cor Principal', 'Variação da Cor Principal sobre campos/janelas', '--color-primary-container', '--color-surface-container-lowest'),
  P('Botões', 'Texto sobre a Cor Principal (botões, chips)', '--color-on-primary', '--color-primary'),
  P('Botões', 'Texto sobre a variação (ponta do degradê "Finalizar compra")', '--color-on-primary', '--color-primary-container'),
  P('Botões', 'Botão de compra: texto sobre fundo', '--pdp-btn-fg', '--pdp-btn-bg'),
  P('Botões', 'Botão "Buscar": texto sobre fundo', '--color-btn-primary-text', '--color-btn-primary-bg'),
  P('Botões', 'Selo "esgotado": texto sobre fundo', '--color-on-primary', '--color-on-background'),
  P('Botões', 'Botão "Esgotado": texto sobre cinza neutro', '--color-on-primary', '--color-outline'),
  P('Cabeçalho', 'Logo/ícones sobre o cabeçalho (rolado)', '--color-header-icons', '--color-header-bg', { sobre: [PAGINA, 0.88] }),
  P('Cabeçalho', 'Links do menu sobre a barra de menu', '--color-header-link', '--color-header-bg', { sobre: [PAGINA, 0.82] }),
  P('Cabeçalho', 'Link do menu (mouse/ativo) sobre a barra de menu', '--color-header-link-hover', '--color-header-bg', { sobre: [PAGINA, 0.82] }),
  P('Barra de anúncios', 'Texto sobre fundo', '--color-announce-text', '--color-announce-bg'),
  P('Rodapé', 'Texto principal sobre o rodapé', '--color-footer-text', '--color-footer-bg'),
  P('Rodapé', 'Links do rodapé (85%) sobre o rodapé', '--color-footer-text', '--color-footer-bg', { a: 0.85 }),
  P('Rodapé', 'Texto secundário do rodapé (70%) sobre o rodapé', '--color-footer-text', '--color-footer-bg', { a: 0.7 }),
  P('Carrinho', 'Texto sobre a gaveta', '--color-on-background', '--color-cart-bg'),
  P('Carrinho', 'Texto secundário sobre a gaveta', '--color-on-surface-variant', '--color-cart-bg'),
  P('Carrinho', 'Texto discreto sobre a gaveta', '--color-on-surface-muted', '--color-cart-bg'),
  P('Carrinho', 'Cor Principal (total) sobre a gaveta', '--color-primary', '--color-cart-bg'),
  P('Selos', 'Texto sobre selo verde', '--color-on-accent', '--color-accent-green'),
  P('Selos', 'Texto sobre selo azul', '--color-on-accent', '--color-accent-blue'),
  P('Selos', 'Texto sobre selo dourado (ponta escura)', '--color-on-gold', '--color-gold'),
  P('Selos', 'Texto sobre selo dourado (ponta clara)', '--color-on-gold', '--color-gold-light'),
  P('Selos', 'Verde (texto de destaque) sobre campos/janelas', '--color-accent-green', '--color-surface-container-lowest'),
  P('Mensagens', 'Vermelho de erro sobre a página', '--color-error', PAGINA),
  P('Mensagens', 'Vermelho de erro sobre campos/janelas', '--color-error', '--color-surface-container-lowest'),
  P('Mensagens', 'Vermelho de erro sobre a gaveta', '--color-error', '--color-cart-bg'),
  P('Mensagens', 'Verde de desconto sobre a gaveta', '--color-success', '--color-cart-bg'),
  P('Mensagens', 'Etiqueta "mais barato"', '--color-success', '--color-success-bg'),
  P('Mensagens', 'Etiqueta "mais rápido"', '--color-info', '--color-info-bg'),
  P('Mensagens', 'Aviso de frete: ícone/link sobre o fundo do aviso', '--color-notice-text', '--color-surface-container', { sobre: [PAGINA, 0.6] }),
  P('Mensagens', 'Aviso de frete: texto sobre o fundo do aviso', '--color-on-surface-variant', '--color-surface-container', { sobre: [PAGINA, 0.6] }),
];

// Esquenta Black e Ateliê: variáveis próprias do bloco, derivadas das configurações
function paletaEsquenta() {
  const tema = !!settings.eb_usar_tema_geral || modoEscuro;
  const g = (k, fallback) => valorSetting(k) ?? fallback;
  return tema
    ? { bg: token('--color-background'), fg: token('--color-on-background'), lime: token('--color-primary'), onLime: token('--color-on-primary'), sec: token('--color-surface-container') }
    : { bg: g('eb_bg', '#0a0a0a'), fg: g('eb_fg', '#ffffff'), lime: g('eb_lime', '#c1ff72'), onLime: g('eb_on_lime', '#0f0f0f'), sec: g('eb_secondary', '#1f1f1f') };
}
function paletaAtelie() {
  const g = (k, tk) => (modoEscuro ? null : valorSetting(k)) ?? token(tk);
  return { papel: g('atl_papel', '--color-background'), couro: g('atl_couro', '--color-primary'), tinta: g('atl_tinta', '--color-on-background'), tinta2: g('atl_tinta_2', '--color-on-surface-variant'), areia: g('atl_areia', '--color-surface-container') };
}

// ── executa ──────────────────────────────────────────────────────────────────
const linhas = [];
function medir(grupo, nome, fg, bg, { a = 1, minimo = 4.5, grande = false } = {}) {
  const min = grande ? 3 : minimo;
  const f = { ...fg, a: (fg.a ?? 1) * a };
  const r = razao(sobre(f, bg), bg);
  linhas.push({ grupo, nome, r, min, ok: r >= min - 1e-9 });
}
for (const p of PARES) {
  let fundo = T(p.bg);
  if (p.sobre) { const [base, al] = p.sobre; fundo = sobre({ ...fundo, a: al }, T(base)); }
  medir(p.grupo, p.nome, T(p.fg), fundo, { a: p.a });
}
const eb = paletaEsquenta();
if (eb.bg) {
  const B = hex(eb.bg), F = hex(eb.fg);
  medir('Esquenta Black', 'Texto sobre o fundo', F, B);
  medir('Esquenta Black', 'Texto 70% sobre o fundo', F, B, { a: 0.7 });
    medir('Esquenta Black', 'Texto 55% sobre o fundo (rótulos, item esgotado)', F, B, { a: 0.55 });
  medir('Esquenta Black', 'Destaque sobre o fundo (títulos, contador)', hex(eb.lime), B);
  medir('Esquenta Black', 'Texto sobre o destaque (faixa, selos, abas)', hex(eb.onLime), hex(eb.lime));
  medir('Esquenta Black', 'Texto sobre o fundo das fotos dos kits', F, hex(eb.sec));
}
const at = paletaAtelie();
medir('Ateliê', 'Texto principal sobre o fundo', hex(at.tinta), hex(at.papel));
medir('Ateliê', 'Texto secundário sobre o fundo', hex(at.tinta2), hex(at.papel));
medir('Ateliê', 'Texto secundário sobre a areia (cartões)', hex(at.tinta2), hex(at.areia));
medir('Ateliê', 'Couro (links, botões) sobre o fundo', hex(at.couro), hex(at.papel));

// ── saída ────────────────────────────────────────────────────────────────────
const falhas = linhas.filter((l) => !l.ok);
console.log(`\nContraste da paleta: ${nomePaleta}   (mínimo AA: 4,5:1)\n`);
let grupo = '';
for (const l of linhas) {
  if (soFalhas && l.ok) continue;
  if (l.grupo !== grupo) { grupo = l.grupo; console.log(`\n  ${grupo}`); }
  console.log(`    ${l.ok ? '✓' : '✗'} ${l.r.toFixed(2).padStart(5)}:1  ${l.nome}${l.ok ? '' : `   ← precisa ${l.min}:1`}`);
}
console.log(`\n${linhas.length - falhas.length}/${linhas.length} pares passam.${falhas.length ? `  ${falhas.length} reprovam.` : '  Tudo certo.'}`);
process.exit(falhas.length ? 1 : 0);
