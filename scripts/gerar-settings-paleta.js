#!/usr/bin/env node
/**
 * Gera um settings_data.json COMPLETO com uma paleta aplicada, sem tocar no atual.
 *
 *   node scripts/gerar-settings-paleta.js config/paletas/black-november.json
 *   node scripts/gerar-settings-paleta.js <paleta> --saida config/settings_data.escuro.json
 *
 * O que faz:
 *  1. parte do config/settings_data.json de hoje (conteúdo, seções, blocos e as
 *     configurações que NÃO são cor ficam como estão);
 *  2. zera TODAS as configurações de cor do schema (cor esquecida de teste não
 *     vaza para o tema novo) e aplica só o que a paleta define — o resto cai no
 *     padrão do schema, que é o valor original da loja;
 *  3. confere que toda chave da paleta existe no schema e é uma cor válida;
 *  4. grava em outro arquivo e imprime o que mudou.
 *
 * Este script NÃO publica nada. Para usar o resultado, veja README em
 * config/paletas/LEIA-ME.md.
 */
const fs = require('fs');
const path = require('path');
const { RAIZ, strip } = require('./lib/paleta');

const args = process.argv.slice(2);
const iSaida = args.indexOf('--saida');
const arqPaleta = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--saida');
if (!arqPaleta) { console.error('uso: node scripts/gerar-settings-paleta.js <paleta.json> [--saida arquivo]'); process.exit(2); }

const paleta = JSON.parse(strip(fs.readFileSync(path.resolve(arqPaleta), 'utf8')));
const cores = paleta.cores || paleta;
const schema = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config/settings_schema.json'), 'utf8'));
const defs = {};
for (const g of schema) for (const s of g.settings || []) if (s.id) defs[s.id] = s;

// 3) validação
const erros = [];
for (const [k, v] of Object.entries(cores)) {
  const d = defs[k];
  if (!d) { erros.push(`"${k}" não existe no schema`); continue; }
  if (d.type === 'color' && !/^#[0-9a-f]{6}$/i.test(String(v))) erros.push(`"${k}": "${v}" não é uma cor #rrggbb`);
  if (d.type === 'checkbox' && typeof v !== 'boolean') erros.push(`"${k}": precisa ser true/false`);
  if (d.type === 'select' && !(d.options || []).some((o) => o.value === v)) erros.push(`"${k}": "${v}" não é uma opção (${(d.options || []).map((o) => o.value).join(', ')})`);
}
if (erros.length) { console.error('Paleta inválida:\n  ' + erros.join('\n  ')); process.exit(1); }

// 1 e 2) base = settings de hoje, sem nenhuma cor
const arqAtual = path.join(RAIZ, 'config/settings_data.json');
const bruto = fs.readFileSync(arqAtual, 'utf8');
const m = bruto.match(/^\/\*[\s\S]*?\*\/\s*/);
const cabecalho = m ? m[0] : '';
const eol = bruto.includes('\r\n') ? '\r\n' : '\n';
const dados = JSON.parse(bruto.slice(cabecalho.length));
const corIds = new Set(Object.values(defs).filter((s) => s.type === 'color').map((s) => s.id));
// chaves antigas de cor que saíram do schema também não devem sobrar
const ANTIGAS = ['color_secondary', 'color_secondary_container'];
const removidas = [];
for (const k of Object.keys(dados.current)) if (corIds.has(k) || ANTIGAS.includes(k)) { removidas.push(k); delete dados.current[k]; }
Object.assign(dados.current, cores);

const saida = iSaida >= 0 ? args[iSaida + 1] : `config/settings_data.${path.basename(arqPaleta, '.json')}.json`;
fs.writeFileSync(path.resolve(RAIZ, saida), (cabecalho + JSON.stringify(dados, null, 2)).replace(/\n/g, eol) + (/\n$/.test(bruto) ? eol : ''));
console.log(`\nGerado: ${saida}`);
console.log(`  ${removidas.length} cores do editor zeradas (voltam ao padrão do schema), ${Object.keys(cores).length} definidas pela paleta "${paleta.nome || arqPaleta}".`);
console.log('  O settings_data.json atual NÃO foi alterado.\n');
