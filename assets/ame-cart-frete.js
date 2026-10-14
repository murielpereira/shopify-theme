/* Calculadora de frete da gaveta do carrinho (snippets/cart-shipping-calculator.liquid).
   Era script inline renderizado em toda página junto da gaveta; agora carrega
   com defer. Escuta ame:cart-refreshed (disparado pelo ame-theme.js) — como
   roda antes dele, o listener já está de pé no primeiro refresh. */

(function () {
  'use strict';
  const host = document.querySelector('[data-cart-freight]');
  if (!host || host.dataset.init) return;
  host.dataset.init = '1';

  const STORAGE_KEY = 'ame:cep';
  const form        = host.querySelector('[data-cart-freight-form]');
  const input       = host.querySelector('[data-cart-freight-input]');
  const btn         = host.querySelector('[data-cart-freight-submit]');
  const btnLabel    = host.querySelector('[data-cart-freight-btn-label]');
  const resultsEl   = host.querySelector('[data-cart-freight-results]');
  const errorEl     = host.querySelector('[data-cart-freight-error]');

  // Máscara simples 00000-000
  function maskCep(v) {
    const d = String(v || '').replace(/\D/g, '').slice(0, 8);
    if (d.length > 5) return d.slice(0, 5) + '-' + d.slice(5);
    return d;
  }
  let debounceTimer = null;
  input.addEventListener('input', () => {
    input.value = maskCep(input.value);
    const digits = input.value.replace(/\D/g, '');
    // Esconde cotações e total enquanto CEP estiver incompleto (< 8 dígitos).
    // Isso cobre tanto "apagou tudo" quanto "apagou parcialmente" — o frete
    // antigo NUNCA permanece visível ao mudar o CEP. Quando o cliente
    // completar 8 dígitos e clicar Calcular, os novos dados aparecem.
    if (digits.length < 8) {
      // Invalida a cotação em voo: sem isso a resposta de um CEP que a
      // cliente já apagou voltava e repintava a lista.
      reqToken++;
      resultsEl.hidden = true;
      if (digits.length === 0) {
        resultsEl.innerHTML = '';
        currentRates = [];
        clearMessages();
      }
    }
    // Atualiza a barra de frete grátis dinamicamente ao digitar — quando
    // o cliente colocar pelo menos 2 dígitos (suficiente pra inferir UF).
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => updateShippingBar(input.value), 200);
  });

  function fmtMoney(value) {
    // Shopify retorna o price como STRING decimal (ex: "12.50") em vez
    // de cents. Normaliza pra centavos pra usar nosso formatter.
    const n = typeof value === 'string' ? parseFloat(value.replace(',', '.')) : Number(value);
    if (!isFinite(n)) return '—';
    return 'R$ ' + n.toFixed(2).replace('.', ',');
  }

  // Formata data ISO ou Date object em "segunda 06/07" (BRL, dia da
  // semana sem "-feira"). Retorna null se data inválida.
  function fmtDataEntrega(input) {
    if (!input) return null;
    const dt = input instanceof Date ? input : new Date(input);
    if (isNaN(dt.getTime())) return null;
    const weekday = dt.toLocaleDateString('pt-BR', { weekday: 'long' });
    // "segunda-feira" → "segunda"; "sábado" continua "sábado"
    const dayName = weekday.split('-')[0];
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    return dayName + ' ' + dd + '/' + mm;
  }

  // Soma N dias úteis (pulando sábado/domingo) a partir de hoje. Não
  // considera feriados — a SmartEnvios já faz isso no cálculo deles
  // (o número que vem é "X dias úteis" já com isso embutido).
  function addBusinessDays(days) {
    const dt = new Date();
    let added = 0;
    while (added < days) {
      dt.setDate(dt.getDate() + 1);
      const d = dt.getDay();
      if (d !== 0 && d !== 6) added++;
    }
    return dt;
  }

  // Extrai número de dias úteis de strings tipo "13 dias úteis",
  // "5-7 dias", "3 a 5 dias". Retorna { min, max } ou null.
  function parseDiasUteis(str) {
    if (!str) return null;
    const s = String(str).toLowerCase();
    // Range: "5-7 dias" ou "3 a 5 dias úteis"
    const range = s.match(/(\d+)\s*(?:-|a|até)\s*(\d+)\s*dia/);
    if (range) return { min: parseInt(range[1], 10), max: parseInt(range[2], 10) };
    // Single: "13 dias úteis"
    const single = s.match(/(\d+)\s*dia/);
    if (single) { const n = parseInt(single[1], 10); return { min: n, max: n }; }
    return null;
  }

  function fmtPrazo(rate) {
    // 1. delivery_range = [dataMin, dataMax] em ISO — formato preferencial.
    if (Array.isArray(rate.delivery_range) && rate.delivery_range.length === 2
        && rate.delivery_range[0]) {
      const min = fmtDataEntrega(rate.delivery_range[0]);
      const max = fmtDataEntrega(rate.delivery_range[1]);
      if (min && max && min !== max) return 'Chega entre ' + min + ' e ' + max;
      if (min) return 'Chega ' + min;
    }
    // 2. delivery_date (data única) — "Chega quinta 25/06"
    if (rate.delivery_date) {
      const d = fmtDataEntrega(rate.delivery_date);
      if (d) return 'Chega ' + d;
    }
    // 3. delivery_days [min, max] (cotação retornou dias mas não data) —
    //    SOMA ao dia atual (pulando finais de semana) e formata como data.
    const days = rate.delivery_days || rate.delivery_range_days;
    if (Array.isArray(days) && days.length === 2 && days[0] != null) {
      const minDt = fmtDataEntrega(addBusinessDays(days[0]));
      const maxDt = fmtDataEntrega(addBusinessDays(days[1]));
      if (minDt && maxDt && minDt !== maxDt) return 'Chega entre ' + minDt + ' e ' + maxDt;
      if (minDt) return 'Chega ' + minDt;
    }
    if (typeof days === 'number') {
      const d = fmtDataEntrega(addBusinessDays(days));
      if (d) return 'Chega ' + d;
    }
    // 4. Fallback pra `description` — Carrier Service externa (SmartEnvios)
    //    coloca texto livre tipo "13 dias úteis". Parseia e calcula data.
    if (rate.description && typeof rate.description === 'string') {
      const parsed = parseDiasUteis(rate.description);
      if (parsed) {
        const minDt = fmtDataEntrega(addBusinessDays(parsed.min));
        const maxDt = fmtDataEntrega(addBusinessDays(parsed.max));
        if (minDt && maxDt && minDt !== maxDt) return 'Chega entre ' + minDt + ' e ' + maxDt;
        if (minDt) return 'Chega ' + minDt;
      }
      // Não conseguiu parsear — mostra o texto cru
      return rate.description.trim();
    }
    return '';
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    resultsEl.hidden = true;
  }
  function clearMessages() {
    errorEl.hidden = true;
    errorEl.textContent = '';
  }

  function setLoading(isLoading) {
    btn.disabled = isLoading;
    btn.classList.toggle('is-loading', isLoading);
    btn.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    // Texto fica sempre "Calcular" — o spinner CSS (.is-loading::after)
    // aparece por cima. Antes trocávamos por "Calculando..." que estourava
    // a largura do botão em telas estreitas.
    btnLabel.textContent = 'Calcular';
  }

  // Chave estável de uma rate pra persistir seleção entre sessões mesmo
  // se a ordem mudar. Combina nome + preço (suficiente pra distinguir).
  function rateKey(rate) {
    return (rate.name || rate.source || '') + '|' + rate.price;
  }

  // Remove sufixos de provedor do nome da transportadora pra deixar só
  // o nome real. Ex: "J&T Express via SmartEnvios" → "J&T Express".
  function sanitizeRateName(name) {
    if (!name) return name;
    return String(name)
      .replace(/\s*[-–|]?\s*via\s+smartenvios\s*$/i, '')
      .replace(/\s*[-–|]?\s*smartenvios\s*$/i, '')
      .trim();
  }

  // Estima dias úteis de uma rate pra ordenar por velocidade. Retorna
  // Infinity se não há info de prazo (cai pro fim do ranking).
  function rateMinDays(rate) {
    // 1. delivery_days [min, max]
    if (Array.isArray(rate.delivery_days) && rate.delivery_days.length > 0 && rate.delivery_days[0] != null) {
      return Number(rate.delivery_days[0]);
    }
    // 2. delivery_range — calcula diferença de hoje
    if (Array.isArray(rate.delivery_range) && rate.delivery_range.length > 0 && rate.delivery_range[0]) {
      const dt = new Date(rate.delivery_range[0]);
      if (!isNaN(dt.getTime())) {
        const diffMs = dt.getTime() - Date.now();
        return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
      }
    }
    // 3. delivery_date
    if (rate.delivery_date) {
      const dt = new Date(rate.delivery_date);
      if (!isNaN(dt.getTime())) {
        const diffMs = dt.getTime() - Date.now();
        return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
      }
    }
    // 4. description tipo "13 dias úteis"
    if (rate.description) {
      const parsed = parseDiasUteis(rate.description);
      if (parsed) return parsed.min;
    }
    return Infinity;
  }

  // Cache local da lista atual de rates — usado quando o user clica
  // num card pra atualizar o display sem refazer a request.
  let currentRates = [];

  // Número da cotação da vez. Toda chamada de `calcular` pega o próximo e
  // só pinta a tela se ainda for o último — resposta de cotação velha
  // (cliente removeu dois itens seguidos) é descartada em vez de
  // sobrescrever a nova.
  let reqToken = 0;

  // Carrinho mudou → a cotação na tela virou mentira. Some na hora; com
  // `loading` fica o aviso de atualizando no lugar (sem pular layout)
  // enquanto a nova cotação não chega.
  function invalidateRates(loading) {
    currentRates = [];
    if (loading) {
      resultsEl.innerHTML =
        '<li class="ame-cart-freight__result ame-cart-freight__result--loading">Atualizando cotação…</li>';
      resultsEl.hidden = false;
    } else {
      resultsEl.innerHTML = '';
      resultsEl.hidden = true;
    }
  }

  function renderRates(rates) {
    if (!rates || rates.length === 0) {
      showError('Nenhuma opção de entrega disponível para este CEP.');
      currentRates = [];
      return;
    }
    // Ordena por preço crescente — mais barato primeiro
    const sorted = [...rates].sort((a, b) =>
      parseFloat(a.price) - parseFloat(b.price)
    );
    currentRates = sorted;

    // Identifica idx de "mais barato" (sempre 0 após sort) e "mais rápido"
    // (menor rateMinDays). Pode ser o mesmo card. Empate de prazo: mantém
    // o primeiro encontrado (que é o mais barato entre os empatados).
    const cheapestIdx = 0;
    let fastestIdx = 0;
    let fastestDays = rateMinDays(sorted[0]);
    for (let i = 1; i < sorted.length; i++) {
      const d = rateMinDays(sorted[i]);
      if (d < fastestDays) { fastestDays = d; fastestIdx = i; }
    }

    resultsEl.innerHTML = sorted.map((rate, i) => {
      const nomeOrig = rate.presentment_name || rate.name || rate.source || 'Frete';
      const nome  = sanitizeRateName(nomeOrig);
      const preco = parseFloat(rate.price) === 0 ? 'Grátis' : fmtMoney(rate.price);
      const prazo = fmtPrazo(rate);
      const tags = [];
      if (i === cheapestIdx) tags.push('<span class="ame-cart-freight__tag ame-cart-freight__tag--cheap">Mais barato</span>');
      if (i === fastestIdx && fastestIdx !== cheapestIdx) tags.push('<span class="ame-cart-freight__tag ame-cart-freight__tag--fast">Mais rápido</span>');
      if (i === fastestIdx && fastestIdx === cheapestIdx) {
        // Mesma rate é a mais barata E mais rápida — substitui o tag por um destacado
        tags[0] = '<span class="ame-cart-freight__tag ame-cart-freight__tag--best">Melhor opção</span>';
      }
      // Cards são apenas informativos — o cliente escolhe o frete de fato
      // no checkout. Sem <button>, radio, aria-pressed ou handler de click.
      return `
        <li class="ame-cart-freight__result" data-rate-idx="${i}">
          <div class="ame-cart-freight__result-info">
            <div class="ame-cart-freight__result-top">
              <span class="ame-cart-freight__result-name">${escapeHtml(nome)}</span>
              <strong class="ame-cart-freight__result-price">${escapeHtml(preco)}</strong>
            </div>
            ${prazo ? `<div class="ame-cart-freight__result-prazo">${escapeHtml(prazo)}</div>` : ''}
            ${tags.length ? `<div class="ame-cart-freight__tags">${tags.join('')}</div>` : ''}
          </div>
        </li>
      `;
    }).join('');
    resultsEl.hidden = false;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // Shopify Ajax: precisa de items no cart. Verifica antes.
  function cartHasItems() {
    const countEl = document.querySelector('[data-cart-count]');
    if (countEl && countEl.textContent) {
      const n = parseInt(countEl.textContent, 10);
      if (!isNaN(n)) return n > 0;
    }
    // Fallback: presença de items na lista
    return !!document.querySelector('.ame-cart-item');
  }

  // ── Barra de frete grátis dinâmica ──
  // Detecta região via prefixo do CEP e atualiza a barra com o threshold
  // correspondente. SUL/SE = 01-39 (SP, RJ, ES, MG) + 80-99 (PR, SC, RS).
  function regionFromCep(cep) {
    const digits = String(cep).replace(/\D/g, '');
    if (digits.length < 2) return null;
    const prefix = parseInt(digits.slice(0, 2), 10);
    if (isNaN(prefix)) return null;
    const isRegional = (prefix >= 1 && prefix <= 39) || (prefix >= 80 && prefix <= 99);
    return isRegional ? 'regional' : 'nacional';
  }

  // Mapeia CEP → UF do Brasil. A Shopify Ajax exige `shipping_address[province]`
  // (sem isso retorna 422 "Selecione um estado"). Tabela completa baseada
  // nos blocos dos Correios. Returns sigla ISO (SP, RJ, ...) ou null.
  function ufFromCep(cep) {
    const d = String(cep).replace(/\D/g, '');
    if (d.length < 5) return null;
    const n = parseInt(d.slice(0, 5), 10);
    if (isNaN(n)) return null;
    if (n <= 19999) return 'SP';
    if (n <= 28999) return 'RJ';
    if (n <= 29999) return 'ES';
    if (n <= 39999) return 'MG';
    if (n <= 48999) return 'BA';
    if (n <= 49999) return 'SE';
    if (n <= 56999) return 'PE';
    if (n <= 57999) return 'AL';
    if (n <= 58999) return 'PB';
    if (n <= 59999) return 'RN';
    if (n <= 63999) return 'CE';
    if (n <= 64999) return 'PI';
    if (n <= 65999) return 'MA';
    if (n <= 68899) return 'PA';
    if (n <= 68999) return 'AP';
    if (n <= 69299) return 'AM';
    if (n <= 69399) return 'RR';
    if (n <= 69899) return 'AM';
    if (n <= 69999) return 'AC';
    if (n <= 72799) return 'DF';
    if (n <= 72999) return 'GO';
    if (n <= 73699) return 'DF';
    if (n <= 76799) return 'GO';
    if (n <= 76999) return 'RO';
    if (n <= 77999) return 'TO';
    if (n <= 78899) return 'MT';
    if (n <= 78999) return 'RO';
    if (n <= 79999) return 'MS';
    if (n <= 87999) return 'PR';
    if (n <= 89999) return 'SC';
    if (n <= 99999) return 'RS';
    return null;
  }

  // Total do carrinho em centavos, guardado do `ame:cart-refreshed` (o
  // cart oficial da Ajax API). Null = ainda não houve mudança nesta página.
  let cartTotalCents = null;

  function getCartTotalCents() {
    // 1. cart da última mudança — sempre o valor mais novo.
    if (cartTotalCents != null) return cartTotalCents;
    // 2. subtotal renderizado no drawer (theme.liquid atualiza esse nó).
    const subtotalEl = document.querySelector('[data-cart-subtotal]');
    if (subtotalEl) {
      // "R$ 1.820,50" → 182050
      const txt = subtotalEl.textContent || '';
      const digits = txt.replace(/[^\d,]/g, '').replace(',', '.');
      const reais = parseFloat(digits);
      if (!isNaN(reais)) return Math.round(reais * 100);
    }
    // 3. meta global — só existe se algum app de terceiro criar, e costuma
    //    ficar presa no valor do carregamento da página. Último recurso.
    if (window.Shopify?.cart?.total_price != null) return window.Shopify.cart.total_price;
    return 0;
  }

  function updateShippingBar(cep) {
    const bar = document.querySelector('[data-shipping-bar]');
    if (!bar) return;
    // Carrinho vazio: não há progresso nenhum pra mostrar.
    if (!cartHasItems()) {
      bar.setAttribute('hidden', '');
      return;
    }
    const tRegional = parseInt(bar.dataset.tRegional, 10) || 30000;
    const tNacional = parseInt(bar.dataset.tNacional, 10) || 50000;
    // Sem CEP completo não dá pra saber a região: vale o teto regional, o
    // mesmo que o cart-drawer.liquid usa no render inicial. A barra segue
    // visível (é o incentivo) e fica exata assim que o CEP chega.
    const digits = String(cep || '').replace(/\D/g, '');
    const region = digits.length === 8 ? regionFromCep(digits) : null;
    const threshold = region === 'nacional' ? tNacional : tRegional;

    bar.dataset.currentThreshold = threshold;
    const cartCents = getCartTotalCents();
    const remaining = Math.max(0, threshold - cartCents);
    const progress = Math.min(100, Math.round(cartCents * 100 / threshold));

    const textEl = bar.querySelector('[data-shipping-bar-text]');
    const fillEl = bar.querySelector('[data-shipping-bar-fill]');
    if (fillEl) fillEl.style.width = progress + '%';
    bar.removeAttribute('hidden');
    if (!textEl) return;
    if (cartCents >= threshold) {
      textEl.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true" style="font-size:0.95rem;vertical-align:middle;">local_shipping</span> Você ganhou <strong>frete grátis</strong>!';
    } else {
      const remainingFmt = 'R$ ' + (remaining / 100).toFixed(2).replace('.', ',');
      // "(sua região)" só quando a região é conhecida de verdade.
      textEl.innerHTML = 'Faltam <strong>' + escapeHtml(remainingFmt)
        + '</strong> para <strong>frete grátis</strong>' + (region ? ' (sua região)' : '');
    }
  }

  // ── Wrapper XHR (Promise) ──
  function xhrRequest(method, url, options) {
    options = options || {};
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.setRequestHeader('Accept', 'application/json');
      if (options.contentType) xhr.setRequestHeader('Content-Type', options.contentType);
      xhr.timeout = options.timeout || 12000;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch (e) { resolve({}); }
        } else {
          const err = new Error('HTTP ' + xhr.status);
          err.status = xhr.status;
          err.body = xhr.responseText;
          reject(err);
        }
      };
      xhr.onerror = () => reject(new Error('Network'));
      xhr.ontimeout = () => reject(new Error('Timeout'));
      xhr.send(options.body || null);
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Cálculo via prepare + async (correto pra Carrier Service externa
  // como a SmartEnvios). O endpoint síncrono /cart/shipping_rates.json
  // não funciona com Carrier Service que faz HTTP em runtime. ──
  async function calcular(cep) {
    const digits = String(cep || '').replace(/\D/g, '');
    if (digits.length !== 8) {
      showError('CEP inválido. Use o formato 00000-000.');
      return;
    }
    if (!cartHasItems()) {
      showError('Adicione um produto ao carrinho pra calcular o frete.');
      return;
    }

    clearMessages();
    setLoading(true);
    const meuToken = ++reqToken;

    const uf = ufFromCep(digits);
    if (!uf) {
      setLoading(false);
      showError('CEP fora do Brasil.');
      return;
    }

    const addrParams = 'shipping_address%5Bzip%5D=' + encodeURIComponent(digits)
      + '&shipping_address%5Bcountry%5D=Brazil'
      + '&shipping_address%5Bprovince%5D=' + encodeURIComponent(uf);

    try {
      // 1. POST /cart/prepare_shipping_rates.json — dispara cálculo
      await xhrRequest('POST', '/cart/prepare_shipping_rates.json?' + addrParams, {
        contentType: 'application/x-www-form-urlencoded',
      });

      // 2. Polling no async — até 10 tentativas (200ms cada = 2s total)
      let rates = null;
      for (let i = 0; i < 10; i++) {
        await sleep(300);
        if (meuToken !== reqToken) return; // outra cotação assumiu
        try {
          const data = await xhrRequest('GET', '/cart/async_shipping_rates.json?' + addrParams);
          if (data.shipping_rates) {
            rates = data.shipping_rates;
            break;
          }
        } catch (e) {
          if (e.status === 422) throw e; // propaga erro de CEP inválido
          // outros erros: tenta de novo
        }
      }

      if (meuToken !== reqToken) return;
      setLoading(false);
      if (!rates) {
        showError('Cálculo demorou demais. Tente novamente em alguns segundos.');
        return;
      }
      renderRates(rates);
      // Também dispara a barra de frete grátis — agora com o CEP válido
      // que acabou de ser calculado. Sem isso a barra ficava `hidden`
      // porque só o input `oninput` chamava updateShippingBar, não o submit.
      updateShippingBar(digits);
      try { localStorage.setItem(STORAGE_KEY, digits); } catch (_) {}
    } catch (err) {
      if (meuToken !== reqToken) return;
      setLoading(false);
      if (err.status === 422) {
        try {
          const obj = JSON.parse(err.body);
          const msg = obj.shipping_address || obj.zip || obj.country || 'CEP inválido ou sem cobertura.';
          showError(Array.isArray(msg) ? msg.join(' ') : String(msg));
        } catch (_) {
          showError('CEP inválido ou sem cobertura.');
        }
        return;
      }
      console.error('[Frete]', err);
      showError('Não foi possível calcular o frete agora. Tente novamente.');
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    calcular(input.value);
  });

  // Carrinho mudou (add, remover, qty): barra e cotação passam a mostrar
  // um carrinho que não existe mais. A barra é conta local, recalcula na
  // hora; a cotação depende do servidor, então some e volta quando chega.
  function onCartChanged(cart) {
    cartTotalCents = cart && typeof cart.total_price === 'number' ? cart.total_price : null;

    // Carrinho vazio: não há o que cotar. A barra some (o drawer troca o
    // corpo pelo estado vazio, daí a guarda) e a lista zera.
    if (cart && cart.item_count === 0) {
      reqToken++;
      setLoading(false);
      clearMessages();
      invalidateRates(false);
      const bar = document.querySelector('[data-shipping-bar]');
      if (bar) bar.setAttribute('hidden', '');
      return;
    }

    updateShippingBar(input.value);

    const digits = input.value.replace(/\D/g, '');
    if (digits.length === 8) {
      invalidateRates(true);
      calcular(digits);
    } else {
      invalidateRates(false);
    }
  }

  // O drawer dispara `ame:cart-refreshed` em TODA mudança do carrinho,
  // inclusive as dos botões internos (qty +/−, remover), que chamam a
  // closure `refreshDrawer` direto (vide assets/ame-theme.js).
  //
  // Aqui existia um monkey-patch em window.AmeCart.refresh que nunca
  // rodava: este script é inline no render do drawer, que vem ANTES do
  // bloco que cria window.AmeCart — e, mesmo instalado, os botões de
  // remover/qty não passam por ele. Resultado: tirar item do carrinho
  // deixava "frete grátis" na barra e na cotação até clicar em Calcular.
  document.addEventListener('ame:cart-refreshed', (e) => {
    onCartChanged(e && e.detail ? e.detail.cart : null);
  });

  // Expõe globalmente (compat com módulos que chamavam estas funções)
  window.__ameUpdateShippingBar = updateShippingBar;
  window.__ameRecotarFrete = calcular;

  // Restaura CEP salvo entre sessões e auto-calcula (se houver items)
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && /^\d{8}$/.test(saved)) {
      input.value = maskCep(saved);
      updateShippingBar(saved); // atualiza barra com região do CEP salvo
      if (cartHasItems()) calcular(saved);
    } else {
      updateShippingBar(''); // recalcula com cart atual (sem CEP)
    }
  } catch (_) {
    updateShippingBar('');
  }
})();
