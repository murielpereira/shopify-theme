/*
 * "Acerte o tamanho" na PDP (mesma ideia da etapa Tamanho do Ateliê da Atena).
 *
 * Dentro do passo a passo (ame-pdp-passos.js), no passo Tamanho: a cliente diz se o pet é
 * filhote ou adulto, a raça e (opcional) o peso; a gente sugere o tamanho pela tabela de
 * medidas do Waltz (/api/tm/widget) e ela aplica com um toque. Só a RAÇA recomenda, com a
 * mesma regra da aba "Qual tamanho comprar?" do widget de medidas (variações por fase e
 * faixa de peso). O que ela informou também preenche o campo "raça, idade e peso do pet"
 * do produto, quando ele existe, para a equipe conferir.
 *
 * Só liga em produto com esse campo de raça. Se a tabela não carregar, o bloco some e a
 * página segue com a escolha direta de tamanho.
 */
(function () {
  'use strict';

  var form = document.getElementById('pdp-form');
  if (!form || form.dataset.passos !== 'true') return;

  var WALTZ = 'https://waltz.up.railway.app';
  var POPULARES = ['Chihuahua', 'Dachshund', 'Vira-lata (SRD)', 'Spitz Alemão', 'Shih Tzu', 'Cavalier', 'Golden Retriever', 'Yorkshire', 'Cocker', 'Maltês', 'Bulldog Francês', 'Pinscher', 'Border Collie', 'Poodle', 'Gato'];
  var ALIAS = {
    dachshund: 'Dachshund (Salsicha)', salsicha: 'Dachshund (Salsicha)', cavalier: 'Cavalier King Charles Spaniel',
    yorkshire: 'Yorkshire Terrier', cocker: 'Cocker Spaniel', pinscher: 'Pinscher Miniatura',
    lulu: 'Lulu da Pomerânia', srd: 'Vira-lata (SRD)', viralata: 'Vira-lata (SRD)', gato: 'Gato SRD'
  };

  var PORTES = [
    { id: 'Micro', faixa: 'até 2 kg', nivel: 1 },
    { id: 'Mini', faixa: '2,2 a 3,5 kg', nivel: 2 },
    { id: 'Pequeno', faixa: '4 a 10 kg', nivel: 3 },
    { id: 'Médio', faixa: '11 a 22 kg', nivel: 4 },
    { id: 'Grande', faixa: '24 a 35 kg', nivel: 5 }
  ];
  var S = { idade: '', porte: '', raca: '', peso: '' };
  var TM = null;
  var bloco = null;
  var autoPreenchido = false;

  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
  function compacto(s) { return norm(s).replace(/[^a-z0-9]/g, ''); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function campoRaca() {
    var todos = form.querySelectorAll('.pdp__custom-field textarea, .pdp__custom-field input[type="text"]');
    for (var i = 0; i < todos.length; i++) {
      if (/ra[cç]a/i.test(todos[i].name || '')) return todos[i];
    }
    return null;
  }
  function grupoTamanho() {
    var gs = form.querySelectorAll('#pdp-options-wrap .pdp__option');
    for (var i = 0; i < gs.length; i++) {
      if (/tamanho/i.test(gs[i].getAttribute('data-option-name') || '')) return gs[i];
    }
    return null;
  }
  function botoesTamanho() {
    var g = grupoTamanho();
    return g ? Array.prototype.slice.call(g.querySelectorAll('.pdp__size-btn, .pdp__swatch')) : [];
  }
  function valorDoBotao(b) {
    return b.getAttribute('data-option-value') || b.getAttribute('aria-label') || b.textContent.trim();
  }
  function tamanhosDaLoja() { return botoesTamanho().map(valorDoBotao); }

  function pesoNum() {
    var v = parseFloat(String(S.peso).replace(',', '.'));
    return isFinite(v) && v > 0 ? v : 0;
  }
  function racaDoCatalogo(nome) {
    if (!TM || !TM.racas || !nome) return null;
    var n = compacto(nome);
    if (!n) return null;
    var alvo = ALIAS[n] ? compacto(ALIAS[n]) : n;
    for (var i = 0; i < TM.racas.length; i++) if (compacto(TM.racas[i].nome_raca) === alvo) return TM.racas[i];
    return null;
  }
  // Mesma regra do widget-medidas.js (encontrarVariacao)
  function encontrarVariacao(variacoes, fase, peso) {
    var daFase = variacoes.filter(function (v) { return String(v.fase || '').trim() === fase && v.tamanho_coleira; });
    if (!daFase.length) return null;
    var temPeso = peso != null && !isNaN(peso);
    if (temPeso) {
      var porPeso = daFase.filter(function (v) {
        var mn = v.peso_min != null ? parseFloat(v.peso_min) : null;
        var mx = v.peso_max != null ? parseFloat(v.peso_max) : null;
        if (mn != null && mx != null) return peso >= mn && peso <= mx;
        if (mn != null) return peso >= mn;
        if (mx != null) return peso <= mx;
        return false;
      })[0];
      if (porPeso) return porPeso;
    }
    var generica = daFase.filter(function (v) { return v.peso_min == null && v.peso_max == null; })[0];
    if (generica) return generica;
    if (daFase.length === 1) return daFase[0];
    return temPeso ? null : { precisaPeso: true };
  }
  function recomendacao() {
    var raca = racaDoCatalogo(S.raca);
    if (!raca) return null;
    var vars = (raca.variacoes || []).filter(function (v) { return v.tamanho_coleira; });
    if (!vars.length) return null;
    var fases = [];
    vars.forEach(function (v) { var f = String(v.fase || '').trim(); if (f && fases.indexOf(f) < 0) fases.push(f); });
    if (!fases.length) return null;
    var quer = S.idade === 'Filhote' ? 'filhote' : 'adulto';
    var fase = fases.filter(function (f) { return norm(f) === quer; })[0] || fases.filter(function (f) { return norm(f) === 'adulto'; })[0] || fases[0];
    var base = { raca: raca.nome_raca };
    var v = encontrarVariacao(vars, fase, pesoNum() || null);
    if (!v) return Object.assign(base, { semIndicacao: true });
    if (v.precisaPeso) return Object.assign(base, { precisaPeso: true });
    var lojas = tamanhosDaLoja();
    var tam = String(v.tamanho_coleira).split(/[\s/,]+|\bou\b/).map(function (s) { return s.trim(); }).filter(function (s) { return lojas.indexOf(s) >= 0; })[0];
    if (!tam) return Object.assign(base, { semIndicacao: true });
    return Object.assign(base, { tamanho: tam, obs: v.observacao || '' });
  }

  function textoParaEquipe() {
    var partes = [];
    if (S.raca) partes.push(S.raca);
    if (S.idade) partes.push(S.idade.toLowerCase());
    if (S.porte) partes.push('porte ' + S.porte.toLowerCase());
    if (S.peso) partes.push(String(S.peso).replace('.', ',') + ' kg');
    return partes.join(', ');
  }
  // Produto sem o campo de raça: um campo oculto leva a mesma informação no pedido
  function campoDoPedido() {
    var c = campoRaca();
    if (c) return c;
    c = form.querySelector('input[name="properties[Raça, idade e peso do pet]"]');
    if (!c) {
      c = document.createElement('input');
      c.type = 'hidden';
      c.name = 'properties[Raça, idade e peso do pet]';
      form.appendChild(c);
    }
    return c;
  }
  function preencherCampo() {
    if (!S.raca && !S.porte && !S.peso && !S.idade) {
      var antigo = campoRaca();
      if (antigo && autoPreenchido) { antigo.value = ''; antigo.dispatchEvent(new Event('input', { bubbles: true })); }
      return;
    }
    var c = campoDoPedido();
    // só escreve por cima do que ESTE bloco escreveu (nunca do que a cliente digitou)
    if (c.value && !autoPreenchido) return;
    c.value = textoParaEquipe();
    autoPreenchido = true;
    c.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function silhueta(nivel) {
    var h = 11 + nivel * 3;
    return '<svg viewBox="0 0 40 28" height="' + h + '" width="' + (h * 1.43).toFixed(1) + '" fill="currentColor" aria-hidden="true" focusable="false"><rect x="7" y="10" width="20" height="10" rx="5"/><circle cx="26.5" cy="11.5" r="4.2"/><circle cx="31" cy="8" r="4.2"/><rect x="33.6" y="6.4" width="5" height="3.2" rx="1.6"/><path d="M28.8 5.2 31 1.2 33.4 5.6Z"/><path d="M7.6 13C4.6 12.4 2.7 9.4 2.3 5.6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/><rect x="8.4" y="17.4" width="3.6" height="8.6" rx="1.8"/><rect x="13.8" y="18.4" width="3.6" height="7.6" rx="1.8"/><rect x="20.4" y="17.4" width="3.6" height="8.6" rx="1.8"/><rect x="25.2" y="18.4" width="3.6" height="7.6" rx="1.8"/></svg>';
  }

  function chip(valor, ativo, attr) {
    return '<button type="button" class="pdp-tam__chip' + (ativo ? ' is-ativo' : '') + '" ' + attr + '="' + esc(valor) + '" aria-pressed="' + (ativo ? 'true' : 'false') + '">' + esc(valor) + '</button>';
  }

  function render() {
    if (!bloco) return;
    var racasLista = (TM.racas || []).map(function (r) { return '<option value="' + esc(r.nome_raca) + '"></option>'; }).join('');
    var rec = recomendacao();
    var recHtml = '';
    if (rec && rec.tamanho) {
      var btn = botoesTamanho().filter(function (b) { return valorDoBotao(b) === rec.tamanho; })[0];
      var ativo = btn && /--active/.test(btn.className);
      recHtml = '<p class="pdp-tam__reco-texto">Para ' + esc(rec.raca) + ', recomendamos o tamanho <strong>' + esc(rec.tamanho) + '</strong>.' + (rec.obs ? ' ' + esc(rec.obs) : '') + '</p>' +
        (ativo ? '<p class="pdp-tam__ok">Tamanho ' + esc(rec.tamanho) + ' escolhido.</p>' :
          '<button type="button" class="pdp-tam__usar" data-tam-usar="' + esc(rec.tamanho) + '">Usar o tamanho ' + esc(rec.tamanho) + '</button>');
    } else if (rec && rec.precisaPeso) {
      recHtml = '<p class="pdp-tam__reco-texto">Para ' + esc(rec.raca) + ' o tamanho depende do peso. Informe o peso para sugerirmos.</p>';
    } else if (rec && rec.semIndicacao) {
      recHtml = '<p class="pdp-tam__reco-texto">Não temos uma indicação segura para este caso. Escolha abaixo e nossa equipe confere antes de produzir.</p>';
    } else if (S.raca) {
      recHtml = '<p class="pdp-tam__reco-texto">Não achamos essa raça na tabela. Escolha o tamanho abaixo; nossa equipe confere antes de produzir.</p>';
    }
    var foco = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-tam-campo');
    var idades = [['Filhote', 'ainda vai crescer'], ['Adulto', 'tamanho definitivo']];
    bloco.innerHTML =
      '<h4 class="pdp-tam__titulo">O tamanho certo</h4>' +
      '<p class="pdp-tam__sub">Conte sobre o seu pet: pela raça a gente sugere o tamanho, e a nossa equipe confere tudo antes de produzir.</p>' +
      '<p class="pdp-tam__passo"><span>1</span> Filhote ou adulto?</p>' +
      '<div class="pdp-tam__idades" role="group" aria-label="Idade do pet">' + idades.map(function (i) {
        return '<button type="button" class="pdp-tam__idade' + (S.idade === i[0] ? ' is-ativo' : '') + '" data-tam-idade="' + i[0] + '" aria-pressed="' + (S.idade === i[0]) + '"><strong>' + i[0] + '</strong><small>' + i[1] + '</small></button>';
      }).join('') + '</div>' +
      '<p class="pdp-tam__passo"><span>2</span> Porte' + (S.porte ? ' <em>' + esc(S.porte) + '</em>' : '') + '</p>' +
      '<div class="pdp-tam__portes" role="group" aria-label="Porte do pet">' + PORTES.map(function (p) {
        return '<button type="button" class="pdp-tam__porte' + (S.porte === p.id ? ' is-ativo' : '') + '" data-tam-porte="' + p.id + '" aria-pressed="' + (S.porte === p.id) + '">' + silhueta(p.nivel) + '<strong>' + p.id + '</strong><small>' + p.faixa + '</small></button>';
      }).join('') + '</div>' +
      '<p class="pdp-tam__passo"><span>3</span> Peso <em>opcional</em></p>' +
      '<label class="pdp-tam__campo pdp-tam__campo--peso"><input type="text" inputmode="decimal" autocomplete="off" value="' + esc(S.peso) + '" data-tam-campo="peso" placeholder="Ex.: 4,5 kg" aria-label="Peso do pet em kg"></label>' +
      '<p class="pdp-tam__passo"><span>4</span> Raça</p>' +
      '<div class="pdp-tam__linha" role="group" aria-label="Raça mais comum">' + POPULARES.map(function (r) { return chip(r, norm(r) === norm(S.raca), 'data-tam-raca'); }).join('') + '</div>' +
      '<label class="pdp-tam__campo"><span>Outra raça</span><input type="text" list="pdp-tam-racas" autocomplete="off" value="' + esc(S.raca) + '" data-tam-campo="raca" placeholder="Digite a raça"><datalist id="pdp-tam-racas">' + racasLista + '</datalist></label>' +
      '<div class="pdp-tam__reco" aria-live="polite">' + recHtml + '</div>';
    if (foco) {
      var el = bloco.querySelector('[data-tam-campo="' + foco + '"]');
      if (el) { el.focus(); var l = el.value.length; try { el.setSelectionRange(l, l); } catch (e) { /* ok */ } }
    }
  }

  function aplicarTamanho(t) {
    var btn = botoesTamanho().filter(function (b) { return valorDoBotao(b) === t; })[0];
    if (btn && !btn.disabled) btn.click();
  }

  function montar() {
    if (bloco && bloco.isConnected) return;
    bloco = document.createElement('div');
    bloco.className = 'pdp-tam';
    bloco.setAttribute('data-passo-extra', 'tamanho');
    var wrap = form.querySelector('#pdp-options-wrap');
    form.insertBefore(bloco, wrap || form.firstChild);

    bloco.addEventListener('click', function (e) {
      var i = e.target.closest('[data-tam-idade]');
      if (i) { S.idade = i.getAttribute('data-tam-idade'); preencherCampo(); render(); return; }
      var p = e.target.closest('[data-tam-porte]');
      if (p) { S.porte = p.getAttribute('data-tam-porte'); preencherCampo(); render(); return; }
      var r = e.target.closest('[data-tam-raca]');
      if (r) { S.raca = r.getAttribute('data-tam-raca'); preencherCampo(); render(); return; }
      var u = e.target.closest('[data-tam-usar]');
      if (u) aplicarTamanho(u.getAttribute('data-tam-usar'));
    });
    bloco.addEventListener('input', function (e) {
      var c = e.target.getAttribute('data-tam-campo');
      if (!c) return;
      S[c] = e.target.value;
      preencherCampo();
      clearTimeout(montar.t);
      montar.t = setTimeout(render, 350);
    });
    render();
  }

  // O bloco já pergunta raça, idade e peso: o campo de texto do produto some (ele é preenchido
  // por aqui) e a raça passa a ser exigida no passo Tamanho quando o campo era obrigatório.
  function substituirCampoDeRaca() {
    var c = campoRaca();
    if (!c) return;
    var caixa = c.closest('.pdp__custom-field');
    if (caixa) caixa.classList.add('is-tam-oculto');
    var obrigatorio = c.hasAttribute('data-cf-required');
    window.amePdpTamanho = {
      pronto: function () { return !obrigatorio || !!String(S.raca || '').trim(); },
      aviso: 'Informe a raça do pet para continuar.'
    };
    document.dispatchEvent(new CustomEvent('pdp:tamanho-pronto'));
  }

  function iniciar() {
    if (!grupoTamanho()) return;
    var pid = (window.WaltzShopify && window.WaltzShopify.productId) || '';
    if (!pid) { var w = document.getElementById('pdp-wishlist'); pid = w ? w.getAttribute('data-product-id') : ''; }
    if (!pid) return;
    fetch(WALTZ + '/api/tm/widget?produto_id=' + encodeURIComponent(pid))
      .then(function (r) { return r.json(); })
      .then(function (r) {
        var t = r && r.tabela;
        if (!t || !(t.racas || []).length) return;
        TM = { racas: t.racas || [] };
        substituirCampoDeRaca();
        montar();
      })
      .catch(function () { /* sem tabela: a escolha direta de tamanho segue como está */ });
  }

  // o Section Rendering recria os botões de tamanho: reavalia a recomendação (botão "usar" × "escolhido")
  document.addEventListener('pdp:variant-changed', function () { if (bloco && bloco.isConnected) render(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
