/*
 * Passo a passo da página de produto (mesmo estilo do kit).
 *
 * Melhoria progressiva: o formulário #pdp-form continua completo no HTML. Este
 * script só ESCONDE (classe .is-passo-oculto) o que não é do passo atual e
 * acrescenta a navegação por etapas. Nenhum nó é movido ou recriado — o resto
 * da página (pingente, campos personalizados, validação do submit, Compre
 * Junto) segue lendo os mesmos elementos. Se o JS falhar, a página é a de sempre.
 *
 * Liga só quando <form id="pdp-form" data-passos="true"> (seção com a opção
 * "Passo a passo" marcada, ex.: template product.passos) e há 2+ grupos de opção.
 * Kits têm o próprio passo a passo (ame-kit.js) e ficam de fora.
 *
 * O Section Rendering troca #pdp-options-wrap e #pdp-add-btn-wrap a cada opção
 * escolhida; por isso tudo é reaplicado a partir do DOM atual (render()).
 */
(function () {
  'use strict';

  var form = document.getElementById('pdp-form');
  if (!form || form.dataset.passos !== 'true') return;
  if (form.querySelector('.pdp-kit-wizard, [data-kit-wizard]')) return;

  var HIDE = 'is-passo-oculto';
  var atual = 0;
  var nav, rodape, btnProx, btnVoltar, live, resumoEl;
  var ultimoTotal = -1;
  var renderAgendado = false;

  function grupos() {
    return Array.prototype.slice.call(form.querySelectorAll('#pdp-options-wrap .pdp__option'));
  }
  function detalhes() {
    return Array.prototype.slice.call(form.querySelectorAll('.ame-pingente, .pdp__custom-field'));
  }
  function resumo() {
    return Array.prototype.slice.call(form.querySelectorAll('.pdp__qty, .pdp-bundle, .pdp__ctas'));
  }
  function nomeDoGrupo(g) {
    return g.getAttribute('data-option-name') || (g.querySelector('.pdp__option-label') || {}).textContent || 'Opção';
  }
  function valorEscolhido(g) {
    var a = g.querySelector('.pdp__swatch--active, .pdp__size-btn--active');
    if (!a) return '';
    return a.getAttribute('data-option-value') || a.getAttribute('aria-label') || a.getAttribute('title') || a.textContent.trim();
  }

  // Passos montados do DOM atual
  function textoDoCampo(bloco) {
    var rot = bloco.querySelector('.pdp__custom-field__label, label, legend');
    var campo = bloco.querySelector('textarea, input[type="text"], input[type="hidden"].pdp__custom-field__radio-val, input:not([type="radio"]):not([type="checkbox"]), select');
    var v = campo ? String(campo.value || '').trim() : '';
    var nome = rot ? rot.textContent.replace('*', '').trim() : '';
    return v ? [nome, v] : null;
  }

  function preencherResumo(passos) {
    if (!resumoEl) return;
    var linhas = [];
    passos.forEach(function (p) {
      if (p.tipo === 'opcao') linhas.push([p.rotulo, valorEscolhido(p.grupo)]);
    });
    var ping = window.amePingente;
    if (ping && typeof ping.hasAnswered === 'function' && form.querySelector('.ame-pingente')) {
      linhas.push(['Pingente', ping.isActive() ? 'Com pingente personalizado' : 'Sem pingente']);
    }
    Array.prototype.forEach.call(form.querySelectorAll('.pdp__custom-field'), function (b) {
      var t = textoDoCampo(b);
      if (t) linhas.push(t);
    });
    resumoEl.innerHTML = '';
    var h = document.createElement('p');
    h.className = 'pdp-passos__resumo-titulo';
    h.textContent = 'Seu pedido';
    resumoEl.appendChild(h);
    var dl = document.createElement('dl');
    dl.className = 'pdp-passos__resumo-lista';
    linhas.forEach(function (l) {
      var dt = document.createElement('dt'); dt.textContent = l[0];
      var dd = document.createElement('dd'); dd.textContent = l[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
    resumoEl.appendChild(dl);
  }

  function montarPassos() {
    var passos = grupos().map(function (g) {
      return { tipo: 'opcao', rotulo: nomeDoGrupo(g).trim(), els: [g], grupo: g };
    });
    var det = detalhes();
    if (det.length) passos.push({ tipo: 'detalhes', rotulo: 'Detalhes', els: det });
    var els = resumo();
    if (resumoEl) els.unshift(resumoEl);
    passos.push({ tipo: 'resumo', rotulo: 'Resumo', els: els });
    return passos;
  }

  function camposObrigatoriosOk(els) {
    var ok = true;
    els.forEach(function (bloco) {
      if (!bloco.classList.contains('pdp__custom-field')) return;
      var reqs = bloco.querySelectorAll('[data-cf-required]');
      var radiosVistos = {};
      Array.prototype.forEach.call(reqs, function (i) {
        if (i.type === 'radio') {
          if (radiosVistos[i.name] === undefined) {
            radiosVistos[i.name] = !!bloco.querySelector('input[type="radio"][name="' + i.name.replace(/"/g, '\\"') + '"]:checked');
          }
        } else if (i.type === 'checkbox') {
          if (!i.checked) ok = false;
        } else if (!String(i.value || '').trim()) {
          ok = false;
        }
      });
      Object.keys(radiosVistos).forEach(function (k) { if (!radiosVistos[k]) ok = false; });
    });
    return ok;
  }

  function pingenteOk() {
    var p = window.amePingente;
    if (!p || typeof p.hasAnswered !== 'function') return true;
    if (!p.hasAnswered()) return false;
    // Sim: o fluxo do pingente tem a própria validação (no submit); aqui só exige a resposta
    return true;
  }

  function passoCompleto(p) {
    if (p.tipo === 'opcao') return !!valorEscolhido(p.grupo);
    if (p.tipo === 'detalhes') return pingenteOk() && camposObrigatoriosOk(p.els);
    return true;
  }

  function ensureUI() {
    if (nav && nav.isConnected) return;
    nav = document.createElement('nav');
    nav.className = 'pdp-passos__nav';
    nav.setAttribute('aria-label', 'Etapas da escolha');
    nav.setAttribute('data-passos-nav', '');

    rodape = document.createElement('div');
    rodape.className = 'pdp-passos__rodape';

    btnVoltar = document.createElement('button');
    btnVoltar.type = 'button';
    btnVoltar.className = 'pdp-passos__voltar';
    btnVoltar.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true" style="font-size:1rem">arrow_back</span> Voltar';
    btnVoltar.addEventListener('click', function () { ir(atual - 1); });

    btnProx = document.createElement('button');
    btnProx.type = 'button';
    btnProx.className = 'ame-cta pdp-passos__proximo';
    btnProx.textContent = 'Próximo passo';
    btnProx.addEventListener('click', proximo);

    live = document.createElement('p');
    live.className = 'pdp-passos__live';
    live.setAttribute('aria-live', 'polite');

    rodape.appendChild(btnVoltar);
    rodape.appendChild(btnProx);

    resumoEl = document.createElement('div');
    resumoEl.className = 'pdp-passos__resumo';
    var wrap = form.querySelector('#pdp-options-wrap');
    form.insertBefore(nav, wrap || form.firstChild);
    var qtd = form.querySelector('.pdp__qty');
    form.insertBefore(resumoEl, qtd || rodape);
    form.appendChild(rodape);
    form.appendChild(live);

    nav.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-passo]');
      if (!chip || chip.disabled) return;
      ir(parseInt(chip.getAttribute('data-passo'), 10));
    });
  }

  function proximo() {
    var passos = montarPassos();
    var p = passos[atual];
    if (!p) return;
    if (!passoCompleto(p)) { avisar(p); return; }
    ir(atual + 1);
  }

  function avisar(p) {
    var msg = p.tipo === 'opcao' ? 'Escolha ' + p.rotulo.toLowerCase() + ' para continuar.'
      : 'Responda os itens de ' + p.rotulo.toLowerCase() + ' para continuar.';
    live.textContent = msg;
    p.els.forEach(function (el) {
      el.classList.add('is-passo-tremer');
      setTimeout(function () { el.classList.remove('is-passo-tremer'); }, 600);
    });
  }

  function ir(n) {
    var passos = montarPassos();
    if (n < 0) n = 0;
    if (n > passos.length - 1) n = passos.length - 1;
    // não pula para frente de passo incompleto
    for (var i = 0; i < n; i++) {
      if (!passoCompleto(passos[i])) { n = i; break; }
    }
    atual = n;
    render();
    var topo = nav.getBoundingClientRect().top;
    if (topo < 0) nav.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function render() {
    renderAgendado = false;
    if (grupos().length < 2) { desligar(); return; }
    ensureUI();
    var passos = montarPassos();
    form.classList.add('pdp-passos');

    if (passos.length !== ultimoTotal) {
      // estrutura mudou (ex.: bundle/pingente apareceu): volta a um índice válido
      ultimoTotal = passos.length;
    }
    if (atual > passos.length - 1) atual = passos.length - 1;

    // não deixa ficar à frente de passo incompleto (ex.: opção trocada deixou vago)
    for (var i = 0; i < atual; i++) {
      if (!passoCompleto(passos[i])) { atual = i; break; }
    }

    // visibilidade
    var visiveis = new Set(passos[atual].els);
    var todos = new Set();
    passos.forEach(function (p) { p.els.forEach(function (el) { todos.add(el); }); });
    todos.forEach(function (el) { el.classList.toggle(HIDE, !visiveis.has(el)); });

    // chips
    nav.innerHTML = '';
    passos.forEach(function (p, idx) {
      var feito = idx < atual && passoCompleto(p);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pdp-passos__chip' + (idx === atual ? ' is-atual' : '') + (feito ? ' is-feito' : '');
      b.setAttribute('data-passo', String(idx));
      if (idx === atual) b.setAttribute('aria-current', 'step');
      var alcancavel = true;
      for (var j = 0; j < idx; j++) if (!passoCompleto(passos[j])) { alcancavel = false; break; }
      b.disabled = !alcancavel;
      var valor = p.tipo === 'opcao' ? valorEscolhido(p.grupo) : '';
      b.innerHTML = '<span class="pdp-passos__chip-rotulo"></span>' + (valor ? '<span class="pdp-passos__chip-valor"></span>' : '');
      b.querySelector('.pdp-passos__chip-rotulo').textContent = p.rotulo;
      if (valor) b.querySelector('.pdp-passos__chip-valor').textContent = valor;
      nav.appendChild(b);
    });

    // rodapé
    var ehResumo = passos[atual].tipo === 'resumo';
    if (ehResumo) preencherResumo(passos);
    rodape.hidden = false;
    btnProx.hidden = ehResumo;
    btnVoltar.hidden = atual === 0;
    rodape.classList.toggle('is-so-voltar', ehResumo);
    btnProx.disabled = false;
    btnProx.setAttribute('aria-disabled', passoCompleto(passos[atual]) ? 'false' : 'true');
    btnProx.classList.toggle('is-aguardando', !passoCompleto(passos[atual]));
  }

  function desligar() {
    form.classList.remove('pdp-passos');
    Array.prototype.forEach.call(form.querySelectorAll('.' + HIDE), function (el) { el.classList.remove(HIDE); });
    if (nav) nav.remove();
    if (rodape) rodape.remove();
    if (live) live.remove();
    if (resumoEl) resumoEl.remove();
    nav = rodape = resumoEl = null;
  }

  function agendar() {
    if (renderAgendado) return;
    renderAgendado = true;
    requestAnimationFrame(render);
  }

  // Section Rendering troca nós filhos do form; escolhas e campos mudam estado
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) {
        // ignora o que a própria UI insere/remove
        var meu = function (n) {
          return n.nodeType === 1 && (n === nav || n === rodape || n === live || n === resumoEl ||
            (n.classList && (n.classList.contains('pdp-passos__nav') || n.classList.contains('pdp-passos__rodape') || n.classList.contains('pdp-passos__live'))));
        };
        var soMeus = Array.prototype.every.call(m.addedNodes, meu) && Array.prototype.every.call(m.removedNodes, meu);
        if (!soMeus) { agendar(); return; }
      }
    }
  }).observe(form, { childList: true });

  document.addEventListener('pdp:variant-changed', agendar);
  form.addEventListener('input', agendar);
  form.addEventListener('change', agendar);
  form.addEventListener('click', function (e) {
    // respostas do pingente (Sim/Não) e escolhas mudam o estado sem input/change
    if (e.target.closest('.ame-pingente, .pdp__option')) setTimeout(agendar, 50);
  });

  render();
})();
