/* Card de produto agrupado por cor — "Esgotado" só se TODAS as cores esgotaram.
 *
 * O tema renderiza o card com a disponibilidade do produto que representa o
 * grupo (o `produto_principal`). Quando só ESSA cor acaba, o card inteiro
 * dizia "Esgotado" mesmo com as outras cores à venda.
 *
 * O snippet product-card marca o card esgotado de um produto agrupado com
 * `data-grupo-handle`. Aqui: o Waltz diz QUEM está no grupo
 * (/api/public/grupo/<handle>) e a loja diz se cada um está à venda
 * (/products/<handle>.js — funciona com produto "não listado"). A
 * disponibilidade NÃO vem do Waltz de propósito: o espelho de estoque dele só
 * atualiza na sincronização, e este card precisa refletir o que a loja vende.
 *
 * Qualquer falha (rede, grupo sem outros membros) deixa o card como veio:
 * "Esgotado". Nunca promete uma compra que a loja não oferece.
 */
(function () {
  'use strict';
  if (window.__ameCardGrupoLoaded) return;
  window.__ameCardGrupoLoaded = true;

  var WALTZ = 'https://waltz.up.railway.app';
  var TTL_MS = 5 * 60 * 1000;
  var CHAVE = 'ame:grupo-disponivel:';
  var pendentes = {}; // handle → Promise<boolean>

  function lerCache(handle) {
    try {
      var c = JSON.parse(sessionStorage.getItem(CHAVE + handle));
      if (c && Date.now() - c.at < TTL_MS) return c.v;
    } catch (_) {}
    return null;
  }
  function gravarCache(handle, v) {
    try { sessionStorage.setItem(CHAVE + handle, JSON.stringify({ at: Date.now(), v: v })); } catch (_) {}
  }

  // XHR (e não fetch) como o widget de agrupamento: apps de terceiro na loja
  // interceptam fetch.
  function xhrJson(url) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('GET', url, true);
      x.setRequestHeader('Accept', 'application/json');
      x.onload = function () {
        if (x.status < 200 || x.status >= 300) return reject(new Error('HTTP ' + x.status));
        try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(e); }
      };
      x.onerror = function () { reject(new Error('rede')); };
      x.send();
    });
  }

  // true = há outra cor à venda · false = todas esgotadas · null = não deu pra saber
  function algumaCorAVenda(handle) {
    var c = lerCache(handle);
    if (c !== null) return Promise.resolve(c);
    if (pendentes[handle]) return pendentes[handle];
    pendentes[handle] = xhrJson(WALTZ + '/api/public/grupo/' + encodeURIComponent(handle))
      .then(function (g) {
        var outros = ((g && g.membros) || [])
          .map(function (m) { return m.handle; })
          .filter(function (h) { return h && h !== handle; });
        if (!outros.length) return null;
        return Promise.all(outros.map(function (h) {
          return xhrJson('/products/' + encodeURIComponent(h) + '.js')
            .then(function (p) { return !!p.available; })
            .catch(function () { return null; });
        })).then(function (r) {
          if (r.indexOf(true) !== -1) return true;
          return r.indexOf(null) !== -1 ? null : false; // dúvida não vira "esgotado"... nem "à venda"
        });
      })
      .catch(function () { return null; })
      .then(function (v) { if (v !== null) gravarCache(handle, v); return v; });
    return pendentes[handle];
  }

  function reabrir(card) {
    card.classList.remove('ame-card--sold-out');
    var pill = card.querySelector('.ame-card__badge-pill--sold-out');
    var desc = card.getAttribute('data-grupo-desconto');
    if (pill) {
      if (desc) {
        pill.className = 'ame-card__badge-pill ame-card__badge-pill--discount';
        pill.textContent = desc + '% OFF';
        pill.setAttribute('aria-label', desc + '% de desconto');
      } else {
        pill.remove();
      }
    }
    var btn = card.querySelector('.ame-card__buy-btn--sold-out');
    if (btn) {
      var cta = card.getAttribute('data-grupo-cta') || 'Comprar';
      btn.classList.remove('ame-card__buy-btn--sold-out');
      btn.textContent = cta;
      btn.setAttribute('aria-label', cta + ': ' + (card.getAttribute('data-grupo-titulo') || ''));
    }
  }

  function processar() {
    var cards = document.querySelectorAll('[data-product-card][data-grupo-handle]:not([data-grupo-visto])');
    Array.prototype.forEach.call(cards, function (card) {
      card.setAttribute('data-grupo-visto', '1');
      var handle = card.getAttribute('data-grupo-handle');
      algumaCorAVenda(handle).then(function (v) { if (v === true) reabrir(card); });
    });
  }

  var t;
  function agendar() { clearTimeout(t); t = setTimeout(processar, 150); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', processar);
  else processar();
  // Coleção paginada / busca / "ver mais" injetam cards depois do load.
  if ('MutationObserver' in window) {
    new MutationObserver(agendar).observe(document.body || document.documentElement, { childList: true, subtree: true });
  }
})();
