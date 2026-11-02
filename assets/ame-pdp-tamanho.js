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

  var S = { idade: 'Adulto', raca: '', peso: '' };
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
    if (S.raca || S.peso) partes.push(S.idade.toLowerCase());
    if (S.peso) partes.push(String(S.peso).replace('.', ',') + ' kg');
    return partes.join(', ');
  }
  function preencherCampo() {
    var c = campoRaca();
    if (!c || !S.raca) return;
    // só escreve por cima do que ESTE bloco escreveu (nunca do que a cliente digitou)
    if (c.value && !autoPreenchido) return;
    c.value = textoParaEquipe();
    autoPreenchido = true;
    c.dispatchEvent(new Event('input', { bubbles: true }));
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
    bloco.innerHTML =
      '<h4 class="pdp-tam__titulo">Qual o tamanho do seu pet?</h4>' +
      '<p class="pdp-tam__sub">Pela raça sugerimos o tamanho; nossa equipe confere tudo antes de produzir.</p>' +
      '<div class="pdp-tam__linha" role="group" aria-label="Idade do pet">' + chip('Filhote', S.idade === 'Filhote', 'data-tam-idade') + chip('Adulto', S.idade === 'Adulto', 'data-tam-idade') + '</div>' +
      '<div class="pdp-tam__linha" role="group" aria-label="Raça mais comum">' + POPULARES.map(function (r) { return chip(r, norm(r) === norm(S.raca), 'data-tam-raca'); }).join('') + '</div>' +
      '<div class="pdp-tam__campos">' +
        '<label class="pdp-tam__campo"><span>Outra raça</span><input type="text" list="pdp-tam-racas" autocomplete="off" value="' + esc(S.raca) + '" data-tam-campo="raca" placeholder="Digite a raça"><datalist id="pdp-tam-racas">' + racasLista + '</datalist></label>' +
        '<label class="pdp-tam__campo pdp-tam__campo--peso"><span>Peso (kg, opcional)</span><input type="text" inputmode="decimal" autocomplete="off" value="' + esc(S.peso) + '" data-tam-campo="peso" placeholder="Ex.: 4,5"></label>' +
      '</div>' +
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

  function iniciar() {
    if (!campoRaca() || !grupoTamanho()) return;
    var pid = (window.WaltzShopify && window.WaltzShopify.productId) || '';
    if (!pid) { var w = document.getElementById('pdp-wishlist'); pid = w ? w.getAttribute('data-product-id') : ''; }
    if (!pid) return;
    fetch(WALTZ + '/api/tm/widget?produto_id=' + encodeURIComponent(pid))
      .then(function (r) { return r.json(); })
      .then(function (r) {
        var t = r && r.tabela;
        if (!t || !(t.racas || []).length) return;
        TM = { racas: t.racas || [] };
        montar();
      })
      .catch(function () { /* sem tabela: a escolha direta de tamanho segue como está */ });
  }

  // o Section Rendering recria os botões de tamanho: reavalia a recomendação (botão "usar" × "escolhido")
  document.addEventListener('pdp:variant-changed', function () { if (bloco && bloco.isConnected) render(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
