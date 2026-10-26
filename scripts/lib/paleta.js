/**
 * Núcleo das ferramentas de contraste: cores, WCAG e a resolução dos tokens.
 *
 * Os tokens são lidos de snippets/css-variables.liquid — a MESMA regra que a loja
 * usa —, então nada aqui duplica a lógica de herança ("em branco usa a Cor
 * Principal" etc.).
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const strip = (t) => t.replace(/^\/\*[\s\S]*?\*\/\s*/, '');

// ── cores ────────────────────────────────────────────────────────────────────
function hex(c) {
  const s = String(c).trim().toLowerCase();
  const m = s.match(/^#([0-9a-f]{3,8})$/);
  if (!m) throw new Error('cor inválida: ' + c);
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}
/** fg (com alpha) composto sobre bg opaco */
const sobre = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
});
const lum = ({ r, g, b }) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const razao = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ── paleta ───────────────────────────────────────────────────────────────────
/**
 * Paleta pedida = padrões do schema + SÓ a paleta (não herda valores soltos do
 * editor, senão uma cor de teste esquecida no settings_data contaminaria a
 * medição). Sem paleta: padrões + settings_data.json (o que está salvo no editor).
 */
function carregar(arqPaleta) {
  const schema = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config/settings_schema.json'), 'utf8'));
  const settings = {};
  for (const g of schema) for (const s of g.settings || []) if (s.id && s.default !== undefined) settings[s.id] = s.default;
  let nome = 'salva hoje no editor (settings_data.json)';
  if (arqPaleta) {
    const p = JSON.parse(strip(fs.readFileSync(path.resolve(arqPaleta), 'utf8')));
    Object.assign(settings, p.cores || p);
    nome = p.nome || path.basename(arqPaleta);
  } else {
    Object.assign(settings, JSON.parse(strip(fs.readFileSync(path.join(RAIZ, 'config/settings_data.json'), 'utf8'))).current);
  }

  const fonte = fs.readFileSync(path.join(RAIZ, 'snippets/css-variables.liquid'), 'utf8');
  const bruto = {};
  for (const m of fonte.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) bruto[m[1]] = m[2].trim();

  const valorSetting = (n) => { const v = settings[n]; return v === undefined || v === null || v === '' ? null : String(v); };
  // {% if escuro %}A{% else %}B{% endif %} → A no modo escuro, B no claro (como o css-variables.liquid faz)
  const escuro = valorSetting('modo_cores') === 'escuro';
  const modo = (e) => e.replace(/\{%\s*if escuro\s*%\}([\s\S]*?)\{%\s*else\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g, (m, a, b) => (escuro ? a : b)).trim();
  function resolver(expr, pilha) {
    expr = modo(expr);
    const m = expr.match(/^\{\{\s*settings\.(\w+)\s*(?:\|\s*default:\s*(?:'([^']*)'|settings\.(\w+)))?\s*\}\}$/);
    if (m) return valorSetting(m[1]) ?? (m[2] !== undefined ? m[2] : m[3] ? valorSetting(m[3]) : null);
    if (/^#[0-9a-f]{3,8}$/i.test(expr)) return expr;
    const v = expr.match(/^var\((--[\w-]+)\)$/);
    if (v && !pilha.includes(v[1])) return token(v[1], [...pilha, v[1]]);
    return null;
  }
  function token(n, pilha = []) { return bruto[n] === undefined ? null : resolver(bruto[n], pilha); }
  const T = (n) => { const v = token(n); if (!v) throw new Error('token sem valor: ' + n); return hex(v); };
  return { settings, nome, token, T, valorSetting };
}

module.exports = { RAIZ, strip, hex, sobre, lum, razao, carregar };
