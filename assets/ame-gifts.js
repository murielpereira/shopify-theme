/* Âme — Brindes automáticos.
 *
 * Detecta regras de brinde cadastradas no Waltz e mantém o carrinho em
 * sincronia com elas. Em CADA mudança no cart (add/remove/qty change),
 * reavalia todas as regras.
 *
 * Dois modos por regra:
 *
 * 1. VARIANTE FIXA (regra.brinde_variant_id preenchido)
 *    - Condição satisfeita + brinde NÃO no cart → adiciona automaticamente
 *    - Condição não satisfeita + brinde no cart → remove automaticamente
 *    - Item no cart fica bloqueado pra alteração (gerenciado pelo drawer)
 *
 * 2. CLIENTE ESCOLHE (regra.brinde_variant_id NULL)
 *    - Condição satisfeita + brinde NÃO no cart → injeta CARD DE SELEÇÃO
 *      no drawer com as variantes do produto-brinde. Cliente clica numa
 *      variante e em "Resgatar". Só então o item entra no cart.
 *    - Condição não satisfeita: remove o brinde se já estiver no cart,
 *      esconde card de seleção.
 *
 * Tipos de gatilho: 'produto', 'valor_minimo', 'colecao'
 *
 * Preço zerado: responsabilidade do Desconto Automático Shopify
 * (criado/gerenciado pelo Waltz via GraphQL Admin API).
 *
 * Usa XHR (não fetch) — Microsoft Clarity sobrescreve window.fetch.
 */
(function () {
    'use strict';

    if (window.__ameGiftsLoaded) return;
    window.__ameGiftsLoaded = true;

    const WALTZ_BASE = 'https://waltz.up.railway.app';
    const PROP_REGRA_ID = '_brinde_regra_id';
    const PROP_BRINDE_FLAG = '_brinde';

    let _regrasCache = null;
    let _variantsCache = new Map(); // handle → produto completo do Waltz
    let _aplicandoMudancas = false;
    let _pendingReavaliacao = false; // se chamado durante execução, roda de novo no fim
    let _seletoresState = new Map(); // regra_id → variant_id selecionada (em memória, sem persist)

    // ─── XHR helper ───
    function xhrJson(url, method, body) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(method || 'GET', url, true);
            xhr.setRequestHeader('Accept', 'application/json');
            if (body) xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            xhr.timeout = 10000;
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { resolve(JSON.parse(xhr.responseText || '{}')); }
                    catch (e) { reject(e); }
                } else {
                    reject(new Error('HTTP ' + xhr.status));
                }
            };
            xhr.onerror = () => reject(new Error('Network'));
            xhr.ontimeout = () => reject(new Error('Timeout'));
            xhr.send(body ? JSON.stringify(body) : null);
        });
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function toast(msg) {
        if (typeof window.AmePdpToast === 'function') return window.AmePdpToast(msg);
        let el = document.getElementById('ame-gift-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'ame-gift-toast';
            el.style.cssText = 'position:fixed;top:1rem;left:50%;transform:translateX(-50%);background:#5a7461;color:#fff;padding:0.625rem 1rem;border-radius:8px;font-size:0.875rem;font-weight:500;box-shadow:0 8px 24px rgba(0,0,0,0.18);z-index:10000;opacity:0;transition:opacity 0.25s ease;pointer-events:none';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.style.opacity = '1';
        clearTimeout(el._timer);
        el._timer = setTimeout(() => { el.style.opacity = '0'; }, 3500);
    }

    // ─── Avaliação de condição ───
    function regraSatisfeita(regra, cart) {
        const items = cart.items || [];
        const itensReais = items.filter(it => !((it.properties || {})[PROP_REGRA_ID]));
        if (regra.tipo_gatilho === 'produto') {
            const triggerId = Number(regra.gatilho_produto_id);
            return itensReais.some(it => Number(it.product_id) === triggerId);
        }
        if (regra.tipo_gatilho === 'valor_minimo') {
            const subtotal = itensReais.reduce((acc, it) =>
                acc + (it.final_line_price != null ? it.final_line_price : it.line_price), 0);
            return subtotal >= Number(regra.gatilho_valor_minimo_cents);
        }
        if (regra.tipo_gatilho === 'colecao') {
            // TODO V2: precisa lookup de collections por item (via Waltz/produto)
            return false;
        }
        return false;
    }

    function brindeNoCart(cart, regra) {
        return (cart.items || []).find(it => {
            const props = it.properties || {};
            return String(props[PROP_REGRA_ID]) === String(regra.id);
        });
    }

    // ─── Operações cart ───
    async function adicionarBrinde(regra, variantId) {
        await xhrJson('/cart/add.js', 'POST', {
            items: [{
                id: Number(variantId),
                quantity: 1,
                properties: {
                    [PROP_REGRA_ID]: String(regra.id),
                    [PROP_BRINDE_FLAG]: 'Brinde Incluído',
                },
            }],
        });
    }
    async function removerBrinde(item) {
        await xhrJson('/cart/change.js', 'POST', { id: item.key, quantity: 0 });
    }

    // ─── Variants do produto-brinde (lazy load via Waltz) ───
    async function carregarProdutoBrinde(handle) {
        if (!handle) return null;
        if (_variantsCache.has(handle)) return _variantsCache.get(handle);
        try {
            const produto = await xhrJson(`${WALTZ_BASE}/api/public/produto/${encodeURIComponent(handle)}`);
            _variantsCache.set(handle, produto);
            return produto;
        } catch (e) {
            console.warn('[Brindes] falha carregando produto-brinde', handle, e.message);
            _variantsCache.set(handle, null);
            return null;
        }
    }

    // ─── Render do CARD DE SELEÇÃO no drawer ───
    function renderCardSelecao(regra, produto) {
        const variantsDisponiveis = (produto.variants || []).filter(v => v.available !== false);
        if (!variantsDisponiveis.length) return '';

        // Botões de variante — usa título da variante (ex: "Coração / P / Ouro")
        const selectedId = _seletoresState.get(regra.id);
        const variantBtns = variantsDisponiveis.map(v => `
            <button type="button"
                class="ame-gift-selector__variant${String(v.id) === String(selectedId) ? ' is-active' : ''}"
                data-gift-variant="${esc(v.id)}"
                aria-pressed="${String(v.id) === String(selectedId) ? 'true' : 'false'}">
                ${esc(v.title || ('Variante ' + v.id))}
            </button>
        `).join('');

        const img = produto.featured_image
            ? `<img class="ame-gift-selector__img" src="${esc(produto.featured_image)}" alt="" loading="lazy">`
            : '';

        return `
            <li class="ame-gift-selector" data-gift-selector data-gift-regra-id="${esc(regra.id)}" data-gift-handle="${esc(produto.handle)}">
                <header class="ame-gift-selector__head">
                    <span class="material-symbols-outlined ame-gift-selector__icon" aria-hidden="true">card_giftcard</span>
                    <div class="ame-gift-selector__head-text">
                        <p class="ame-gift-selector__eyebrow">Você ganhou um brinde</p>
                        <p class="ame-gift-selector__title">${esc(produto.title || regra.brinde_titulo || 'Brinde')}</p>
                    </div>
                </header>
                <div class="ame-gift-selector__body">
                    ${img}
                    <div class="ame-gift-selector__choices">
                        <p class="ame-gift-selector__label">Escolha sua variação:</p>
                        <div class="ame-gift-selector__variants">${variantBtns}</div>
                    </div>
                </div>
                <button type="button" class="ame-gift-selector__add" data-gift-add ${selectedId ? '' : 'disabled'}>
                    ${selectedId ? 'Resgatar meu brinde' : 'Escolha uma variação acima'}
                </button>
            </li>
        `;
    }

    // ─── Click delegation pros cards de seleção (uma vez) ───
    let _delegationBound = false;
    function bindCardClicks() {
        if (_delegationBound) return;
        _delegationBound = true;

        document.addEventListener('click', async (e) => {
            // Selecionar variante
            const variantBtn = e.target.closest('[data-gift-variant]');
            if (variantBtn) {
                const card = variantBtn.closest('[data-gift-selector]');
                const regraId = card?.dataset.giftRegraId;
                const variantId = variantBtn.dataset.giftVariant;
                if (!regraId || !variantId) return;
                _seletoresState.set(regraId, variantId);
                // Atualiza UI in-place — chamar renderizarTodosCards() sem args
                // removia o card e não re-renderizava (o brinde sumia).
                card.querySelectorAll('[data-gift-variant]').forEach(b => {
                    const sel = b.dataset.giftVariant === variantId;
                    b.classList.toggle('is-active', sel);
                    b.setAttribute('aria-pressed', sel ? 'true' : 'false');
                });
                const addBtn = card.querySelector('[data-gift-add]');
                if (addBtn) {
                    addBtn.disabled = false;
                    addBtn.textContent = 'Resgatar meu brinde';
                }
                return;
            }

            // Resgatar brinde (botão final)
            const addBtn = e.target.closest('[data-gift-add]');
            if (addBtn) {
                const card = addBtn.closest('[data-gift-selector]');
                const regraId = card?.dataset.giftRegraId;
                if (!regraId) return;
                const variantId = _seletoresState.get(regraId);
                if (!variantId) return;
                const regra = (_regrasCache || []).find(r => String(r.id) === String(regraId));
                if (!regra) return;

                addBtn.disabled = true;
                addBtn.textContent = 'Adicionando...';
                try {
                    await adicionarBrinde(regra, variantId);
                    toast('🎁 Brinde adicionado ao seu carrinho!');
                    _seletoresState.delete(regraId);
                    const cartAtualizado = await xhrJson('/cart.js');
                    if (window.AmeCart?.refresh) window.AmeCart.refresh(cartAtualizado);
                } catch (err) {
                    console.warn('[Brindes] falha no resgate', err.message);
                    addBtn.disabled = false;
                    addBtn.textContent = 'Tente novamente';
                }
            }
        });
    }

    // Renderiza/atualiza os cards de seleção dentro do drawer
    function renderizarTodosCards(seletoresPendentes) {
        const drawer = document.querySelector('[data-cart-drawer]') || document.querySelector('#cart-drawer');
        if (!drawer) return;
        const lista = drawer.querySelector('[data-cart-items]');
        if (!lista) return;

        // Remove cards velhos (sempre re-renderiza)
        lista.querySelectorAll('[data-gift-selector]').forEach(el => el.remove());

        if (!seletoresPendentes || !seletoresPendentes.length) return;

        const html = seletoresPendentes.map(({ regra, produto }) => renderCardSelecao(regra, produto)).join('');
        lista.insertAdjacentHTML('beforeend', html);
    }

    // ─── Loop principal: reavalia regras + sincroniza cart ───
    async function reavaliarBrindes(cartInput) {
        // Se já está rodando, marca pra re-rodar no fim em vez de descartar.
        // Cenário: cliente remove item → AmeCart.refresh dispara reavaliação →
        // antes de terminar, outro refresh chega. Sem fila, a 2ª chamada era
        // descartada e o brinde só sumia na próxima ação manual.
        if (_aplicandoMudancas) {
            _pendingReavaliacao = true;
            return;
        }

        // null = fetch das regras falhou (Waltz fora do ar?). Sem fonte de
        // verdade NÃO mexemos no cart — com lista vazia por engano, a varredura
        // de órfãos removeria brindes legítimos de todos os clientes.
        if (!_regrasCache) return;

        _aplicandoMudancas = true;
        try {
            // Evita buscar /cart.js se já recebemos os dados atualizados via evento.
            // Adiciona timestamp para contornar cache agressivo do navegador.
            const cart = cartInput || await xhrJson('/cart.js?t=' + Date.now());
            let mudouCart = false;
            const seletoresPendentes = []; // regras "cliente escolhe" satisfeitas mas sem brinde no cart
            const regrasAtivas = _regrasCache;

            // 1. Limpeza de brindes órfãos: regra desativada/expirada (agendamento)
            //    ou excluída no admin. Sem isso o item ficava preso no cart com
            //    preço cheio (o desconto Shopify morre junto com a regra) e sem
            //    controles de remoção (o drawer tranca itens-brinde).
            //    APENAS itens com _brinde_regra_id (gerenciados por este módulo).
            //    Itens com só a property `Brinde` (ex: pingente cortesia do fluxo
            //    de customização) NÃO são nossos — não tocar.
            for (const item of cart.items || []) {
                const regraId = (item.properties || {})[PROP_REGRA_ID];
                if (!regraId) continue;
                const regraAtiva = regrasAtivas.find(r => String(r.id) === String(regraId));
                if (!regraAtiva) {
                    try {
                        await removerBrinde(item);
                        mudouCart = true;
                    } catch (e) {
                        console.warn('[Brindes] remover brinde órfão falhou', e.message);
                    }
                }
            }

            // 2. Avaliação das regras ativas
            for (const regra of regrasAtivas) {
                const satisfeita = regraSatisfeita(regra, cart);
                const itemPresente = brindeNoCart(cart, regra);
                const clienteEscolhe = !regra.brinde_variant_id;

                if (clienteEscolhe) {
                    // Modo "cliente escolhe variação"
                    if (satisfeita && !itemPresente) {
                        // Carrega variants e prepara card de seleção
                        const produto = await carregarProdutoBrinde(regra.brinde_handle);
                        if (produto) seletoresPendentes.push({ regra, produto });
                    } else if (!satisfeita && itemPresente) {
                        // Condição caiu → remove brinde
                        try {
                            await removerBrinde(itemPresente);
                            mudouCart = true;
                        } catch (e) { console.warn('[Brindes] remover falhou', e.message); }
                    }
                    // satisfeita && presente: nada a fazer (cliente já escolheu)
                    // !satisfeita && !presente: nada a fazer
                } else {
                    // Modo "variante fixa"
                    if (satisfeita && !itemPresente) {
                        try {
                            await adicionarBrinde(regra, regra.brinde_variant_id);
                            toast(`🎁 Você ganhou: ${regra.brinde_titulo || 'Brinde Incluído'}`);
                            mudouCart = true;
                        } catch (e) { console.warn('[Brindes] adicionar falhou', e.message); }
                    } else if (!satisfeita && itemPresente) {
                        try {
                            await removerBrinde(itemPresente);
                            mudouCart = true;
                        } catch (e) { console.warn('[Brindes] remover falhou', e.message); }
                    }
                }
            }

            // Atualiza UI dos seletores no drawer
            renderizarTodosCards(seletoresPendentes);

            // Se mudamos cart, propaga pro drawer (que vai re-renderizar a lista
            // de items — depois disso re-injetamos os seletores no callback do
            // próximo refresh, evitando race condition).
            if (mudouCart) {
                const cartAtualizado = await xhrJson('/cart.js?t=' + Date.now());
                if (window.AmeCart?.refresh) window.AmeCart.refresh(cartAtualizado);
            }
        } catch (e) {
            console.warn('[Brindes] erro na avaliação:', e.message);
        } finally {
            _aplicandoMudancas = false;
            // Se foi solicitado durante execução, re-roda (ex: remover trigger
            // dispara refresh enquanto a primeira reavaliação ainda processa).
            if (_pendingReavaliacao) {
                _pendingReavaliacao = false;
                setTimeout(() => reavaliarBrindes(), 0);
            }
        }
    }

    // ─── Hooks de mudança do cart ───
    // Refresh: escuta o evento `ame:cart-refreshed` que o drawer dispara em
    // TODO refresh — inclusive os handlers internos (qty +/-, remover), que
    // chamam a closure refreshDrawer direto e nunca passavam pelo antigo
    // monkey-patch em window.AmeCart.refresh (por isso o brinde só atualizava
    // após reload da página).
    function instalarHook() {
        document.addEventListener('ame:cart-refreshed', (e) => {
            // Re-avalia após o drawer ter re-renderizado os items — assim
            // os cards de seleção são re-injetados na lista atualizada.
            reavaliarBrindes(e.detail?.cart);
        });

        // Reavalia também quando o drawer abre — caso o cliente entrou na página
        // com o cart já cheio (sem ter passado por refresh ainda).
        wrapOpenQuandoDisponivel();
    }

    function wrapOpenQuandoDisponivel() {
        if (!window.AmeCart || typeof window.AmeCart.open !== 'function') {
            return setTimeout(wrapOpenQuandoDisponivel, 200);
        }
        if (window.AmeCart.__giftsHooked) return;
        window.AmeCart.__giftsHooked = true;
        const openOriginal = window.AmeCart.open;
        window.AmeCart.open = function () {
            const r = openOriginal.apply(this, arguments);
            reavaliarBrindes();
            return r;
        };
    }

    // ─── Init ───
    async function init() {
        try {
            const data = await xhrJson(`${WALTZ_BASE}/api/public/brindes/ativas`);
            _regrasCache = data.regras || [];
        } catch (e) {
            console.warn('[Brindes] fetch de regras falhou (Waltz offline?):', e.message);
            // null (não []): sinaliza "sem fonte de verdade". A reavaliação
            // vira no-op — melhor deixar o cart como está do que remover
            // brindes legítimos porque o Waltz caiu por 30 segundos.
            _regrasCache = null;
        }

        bindCardClicks();
        instalarHook();
        reavaliarBrindes(); // 1ª avaliação (caso cart já tenha conteúdo no load)
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
