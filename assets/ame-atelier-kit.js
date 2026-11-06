/* Âme — Ateliê do kit (peitoral + guia lado a lado).
 * Etapas: Cores -> Metal -> Tamanho -> Resumo (sem pingente).
 * Dados: Waltz /api/public/kit/<handle> (o mesmo do ame-kit.js): peças com
 * todas as variações e fotos, opções unificadas do kit e a tabela
 * bundle.variantes["Tamanho|Cor|Metal"] = { id, cheio, preco } (centavos).
 * Carrinho: UMA linha (variação do kit) com as mesmas propriedades ocultas
 * do ame-kit.js, para o carrinho e a folha de impressão do Waltz.
 */
(function () {
  'use strict';
  const root = document.querySelector('[data-akt]');
  if (!root || root.dataset.aktPronto) return;
  root.dataset.aktPronto = '1';

  const CFG = JSON.parse(root.querySelector('[data-akt-config]').textContent);
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => Array.from(root.querySelectorAll(s));
  const PASSOS = ['cores', 'metal', 'tamanho', 'resumo'];
  const PROXIMO = { cores: 'Escolher o metal', metal: 'Escolher o tamanho', tamanho: 'Ver o resumo', resumo: 'Adicionar ao carrinho' };

  const S = { passo: 'cores', base: null, cor: null, metal: null, tam: null, enviando: false, fase: null, porte: null, peso: '', raca: '' };
  let K = null, OP = null, FOTOS = [], TM = null;

  const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const slug = (t) => semAcento(t).toLowerCase().replace(/[^a-z0-9]/g, '');
  const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const urlFoto = (src, w) => {
    if (!src) return '';
    let u = String(src);
    if (u.startsWith('//')) u = 'https:' + u;
    u = u.replace(/([?&])width=\d+&?/, '$1').replace(/[?&]$/, '');
    return u + (u.includes('?') ? '&' : '?') + 'width=' + (w || 900);
  };
  const COR_FALLBACK = { allure: '#98aec0', azulbebe: '#b5c8c3', borgonha: '#782932', branco: '#f4f2ee', cafe: '#524033', camel: '#9d5a35', chiclete: '#fb88a3', lilascandy: '#bfb7bc', marinho: '#2f3d4f', militar: '#55574c', nude: '#c2a28c', offwhite: '#e6e1d6', preto: '#242424', rosabebe: '#e2b5a6', rosaseco: '#db9396', sepia: '#a6b3a5' };
  const fundoCor = (nome) => {
    const k = slug(nome);
    const tex = CFG.texturas && CFG.texturas[k];
    return tex ? 'url("' + tex + '") center / cover, ' + (COR_FALLBACK[k] || '#999') : (COR_FALLBACK[k] || '#999');
  };
  const DESCR_METAL = { ouro: 'Clássico e refinado', prata: 'Versátil e atemporal', rose: 'Delicado e romântico', grafite: 'Escuro e moderno' };
  const chaveMetal = (m) => {
    const n = slug(m);
    if (n.startsWith('ouro') || n.startsWith('dourad')) return 'ouro';
    if (n.startsWith('prat')) return 'prata';
    if (n.startsWith('rose') || n.startsWith('rosa')) return 'rose';
    if (n.startsWith('grafit') || n.startsWith('negr') || n.startsWith('pret')) return 'grafite';
    return 'ouro';
  };

  /* ---------- dados ---------- */
  function montarOpcoes(k) {
    const uo = k.unified_options || [];
    const achar = (re) => uo.find((o) => re.test(semAcento(o.name).toLowerCase()));
    return {
      tam: achar(/tamanho|comprimento/),
      cor: achar(/^cor$/) || achar(/^cor(?! do metal)/),
      metal: achar(/metal/),
    };
  }
  function idxOpcao(op, i) { return op && op.optIdxByComp ? op.optIdxByComp[i] : undefined; }
  function valorPeca(op, display, i) {
    const v = op && op.values.find((x) => x.display === display);
    return v && v.perComp ? v.perComp[i] : undefined;
  }
  function montarFotos(k) {
    return k.components.map((comp, i) => {
      const ic = idxOpcao(OP.cor, i), im = idxOpcao(OP.metal, i);
      const mapa = new Map(), porCor = new Map();
      comp.variants.forEach((v) => {
        if (!v.featured_image) return;
        const c = ic !== undefined ? v['option' + (ic + 1)] : '';
        const m = im !== undefined ? v['option' + (im + 1)] : '';
        const chave = c + '|' + m;
        if (!mapa.has(chave)) mapa.set(chave, v.featured_image);
        if (!porCor.has(c)) porCor.set(c, v.featured_image);
      });
      return { mapa, porCor, capa: comp.featured_image };
    });
  }
  function fotoPeca(i, cor, metal) {
    const f = FOTOS[i]; if (!f) return '';
    const c = valorPeca(OP.cor, cor, i), m = valorPeca(OP.metal, metal, i);
    return f.mapa.get(c + '|' + m) || f.porCor.get(c) || f.capa || '';
  }
  function varPeca(i, tam, cor, metal) {
    const comp = K.components[i];
    const alvo = {};
    [[OP.tam, tam], [OP.cor, cor], [OP.metal, metal]].forEach(([op, d]) => {
      const idx = idxOpcao(op, i);
      if (op && idx !== undefined && d) alvo['option' + (idx + 1)] = valorPeca(op, d, i);
    });
    return comp.variants.find((v) => Object.keys(alvo).every((k) => v[k] === alvo[k])) || null;
  }
  const bundle = (tam, cor, metal) => (K.bundle && K.bundle.variantes || {})[[tam, cor, metal].join('|')] || null;
  function menorPreco(filtro) {
    let melhor = null;
    Object.entries((K.bundle && K.bundle.variantes) || {}).forEach(([chave, b]) => {
      const [t, c, m] = chave.split('|');
      if (filtro && !filtro(t, c, m)) return;
      if (!melhor || b.preco < melhor.preco) melhor = b;
    });
    return melhor;
  }
  const nomePeca = (i) => {
    const t = String(K.components[i].title || '');
    const p = t.split('|');
    const tipo = p[0].replace(/de couro.*$/i, '').trim();
    return p[1] ? tipo + ' ' + p[1].trim() : t;
  };

  /* ---------- palco ---------- */
  function trocarImg(img, src) {
    if (!img || !src) return;
    const url = urlFoto(src, 900);
    if (img.dataset.src === url) return;
    img.dataset.src = url;
    img.classList.add('is-trocando');
    const pre = new Image();
    pre.onload = pre.onerror = () => { img.src = url; img.classList.remove('is-trocando'); };
    pre.src = url;
  }
  function corVisivel() { return S.cor || corPadrao(); }
  function metalVisivel() { return S.metal || metalPadrao(); }
  function corPadrao() {
    const vals = OP.cor.values.map((v) => v.display);
    return vals.find((v) => v === CFG.corInicial) || vals[0];
  }
  function metalPadrao() {
    const vals = OP.metal.values.map((v) => v.display);
    return vals.find((v) => slug(v) === slug(CFG.metalInicial)) || vals[0];
  }
  function atualizarPalco() {
    const cor = corVisivel(), metal = metalVisivel();
    [0, 1].forEach((i) => {
      trocarImg($('[data-akt-foto="' + i + '"]'), fotoPeca(i, cor, metal));
      const leg = $('[data-akt-legenda="' + i + '"]');
      if (leg) leg.textContent = nomePeca(i);
    });
    const partes = [cor, 'metal ' + metal];
    if (S.tam) partes.push('tamanho ' + S.tam);
    $('[data-akt-escolha]').textContent = partes.join(' · ');
  }

  /* ---------- etapas ---------- */
  function basesDeCor() {
    const ordem = [], grupos = new Map();
    OP.cor.values.forEach((v) => {
      const base = (v.perComp && v.perComp[0]) || v.display.split(' com ')[0];
      if (!grupos.has(base)) { grupos.set(base, []); ordem.push(base); }
      grupos.get(base).push(v.display);
    });
    return { ordem, grupos };
  }
  function renderCores() {
    const { ordem, grupos } = basesDeCor();
    const el = $('[data-akt-cores]');
    el.innerHTML = '';
    ordem.forEach((base) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'akt-cor';
      b.setAttribute('aria-pressed', String(S.base === base));
      b.innerHTML = '<i></i><span></span>';
      b.querySelector('i').style.background = fundoCor(base);
      b.querySelector('span').textContent = base;
      b.addEventListener('click', () => {
        S.base = base;
        const opcoes = grupos.get(base);
        if (!opcoes.includes(S.cor)) S.cor = opcoes.find((d) => d === base) || opcoes[0];
        renderCores(); atualizar();
      });
      el.appendChild(b);
    });
    const bloco = $('[data-akt-detalhe-bloco]');
    const ops = S.base ? grupos.get(S.base) : [];
    bloco.hidden = !(ops && ops.length > 1);
    const chips = $('[data-akt-detalhes]');
    chips.innerHTML = '';
    (ops || []).forEach((d) => {
      const detalhe = d === S.base ? 'Lisa, toda em ' + S.base : d.split(' com ').slice(1).join(' com ');
      const corChip = d === S.base ? S.base : d.split(' com ').slice(1).join(' com ');
      const c = document.createElement('button');
      c.type = 'button'; c.className = 'akt-chip';
      c.setAttribute('aria-pressed', String(S.cor === d));
      c.innerHTML = '<i></i><span></span>';
      c.querySelector('i').style.background = fundoCor(corChip);
      c.querySelector('span').textContent = detalhe;
      c.addEventListener('click', () => { S.cor = d; renderCores(); atualizar(); });
      chips.appendChild(c);
    });
  }
  function renderMetais() {
    const el = $('[data-akt-metais]');
    el.innerHTML = '';
    OP.metal.values.forEach((v) => {
      const k = chaveMetal(v.display);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'akt-metal akt-metal--' + k;
      b.setAttribute('aria-pressed', String(S.metal === v.display));
      b.innerHTML = '<i></i><span><b></b><small></small></span>';
      b.querySelector('b').textContent = v.display;
      b.querySelector('small').textContent = DESCR_METAL[k] || '';
      b.addEventListener('click', () => { S.metal = v.display; renderMetais(); atualizar(); });
      el.appendChild(b);
    });
  }
  function larguraGuia(tam) {
    const v = valorPeca(OP.tam, tam, 1) || '';
    const mm = v.match(/(\d+\s*mm)/i);
    return mm ? mm[1].replace(/\s+/g, '') : '';
  }
  const PORTES = [
    { id: 'micro', nome: 'Micro', faixa: 'até 2 kg', min: 0, max: 2.1, tam: 'XPP', esc: 0.55 },
    { id: 'mini', nome: 'Mini', faixa: '2,2 a 3,5 kg', min: 2.1, max: 3.9, tam: 'PP', esc: 0.65 },
    { id: 'pequeno', nome: 'Pequeno', faixa: '4 a 10 kg', min: 3.9, max: 10.5, tam: 'P', esc: 0.78 },
    { id: 'medio', nome: 'Médio', faixa: '11 a 22 kg', min: 10.5, max: 23, tam: 'M', esc: 0.9 },
    { id: 'grande', nome: 'Grande', faixa: '24 a 35 kg', min: 23, max: 999, tam: 'G', esc: 1 },
  ];
  const CAO = '<svg viewBox="0 0 40 28" aria-hidden="true"><path fill="currentColor" d="M33 4c-1.3 0-2.3.6-3 1.6L28.6 8H12c-2.4 0-4.4 1.6-5 3.8L5.2 9.6C4.7 9 3.8 9 3.3 9.6c-.4.5-.3 1.2.2 1.6l3 2.6V20l-1 6h3l1.6-5h11.4l1.6 5h3l-1-6.4c1.6-1 2.6-2.6 2.6-4.6v-2.6h2.8c1.8 0 3.2-1.4 3.2-3.2C36 6.4 34.6 4 33 4z"/></svg>';
  const num = (t) => { const n = parseFloat(String(t || '').replace(',', '.')); return isNaN(n) ? null : n; };
  const cm = (a, b) => { const f = (x) => String(Number(x)).replace('.', ','); return a != null && b != null && a !== 'null' && b !== 'null' ? f(a) + ' a ' + f(b) + ' cm' : ''; };
  const medidaDe = (tam) => (TM && TM.tabela && TM.tabela.medidas || []).find((m) => m.tamanho === tam) || null;
  function racasCao() { return (TM && TM.tabela && TM.tabela.racas || []).filter((r) => !r.especie || r.especie === 'cao'); }
  function recomendacao() {
    // Porte e peso mandam no tamanho (regra da Bia, 06/11/2026):
    // Micro = XPP, Mini = PP, Pequeno = P, Médio = M, Grande = G.
    // Com peso: se a raça tem faixas de peso no Waltz, vale o Waltz para aquele peso;
    // senão o peso define o porte. Sem porte nem peso, vale a raça.
    const fase = S.fase === 'filhote' ? 'Filhote' : 'Adulto';
    const peso = num(S.peso);
    const raca = racasCao().find((r) => r.nome_raca === S.raca);
    const existe = (t) => OP.tam.values.some((v) => v.display === t);
    const pelaRaca = () => {
      if (!raca || !raca.variacoes || !raca.variacoes.length) return null;
      const vs = raca.variacoes.filter((v) => !v.fase || v.fase === fase);
      const lista = vs.length ? vs : raca.variacoes; if (peso == null && lista.filter((v) => v.peso_min != null || v.peso_max != null).length > 1 && !lista.some((v) => v.peso_min == null && v.peso_max == null)) return { precisaPeso: true };
      const porPeso = peso != null ? lista.find((v) => (v.peso_min == null || peso >= Number(v.peso_min)) && (v.peso_max == null || peso <= Number(v.peso_max)) && (v.peso_min != null || v.peso_max != null)) : null;
      const v = porPeso || lista[0];
      return v && v.tamanho_coleira ? { tam: v.tamanho_coleira, motivo: 'Para ' + raca.nome_raca + ' ' + fase.toLowerCase() + (porPeso ? ' de ' + String(peso).replace('.', ',') + ' kg' : '') + '.', porPeso: !!porPeso } : null;
    };
    if (peso != null) {
      const r = pelaRaca();
      if (r && r.porPeso && existe(r.tam)) return r;
      const p = portePorPeso(peso);
      if (existe(p.tam)) return { tam: p.tam, motivo: 'Para pet de ' + String(peso).replace('.', ',') + ' kg (porte ' + p.nome.toLowerCase() + ').' };
    }
    if (S.porte) {
      const p = PORTES.find((x) => x.id === S.porte);
      if (p && existe(p.tam)) return { tam: p.tam, motivo: 'Para porte ' + p.nome.toLowerCase() + ' (' + p.faixa + ').' };
    }
    const r = pelaRaca();
    if (r && r.precisaPeso) return { precisaPeso: true, motivo: 'O tamanho de ' + raca.nome_raca + ' varia com o peso. Informe o peso do seu pet no item "3 · Peso", acima.' }; return r && existe(r.tam) ? r : null;
  }
  function portePorPeso(kg) {
    if (kg <= 2) return PORTES[0];
    if (kg < 4) return PORTES[1];
    if (kg < 11) return PORTES[2];
    if (kg < 24) return PORTES[3];
    return PORTES[4];
  }
  function abrirGuia() {
    let m = root.querySelector('.akt-modal');
    if (!m) {
      m = document.createElement('div');
      m.className = 'akt-modal';
      m.innerHTML = '<div class="akt-modal__caixa" role="dialog" aria-modal="true" aria-label="Guia de medidas"><button type="button" class="akt-modal__fechar" aria-label="Fechar">×</button><div class="akt-modal__corpo"></div></div>';
      m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.akt-modal__fechar')) m.hidden = true; });
      root.appendChild(m);
    }
    const t = TM && TM.tabela;
    const meds = (t && t.medidas) || [];
    const cols = (t && t.colunas_custom) || [];
    let h = '<h3>Guia de medidas · ' + esc(nomePeca(0)) + '</h3>';
    if (t && t.observacao) h += '<p>' + esc(t.observacao) + '</p>';
    h += '<div class="akt-modal__tabela"><table><thead><tr><th>Tamanho</th><th>Tórax</th><th>Pescoço</th>' + cols.map((c) => '<th>' + esc(c.nome) + '</th>').join('') + '<th>Guia</th></tr></thead><tbody>';
    meds.forEach((md) => {
      h += '<tr><td><b>' + esc(md.tamanho) + '</b></td><td>' + (cm(md.torax_min, md.torax_max) || '—') + '</td><td>' + (cm(md.pescoco_min, md.pescoco_max) || '—') + '</td>' +
        cols.map((c) => '<td>' + esc((md.extras || {})[c.chave] || '—') + '</td>').join('') + '<td>' + (larguraGuia(md.tamanho) || '—') + '</td></tr>';
    });
    h += '</tbody></table></div><p class="akt-modal__dica">Meça o tórax logo atrás das patas da frente, com a fita métrica justa mas sem apertar. Ficou entre dois tamanhos? Escolha o maior.</p>';
    m.querySelector('.akt-modal__corpo').innerHTML = h;
    m.hidden = false;
  }
  function renderTamanhos() {
    const el = $('[data-akt-tamanhos]');
    const rec = recomendacao();
    const racas = racasCao();
    const video = TM && TM.config && (TM.config.video_url_peitoral || TM.config.video_url);
    let h = '';
    h += '<p class="akt-q">1 · Filhote ou adulto?</p><div class="akt-fases">' +
      ['filhote', 'adulto'].map((f) => '<button type="button" class="akt-fase" data-fase="' + f + '" aria-pressed="' + (S.fase === f) + '"><b>' + (f === 'filhote' ? 'Filhote' : 'Adulto') + '</b><small>' + (f === 'filhote' ? 'ainda vai crescer' : 'tamanho definitivo') + '</small></button>').join('') + '</div>';
    const pSel = PORTES.find((p) => p.id === S.porte);
    h += '<details class="akt-sanfona"' + (S.porte ? '' : ' open') + '><summary><span class="akt-q">2 · Porte</span>' + (pSel ? '<b>' + pSel.nome + ' · ' + pSel.faixa + '</b>' : '') + '</summary><div class="akt-portes">' +
      PORTES.map((p) => '<button type="button" class="akt-porte" data-porte="' + p.id + '" aria-pressed="' + (S.porte === p.id) + '"><i style="--esc:' + p.esc + '">' + CAO + '</i><span><b>' + p.nome + '</b><small>' + p.faixa + '</small></span></button>').join('') + '</div></details>';
    h += '<details class="akt-sanfona"' + (S.peso ? ' open' : '') + '><summary><span class="akt-q">3 · Peso</span><span class="akt-suave">' + (S.peso ? esc(S.peso) + ' kg' : 'opcional') + '</span></summary><label class="akt-campo"><input type="text" inputmode="decimal" placeholder="Ex.: 8,5" value="' + esc(S.peso) + '" data-akt-peso><span>kg</span></label></details>';
    h += '<details class="akt-sanfona"' + (S.raca ? '' : '') + '><summary><span class="akt-q">Raça</span>' + (S.raca ? '<b>' + esc(S.raca) + '</b>' : '<span class="akt-suave">opcional</span>') + '</summary><label class="akt-campo"><input type="text" list="akt-racas" placeholder="Digite a raça" value="' + esc(S.raca) + '" data-akt-raca></label><datalist id="akt-racas">' + racas.map((r) => '<option value="' + esc(r.nome_raca) + '">').join('') + '</datalist></details>';
    if (rec && rec.precisaPeso) h += '<div class="akt-reco"><p class="akt-reco__rot">Nossa recomendação</p><p>' + esc(rec.motivo) + '</p></div>'; else if (rec) {
      const md = medidaDe(rec.tam);
      h += '<div class="akt-reco"><p class="akt-reco__rot">Nossa recomendação</p><p class="akt-reco__tam">Tamanho ' + esc(rec.tam) + '</p>' +
        (md && cm(md.torax_min, md.torax_max) ? '<p>Para tórax de ' + cm(md.torax_min, md.torax_max) + '.</p>' : '') + '<p>' + esc(rec.motivo) + '</p>' +
        (S.fase === 'filhote' ? '<p class="akt-suave">Filhote ainda cresce: confira a medida do tórax e, se estiver no limite, escolha o tamanho acima.</p>' : '') + '</div>';
    }
    h += '<p class="akt-q akt-q--sep">Escolha o tamanho</p><div class="akt-guia-botoes"><button type="button" class="akt-btn akt-btn--claro" data-akt-guia>Guia de Medidas</button>' +
      (video ? '<a class="akt-btn akt-btn--contorno" href="' + esc(video) + '" target="_blank" rel="noopener">Como medir</a>' : '') + '</div>';
    h += '<div class="akt-tamanhos">';
    OP.tam.values.forEach((v) => {
      const bv = bundle(v.display, corVisivel(), metalVisivel());
      const md = medidaDe(v.display);
      const ind = rec && rec.tam === v.display;
      h += '<button type="button" class="akt-tam' + (ind ? ' is-indicado' : '') + '" data-tam="' + esc(v.display) + '" aria-pressed="' + (S.tam === v.display) + '"' + (bv ? '' : ' disabled') + '>' +
        (ind ? '<em>Indicado</em>' : '') + '<b>' + esc(v.display) + '</b><small>' + (md && md.torax_min ? 'tórax ' + String(Number(md.torax_min)).replace('.', ',') + '–' + String(Number(md.torax_max)).replace('.', ',') + ' cm' : '') + '</small><span>' + (bv ? brl(bv.preco) : 'indisponível') + '</span></button>';
    });
    h += '</div>';
    if (S.tam) {
      const md = medidaDe(S.tam), lg = larguraGuia(S.tam);
      const partes = [];
      if (md && cm(md.torax_min, md.torax_max)) partes.push('Tórax de ' + cm(md.torax_min, md.torax_max));
      if (md && cm(md.pescoco_min, md.pescoco_max)) partes.push('pescoço de ' + cm(md.pescoco_min, md.pescoco_max));
      if (lg) partes.push('guia de ' + lg);
      if (partes.length) h += '<p class="akt-tam-info">' + partes.join(' · ') + '.</p>';
    }
    el.innerHTML = h;
    el.querySelectorAll('[data-fase]').forEach((b) => b.addEventListener('click', () => { S.fase = b.dataset.fase; renderTamanhos(); }));
    el.querySelectorAll('[data-porte]').forEach((b) => b.addEventListener('click', () => { S.porte = b.dataset.porte; renderTamanhos(); }));
    const ip = el.querySelector('[data-akt-peso]');
    if (ip) ip.addEventListener('change', () => {
      S.peso = ip.value.trim();
      const n = num(S.peso);
      if (n != null) S.porte = portePorPeso(n).id;
      renderTamanhos();
    });
    const ir = el.querySelector('[data-akt-raca]');
    if (ir) ir.addEventListener('change', () => { S.raca = ir.value.trim(); renderTamanhos(); });
    el.querySelectorAll('[data-tam]').forEach((b) => b.addEventListener('click', () => { S.tam = b.dataset.tam; renderTamanhos(); atualizar(); }));
    const bg = el.querySelector('[data-akt-guia]');
    if (bg) bg.addEventListener('click', abrirGuia);
  }
  function linhaFicha(rot, valor, extra, passo) {
    return '<div class="akt-ficha__linha"><dt>' + rot + '</dt><dd>' + valor + (extra ? '<small>' + extra + '</small>' : '') +
      '</dd><button type="button" data-akt-alterar="' + passo + '">Alterar</button></div>';
  }
  const esc = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function renderResumo() {
    const bv = bundle(S.tam, S.cor, S.metal);
    $('[data-akt-resumo-titulo]').textContent = 'O seu Kit ' + (CFG.nome || '');
    const lg = larguraGuia(S.tam);
    $('[data-akt-ficha]').innerHTML = '<dl style="margin:0">' +
      linhaFicha('Couro', esc(S.cor), '', 'cores') +
      linhaFicha('Metal', esc(S.metal), '', 'metal') +
      linhaFicha('Tamanho', esc(S.tam), lg ? 'guia de ' + lg : '', 'tamanho') +
      linhaFicha('Peças', esc(nomePeca(0)) + ' + ' + esc(nomePeca(1)), '', 'cores') + '</dl>';
    $$('[data-akt-alterar]').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.aktAlterar)));
    const tot = $('[data-akt-total]');
    if (!bv) { tot.innerHTML = '<p class="akt-erro">Essa combinação não está disponível.</p>'; return; }
    const pix = Math.round(bv.preco * (1 - (Number(CFG.pixPct) || 0) / 100));
    const parc = Number(CFG.parcelas) || 1;
    tot.innerHTML =
      (bv.cheio > bv.preco ? '<div class="akt-total__linha"><span>Preço das peças separadas</span><span class="akt-preco-riscado">' + brl(bv.cheio) + '</span></div>' : '') +
      '<div class="akt-total__final"><span>Total</span><span>' + brl(bv.preco) + '</span></div>' +
      '<div class="akt-total__linha"><span></span><span><span class="akt-preco-pix">' + brl(pix) + ' no Pix</span> · ou ' + parc + 'x de ' + brl(Math.round(bv.preco / parc)) + ' sem juros</span></div>';
  }

  function valido(passo) {
    if (passo === 'cores') return !!S.cor;
    if (passo === 'metal') return !!S.metal;
    if (passo === 'tamanho') return !!(S.tam && bundle(S.tam, S.cor, S.metal));
    return true;
  }
  function irPara(passo) {
    const alvo = PASSOS.indexOf(passo);
    for (let i = 0; i < alvo; i++) if (!valido(PASSOS[i])) return irPara(PASSOS[i]);
    S.passo = passo;
    $$('[data-akt-etapa]').forEach((e) => { e.hidden = e.dataset.aktEtapa !== passo; });
    if (passo === 'tamanho') renderTamanhos();
    if (passo === 'resumo') renderResumo();
    atualizar();
    const topo = $('#akt-montar') || root;
    const r = topo.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.5) topo.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function atualizar() {
    const i = PASSOS.indexOf(S.passo);
    $$('[data-akt-ir]').forEach((b) => {
      const j = PASSOS.indexOf(b.dataset.aktIr);
      b.classList.toggle('is-atual', j === i);
      b.classList.toggle('is-feito', j < i || (j !== i && valido(b.dataset.aktIr) && j < PASSOS.length - 1 && PASSOS.slice(0, j + 1).every(valido)));
      b.disabled = !PASSOS.slice(0, j).every(valido);
    });
    const av = $('[data-akt-avancar]');
    av.textContent = S.enviando ? 'Adicionando…' : PROXIMO[S.passo];
    av.disabled = S.enviando || !valido(S.passo) || (S.passo === 'resumo' && !bundle(S.tam, S.cor, S.metal));
    $('[data-akt-voltar]').hidden = i === 0;
    // preço da barra
    const bp = $('[data-akt-barra-preco]');
    const exato = S.tam && S.cor && S.metal ? bundle(S.tam, S.cor, S.metal) : null;
    const ref = exato || menorPreco((t, c, m) => c === corVisivel() && m === metalVisivel()) || menorPreco();
    if (ref) {
      const pix = Math.round(ref.preco * (1 - (Number(CFG.pixPct) || 0) / 100));
      bp.innerHTML = (exato ? '' : 'a partir de') + '<b>' + brl(ref.preco) + '</b>' + brl(pix) + ' no Pix';
    }
    atualizarPalco();
  }

  /* ---------- carrinho ---------- */
  async function adicionar() {
    const bv = bundle(S.tam, S.cor, S.metal);
    if (!bv) return;
    const erro = $('[data-akt-erro]');
    erro.hidden = true;
    S.enviando = true; atualizar();
    try {
      const variantes = K.components.map((c, i) => varPeca(i, S.tam, S.cor, S.metal));
      const limpo = (t) => String(t || '').replace(/~~~|\^\^\^/g, ' ');
      const semProto = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/^\/\//, '').replace(/\?.*$/, '');
      const fotoKit = semProto((variantes[0] && variantes[0].featured_image) || K.components[0].featured_image || '');
      const props = { _from_kit: '1' };
      if (bv.cheio > bv.preco) props._preco_cheio = String(bv.cheio);
      if (fotoKit) props._foto_kit = fotoKit;
      props._pecas_kit = K.components.map((comp, i) => {
        const f = semProto((variantes[i] && variantes[i].featured_image) || comp.featured_image || '');
        return [limpo(comp.title), limpo(variantes[i] && variantes[i].title), f].join('~~~');
      }).join('^^^');
      const res = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: [{ id: Number(bv.id), quantity: 1, properties: props }] }),
      });
      if (!res.ok) {
        let msg = 'Não foi possível adicionar o kit. Tente novamente.';
        try { const d = await res.json(); if (typeof d.description === 'string') msg = d.description; } catch (_) {}
        throw new Error(msg);
      }
      try {
        const cart = await (await fetch('/cart.js', { headers: { Accept: 'application/json' } })).json();
        if (window.AmeCart && window.AmeCart.open) { window.AmeCart.refresh && window.AmeCart.refresh(cart); window.AmeCart.open(); }
        else window.location.href = '/cart';
      } catch (_) { window.location.href = '/cart'; }
    } catch (e) {
      erro.textContent = e.message || 'Não foi possível adicionar o kit. Tente novamente.';
      erro.hidden = false;
    } finally {
      S.enviando = false; atualizar();
    }
  }

  /* ---------- topo ---------- */
  function renderTopo() {
    const cor = corPadrao(), metal = metalPadrao();
    [0, 1].forEach((i) => {
      const img = $('[data-akt-hero-img="' + i + '"]');
      const src = fotoPeca(i, cor, metal);
      if (!img || !src) return;
      img.alt = nomePeca(i);
      img.onload = () => img.classList.add('is-on');
      img.src = urlFoto(src, 900);
    });
    const min = menorPreco();
    const el = $('[data-akt-hero-preco]');
    if (min && el) {
      const pix = Math.round(min.preco * (1 - (Number(CFG.pixPct) || 0) / 100));
      const parc = Number(CFG.parcelas) || 1;
      el.innerHTML = '<span class="akt-rot">A partir de</span>' +
        (min.cheio > min.preco ? '<span class="akt-preco-riscado">' + brl(min.cheio) + '</span>' : '') +
        '<div class="akt-preco-grande">' + brl(pix) + ' <span class="akt-preco-pix" style="font-size:15px">no Pix</span></div>' +
        '<div class="akt-preco-linha">ou ' + brl(min.preco) + ' em até ' + parc + 'x de ' + brl(Math.round(min.preco / parc)) + ' sem juros</div>';
    }
  }

  /* ---------- início ---------- */
  async function iniciar() {
    try {
      const r = await fetch(CFG.waltz + '/api/public/kit/' + encodeURIComponent(CFG.handle));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      K = await r.json();
    } catch (e) {
      console.error('[ateliê kit] não carregou', e);
      const hp = $('[data-akt-hero-preco]');
      if (hp) hp.innerHTML = '<span class="akt-erro">Não foi possível carregar o kit agora. Recarregue a página.</span>';
      return;
    }
    OP = montarOpcoes(K);
    if (!OP.cor || !OP.metal || !OP.tam || !K.components || K.components.length < 2) {
      console.error('[ateliê kit] estrutura inesperada', OP);
      return;
    }
    FOTOS = montarFotos(K);
    try {
      const rt = await fetch(CFG.waltz + '/api/tm/widget?produto_id=' + encodeURIComponent(K.components[0].id));
      if (rt.ok) { const j = await rt.json(); if (j && j.tabela) TM = j; }
    } catch (_) { /* sem tabela: segue só com os tamanhos */ }
    renderTopo();
    renderCores();
    renderMetais();
    $$('[data-akt-ir]').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.aktIr)));
    $('[data-akt-voltar]').addEventListener('click', () => irPara(PASSOS[Math.max(0, PASSOS.indexOf(S.passo) - 1)]));
    $('[data-akt-avancar]').addEventListener('click', () => {
      if (S.passo === 'resumo') return adicionar();
      irPara(PASSOS[PASSOS.indexOf(S.passo) + 1]);
    });
    atualizar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
