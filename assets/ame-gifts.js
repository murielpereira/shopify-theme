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
 * 2b. LISTA DE PRODUTOS (regra.brinde_produtos com itens)
 *    - Variante do modo "cliente escolhe": o card mostra PRIMEIRO os produtos
 *      da lista pra o cliente escolher qual quer. Ao escolher um produto,
 *      carrega as variações dele (lazy, via Waltz) e mostra os botões de
 *      variação. Depois "Resgatar" adiciona o produto+variação escolhidos.
 *    - O desconto Shopify cobre todos os produtos da lista (100% off), então
 *      qualquer escolha sai grátis.
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
    let _seletoresState = new Map(); // regra_id → { handle, variantId } (em memória, sem persist)

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

    // BRL a partir de centavos (ex.: 3000 → "R$ 30,00").
    function money(cents) {
        return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    // Subtotal só dos itens REAIS (exclui os itens-brinde geridos por este módulo)
    // — mesma base que regraSatisfeita usa pro gatilho de valor mínimo.
    function subtotalReal(cart) {
        return (cart.items || [])
            .filter(it => !((it.properties || {})[PROP_REGRA_ID]))
            .reduce((acc, it) => acc + (it.final_line_price != null ? it.final_line_price : it.line_price), 0);
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

    // ─── Faixa (tier) de uma regra ───
    // A Shopify só aplica 1 desconto automático de produto por pedido, então
    // só pode haver 1 brinde no carrinho por vez. Quando o cliente qualifica
    // pra mais de uma regra, vence a de FAIXA MAIOR (maior valor de gatilho) —
    // ela "sobrepõe" as menores. Regras por produto/coleção não têm faixa de
    // valor (tier 0); desempate por id mais recente.
    function tierRegra(regra) {
        if (regra.tipo_gatilho === 'valor_minimo') return Number(regra.gatilho_valor_minimo_cents) || 0;
        return 0;
    }
    function escolherVencedora(satisfeitas) {
        if (!satisfeitas.length) return null;
        return satisfeitas.slice().sort((a, b) => {
            const t = tierRegra(b) - tierRegra(a);
            if (t !== 0) return t;
            return Number(b.id) - Number(a.id);
        })[0];
    }

    // ─── Operações cart ───
    async function adicionarBrinde(regra, variantId, extraProps) {
        const properties = {
            [PROP_REGRA_ID]: String(regra.id),
            [PROP_BRINDE_FLAG]: 'Brinde Incluído',
        };
        if (extraProps) Object.assign(properties, extraProps);
        await xhrJson('/cart/add.js', 'POST', {
            items: [{ id: Number(variantId), quantity: 1, properties }],
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

    // ─── Estado de seleção por regra ───
    // { handle: produto escolhido, variantId: variação escolhida }
    function selState(regraId) {
        const k = String(regraId);
        let s = _seletoresState.get(k);
        if (!s) { s = { handle: null, variantId: null }; _seletoresState.set(k, s); }
        return s;
    }

    // Lista de produtos-brinde da regra (modo lista), ou null (modo único).
    function listaProdutosRegra(regra) {
        let lista = regra.brinde_produtos;
        if (typeof lista === 'string') { try { lista = JSON.parse(lista); } catch (e) { lista = null; } }
        return Array.isArray(lista) && lista.length ? lista : null;
    }

    // Normaliza pra uma lista de { handle, titulo }. Modo único vira lista de 1.
    function produtosDaRegra(regra) {
        const lista = listaProdutosRegra(regra);
        if (lista) return lista.map(p => ({ handle: p.handle, titulo: p.titulo }));
        return [{ handle: regra.brinde_handle, titulo: regra.brinde_titulo }];
    }

    // Subconjunto de variantes permitidas (modo "cliente escolhe entre algumas"),
    // ou null (todas).
    function listaVariantesRegra(regra) {
        let vs = regra && regra.brinde_variantes;
        if (typeof vs === 'string') { try { vs = JSON.parse(vs); } catch (e) { vs = null; } }
        return Array.isArray(vs) && vs.length ? vs.map(String) : null;
    }

    // Variantes disponíveis do produto. Se a regra restringe a um subconjunto
    // (brinde_variantes), filtra só a essas.
    function variantesDisponiveis(produto, regra) {
        let vars = produto ? (produto.variants || []).filter(v => v.available !== false) : [];
        const permitidas = regra ? listaVariantesRegra(regra) : null;
        if (permitidas) vars = vars.filter(v => permitidas.includes(String(v.id)));
        return vars;
    }

    // Se o produto escolhido tem 1 variação só, seleciona automaticamente.
    // Se a variação atual não existe mais no produto, limpa.
    function autoSelVariante(regra) {
        if (isPingenteRegra(regra)) return; // pingente resolve a variante no próprio card
        const s = selState(regra.id);
        if (!s.handle || !_variantsCache.has(s.handle)) return;
        const vars = variantesDisponiveis(_variantsCache.get(s.handle), regra);
        if (vars.length === 1) s.variantId = String(vars[0].id);
        else if (s.variantId && !vars.some(v => String(v.id) === String(s.variantId))) s.variantId = null;
    }

    // ─── Pingente personalizado como brinde (só metal) ───
    // Regra com brinde_pingente=true: o produto-brinde é o pingente de metal e o
    // cliente customiza no carrinho (formato, cor do metal, tamanho, gravação).
    // Porta a resolução de variante do snippet da PDP, sem depender de coleira.
    const PING_FORMATOS = ['Círculo', 'Coração', 'Flor', 'Osso'];
    const PING_FORMATO_ICON = { 'Círculo': '⭕', 'Coração': '❤️', 'Flor': '🌸', 'Osso': '🦴' };

    function isPingenteRegra(regra) {
        const v = regra && regra.brinde_pingente;
        return v === true || v === 't' || v === 'true' || v === 1;
    }
    function normOptName(n) {
        return String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    }
    function pingOptIdx(produto) {
        const names = (produto.options || []).map(o => (typeof o === 'string' ? o : o.name));
        const find = (ms) => names.findIndex(n => {
            const x = normOptName(n);
            return ms.some(m => x === m || x.startsWith(m + ' ') || x.endsWith(' ' + m) || x.includes(' ' + m + ' '));
        });
        return { formato: find(['formato']), metal: find(['cor do metal', 'metal']), tamanho: find(['tamanho', 'size']) };
    }
    // Valores distintos DISPONÍVEIS de uma option (1-based), filtrando por seleções anteriores.
    function pingOptValues(produto, idxPlus1, filterFn) {
        const set = new Set();
        for (const v of (produto.variants || [])) {
            if (v.available === false) continue;
            if (filterFn && !filterFn(v)) continue;
            const val = v['option' + idxPlus1];
            if (val) set.add(val);
        }
        return [...set];
    }
    function pingResolve(produto, idx, formato, metal, tamanho) {
        return (produto.variants || []).find(v => {
            if (v.available === false) return false;
            if (idx.formato !== -1 && formato && v['option' + (idx.formato + 1)] !== formato) return false;
            if (idx.metal !== -1 && metal && v['option' + (idx.metal + 1)] !== metal) return false;
            if (idx.tamanho !== -1 && tamanho && v['option' + (idx.tamanho + 1)] !== tamanho) return false;
            return true;
        }) || null;
    }
    function pingState(regra) {
        const s = selState(regra.id);
        if (!s.p) s.p = { formato: null, metal: null, tamanho: null, pet: '', tutor: '', tel: '' };
        return s;
    }
    // Máscara BR "11 99999-9999" (maxlength 13, igual à PDP)
    function pingMaskTel(v) {
        const d = String(v || '').replace(/\D/g, '').slice(0, 11);
        if (d.length <= 2) return d;
        if (d.length <= 7) return d.slice(0, 2) + ' ' + d.slice(2);
        return d.slice(0, 2) + ' ' + d.slice(2, 7) + '-' + d.slice(7);
    }
    // Remove emoji/símbolos — o conector Shopify→Tiny trunca a observação no 1º
    // caractere astral (emoji), e não dá pra gravar emoji na peça.
    function pingStripEmoji(v) {
        v = String(v == null ? '' : v).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');
        try { v = v.replace(new RegExp('[\\u2190-\\u21FF\\u2300-\\u27BF\\u2600-\\u26FF\\u2B00-\\u2BFF\\uFE00-\\uFE0F\\u200D\\u20E3]', 'g'), ''); } catch (e) { /* no-op */ }
        return v;
    }
    function pingLabelPendente(s, need) {
        if (!s.p.formato) return 'Escolha o formato';
        if (need.metal && !s.p.metal) return 'Escolha a cor do metal';
        if (need.tamanho && !s.p.tamanho) return 'Escolha o tamanho';
        if (!s.p.pet.trim()) return 'Preencha o nome do pet';
        const telDigits = String(s.p.tel || '').replace(/\D/g, '');
        if (telDigits.length > 0 && telDigits.length < 10) return 'Telefone incompleto';
        if (!s.variantId) return 'Combinação indisponível';
        return 'Resgatar meu brinde';
    }

    // ─── Render do CARD DE SELEÇÃO no drawer ───
    // Conteúdo interno do card (head + escolhas + botão). Repintado em cada
    // interação. O <li> externo (data-attrs) é preservado por repaintCard.
    function cardInner(regra) {
        if (isPingenteRegra(regra)) return cardInnerPingente(regra);
        const s = selState(regra.id);
        const produtos = produtosDaRegra(regra);
        const multi = produtos.length > 1;
        if (!multi) s.handle = produtos[0].handle; // único: produto já fixado

        const tituloBrinde = (multi
            ? (regra.brinde_titulo || 'Brinde')
            : (produtos[0].titulo || regra.brinde_titulo || 'Brinde'));

        const head = `
            <header class="ame-gift-selector__head">
                <span class="material-symbols-outlined ame-gift-selector__icon" aria-hidden="true">card_giftcard</span>
                <div class="ame-gift-selector__head-text">
                    <p class="ame-gift-selector__eyebrow">Você ganhou um brinde</p>
                    <p class="ame-gift-selector__title">${esc(tituloBrinde)}</p>
                </div>
            </header>`;

        const blocos = [];

        // 1. Escolha do produto (só no modo lista)
        if (multi) {
            const prodBtns = produtos.map(p => `
                <button type="button"
                    class="ame-gift-selector__variant${s.handle === p.handle ? ' is-active' : ''}"
                    data-gift-produto="${esc(p.handle)}"
                    aria-pressed="${s.handle === p.handle ? 'true' : 'false'}">
                    ${esc(p.titulo || p.handle)}
                </button>`).join('');
            blocos.push(`
                <div class="ame-gift-selector__choices">
                    <p class="ame-gift-selector__label">Escolha seu brinde:</p>
                    <div class="ame-gift-selector__variants">${prodBtns}</div>
                </div>`);
        }

        // 2. Escolha da variação (quando há produto escolhido)
        let img = '';
        if (s.handle) {
            const carregado = _variantsCache.has(s.handle);
            const produto = _variantsCache.get(s.handle);
            if (produto && produto.featured_image) {
                img = `<img class="ame-gift-selector__img" src="${esc(produto.featured_image)}" alt="" loading="lazy">`;
            }
            if (!carregado) {
                blocos.push(`<div class="ame-gift-selector__choices"><p class="ame-gift-selector__label">Carregando variações…</p></div>`);
            } else if (produto) {
                const vars = variantesDisponiveis(produto, regra);
                if (vars.length > 1) {
                    const vbtns = vars.map(v => `
                        <button type="button"
                            class="ame-gift-selector__variant${String(v.id) === String(s.variantId) ? ' is-active' : ''}"
                            data-gift-variant="${esc(v.id)}"
                            aria-pressed="${String(v.id) === String(s.variantId) ? 'true' : 'false'}">
                            ${esc(v.title || ('Variante ' + v.id))}
                        </button>`).join('');
                    blocos.push(`
                        <div class="ame-gift-selector__choices">
                            <p class="ame-gift-selector__label">${multi ? 'Variação:' : 'Escolha sua variação:'}</p>
                            <div class="ame-gift-selector__variants">${vbtns}</div>
                        </div>`);
                } else if (vars.length === 0) {
                    blocos.push(`<div class="ame-gift-selector__choices"><p class="ame-gift-selector__label">Esse brinde está indisponível no momento.</p></div>`);
                }
                // exatamente 1 variação → auto-selecionada, sem UI
            } else {
                blocos.push(`<div class="ame-gift-selector__choices"><p class="ame-gift-selector__label">Não foi possível carregar as variações.</p></div>`);
            }
        }

        const body = `<div class="ame-gift-selector__body">${img}<div class="ame-gift-selector__col">${blocos.join('')}</div></div>`;

        const pronto = !!s.variantId;
        let addLabel;
        if (pronto) addLabel = 'Resgatar meu brinde';
        else if (multi && !s.handle) addLabel = 'Escolha um brinde acima';
        else addLabel = 'Escolha uma variação acima';
        const add = `<button type="button" class="ame-gift-selector__add" data-gift-add ${pronto ? '' : 'disabled'}>${addLabel}</button>`;

        return head + body + add;
    }

    // Card do pingente personalizado — formato, cor do metal, tamanho e gravação.
    function cardInnerPingente(regra) {
        const s = pingState(regra);
        const p = s.p;
        const head = `
            <header class="ame-gift-selector__head">
                <span class="material-symbols-outlined ame-gift-selector__icon" aria-hidden="true">card_giftcard</span>
                <div class="ame-gift-selector__head-text">
                    <p class="ame-gift-selector__eyebrow">Você ganhou um brinde</p>
                    <p class="ame-gift-selector__title">${esc(regra.brinde_titulo || 'Pingente personalizado')}</p>
                </div>
            </header>`;
        const wrap = (inner) => head + `<div class="ame-gift-selector__body"><div class="ame-gift-selector__col">${inner}</div></div>`;

        const handle = regra.brinde_handle;
        if (!_variantsCache.has(handle)) return wrap(`<p class="ame-gift-selector__label">Carregando opções…</p>`);
        const produto = _variantsCache.get(handle);
        if (!produto) return wrap(`<p class="ame-gift-selector__label">Não foi possível carregar o pingente.</p>`);
        const idx = pingOptIdx(produto);
        if (idx.formato === -1) return wrap(`<p class="ame-gift-selector__label">Pingente sem opção "Formato" — verifique o cadastro.</p>`);

        // Formatos disponíveis
        const formatosDisp = PING_FORMATOS.filter(f =>
            (produto.variants || []).some(v => v.available !== false && v['option' + (idx.formato + 1)] === f));
        if (p.formato && !formatosDisp.includes(p.formato)) { p.formato = null; p.metal = null; p.tamanho = null; }

        // Cor do metal (cascata a partir do formato)
        let metaisDisp = [];
        if (idx.metal !== -1 && p.formato) {
            metaisDisp = pingOptValues(produto, idx.metal + 1, v => v['option' + (idx.formato + 1)] === p.formato);
            if (metaisDisp.length === 1) p.metal = metaisDisp[0];               // 1 só → auto
            else if (p.metal && !metaisDisp.includes(p.metal)) p.metal = null;
        }
        const metalPronto = idx.metal === -1 || !!p.metal;

        // Tamanho (cascata a partir de formato + metal)
        let tamsDisp = [];
        if (idx.tamanho !== -1 && p.formato && metalPronto) {
            tamsDisp = pingOptValues(produto, idx.tamanho + 1, v =>
                v['option' + (idx.formato + 1)] === p.formato && (idx.metal === -1 || v['option' + (idx.metal + 1)] === p.metal));
            if (tamsDisp.length === 1) p.tamanho = tamsDisp[0];                  // 1 só → auto
            else if (p.tamanho && !tamsDisp.includes(p.tamanho)) p.tamanho = null;
        }

        // Resolve a variante só quando tudo que o produto exige está escolhido
        const need = { metal: idx.metal !== -1, tamanho: idx.tamanho !== -1 };
        const ready = !!p.formato && (!need.metal || !!p.metal) && (!need.tamanho || !!p.tamanho);
        const variant = ready ? pingResolve(produto, idx, p.formato, need.metal ? p.metal : null, need.tamanho ? p.tamanho : null) : null;
        s.variantId = variant ? String(variant.id) : null;

        const blocos = [];
        blocos.push(`
            <div class="ame-gift-selector__choices">
                <p class="ame-gift-selector__label">Formato:</p>
                <div class="ame-gift-selector__variants">
                    ${formatosDisp.map(f => `
                        <button type="button" class="ame-gift-selector__variant${p.formato === f ? ' is-active' : ''}"
                            data-gift-ping-formato="${esc(f)}" aria-pressed="${p.formato === f ? 'true' : 'false'}">
                            ${PING_FORMATO_ICON[f] || ''} ${esc(f)}
                        </button>`).join('')}
                </div>
            </div>`);
        if (p.formato && idx.metal !== -1 && metaisDisp.length > 1) {
            blocos.push(`
                <div class="ame-gift-selector__choices">
                    <p class="ame-gift-selector__label">Cor do metal:</p>
                    <div class="ame-gift-selector__variants">
                        ${metaisDisp.map(m => `
                            <button type="button" class="ame-gift-selector__variant${p.metal === m ? ' is-active' : ''}"
                                data-gift-ping-metal="${esc(m)}" aria-pressed="${p.metal === m ? 'true' : 'false'}">
                                ${esc(m)}
                            </button>`).join('')}
                    </div>
                </div>`);
        }
        if (p.formato && metalPronto && idx.tamanho !== -1 && tamsDisp.length > 1) {
            blocos.push(`
                <div class="ame-gift-selector__choices">
                    <p class="ame-gift-selector__label">Tamanho:</p>
                    <div class="ame-gift-selector__variants">
                        ${tamsDisp.map(t => `
                            <button type="button" class="ame-gift-selector__variant${p.tamanho === t ? ' is-active' : ''}"
                                data-gift-ping-tam="${esc(t)}" aria-pressed="${p.tamanho === t ? 'true' : 'false'}">
                                ${esc(t)}
                            </button>`).join('')}
                    </div>
                </div>`);
        }
        // Gravação (igual à PDP: pet obrigatório; tutor e telefone opcionais)
        blocos.push(`
            <div class="ame-gift-selector__field">
                <label>Nome do pet <span class="ame-gift-selector__req">*</span></label>
                <input type="text" class="ame-gift-selector__input" maxlength="13" data-gift-ping-field="pet" value="${esc(p.pet)}" placeholder="Ex: Thor">
            </div>
            <div class="ame-gift-selector__field">
                <label>Nome do tutor <small>(opcional)</small></label>
                <input type="text" class="ame-gift-selector__input" maxlength="13" data-gift-ping-field="tutor" value="${esc(p.tutor)}" placeholder="Ex: Maria">
            </div>
            <div class="ame-gift-selector__field">
                <label>Telefone <small>(opcional)</small></label>
                <input type="tel" class="ame-gift-selector__input" maxlength="13" data-gift-ping-field="tel" value="${esc(p.tel)}" placeholder="11 99999-9999">
            </div>`);

        const petOK = p.pet.trim().length > 0;
        const telDigits = String(p.tel || '').replace(/\D/g, '');
        const telOK = telDigits.length === 0 || telDigits.length >= 10;
        const pronto = !!s.variantId && petOK && telOK;
        const label = pronto ? 'Resgatar meu brinde' : pingLabelPendente(s, need);
        const add = `<button type="button" class="ame-gift-selector__add" data-gift-add ${pronto ? '' : 'disabled'}>${esc(label)}</button>`;

        return wrap(blocos.join('')) + add;
    }

    function renderCardSelecao(regra) {
        return `<li class="ame-gift-selector" data-gift-selector data-gift-regra-id="${esc(regra.id)}">${cardInner(regra)}</li>`;
    }

    function repaintCard(card, regra) {
        if (card) card.innerHTML = cardInner(regra);
    }

    // ─── Click delegation pros cards de seleção (uma vez) ───
    let _delegationBound = false;
    function bindCardClicks() {
        if (_delegationBound) return;
        _delegationBound = true;

        document.addEventListener('click', async (e) => {
            // Escolher produto (modo lista)
            const prodBtn = e.target.closest('[data-gift-produto]');
            if (prodBtn) {
                const card = prodBtn.closest('[data-gift-selector]');
                const regraId = card?.dataset.giftRegraId;
                if (!regraId) return;
                const regra = (_regrasCache || []).find(r => String(r.id) === String(regraId));
                if (!regra) return;
                const handle = prodBtn.dataset.giftProduto;
                const s = selState(regraId);
                s.handle = handle;
                s.variantId = null;
                repaintCard(card, regra);              // mostra produto ativo + "Carregando variações…"
                await carregarProdutoBrinde(handle);   // lazy-load das variações
                autoSelVariante(regra);
                repaintCard(card, regra);              // agora mostra as variações
                return;
            }

            // Pingente: escolher formato / cor do metal / tamanho
            const pingBtn = e.target.closest('[data-gift-ping-formato],[data-gift-ping-metal],[data-gift-ping-tam]');
            if (pingBtn) {
                const card = pingBtn.closest('[data-gift-selector]');
                const regraId = card?.dataset.giftRegraId;
                if (!regraId) return;
                const regra = (_regrasCache || []).find(r => String(r.id) === String(regraId));
                if (!regra) return;
                const s = pingState(regra);
                if (pingBtn.dataset.giftPingFormato != null) { s.p.formato = pingBtn.dataset.giftPingFormato; s.p.metal = null; s.p.tamanho = null; }
                else if (pingBtn.dataset.giftPingMetal != null) { s.p.metal = pingBtn.dataset.giftPingMetal; s.p.tamanho = null; }
                else if (pingBtn.dataset.giftPingTam != null) { s.p.tamanho = pingBtn.dataset.giftPingTam; }
                repaintCard(card, regra);
                return;
            }

            // Selecionar variação
            const variantBtn = e.target.closest('[data-gift-variant]');
            if (variantBtn) {
                const card = variantBtn.closest('[data-gift-selector]');
                const regraId = card?.dataset.giftRegraId;
                const variantId = variantBtn.dataset.giftVariant;
                if (!regraId || !variantId) return;
                const regra = (_regrasCache || []).find(r => String(r.id) === String(regraId));
                if (!regra) return;
                selState(regraId).variantId = variantId;
                repaintCard(card, regra);
                return;
            }

            // Resgatar brinde (botão final)
            const addBtn = e.target.closest('[data-gift-add]');
            if (addBtn) {
                const card = addBtn.closest('[data-gift-selector]');
                const regraId = card?.dataset.giftRegraId;
                if (!regraId) return;
                const regra = (_regrasCache || []).find(r => String(r.id) === String(regraId));
                if (!regra) return;
                const pingente = isPingenteRegra(regra);
                const s = pingente ? pingState(regra) : selState(regraId);
                if (!s.variantId) return;

                // Personalização (só pingente): valida e monta a property multilinha.
                let extraProps = null;
                if (pingente) {
                    const p = s.p;
                    if (!p.pet.trim()) { toast('Preencha o nome do pet.'); return; }
                    const telDigits = String(p.tel || '').replace(/\D/g, '');
                    if (telDigits.length > 0 && telDigits.length < 10) { toast('Telefone incompleto.'); return; }
                    const linhas = [];
                    if (p.pet.trim()) linhas.push('Nome do pet: ' + p.pet.trim());
                    if (p.tutor.trim()) linhas.push('Nome do tutor: ' + p.tutor.trim());
                    if (p.tel.trim()) linhas.push('Telefone do tutor: ' + p.tel.trim());
                    extraProps = { 'Personalização': linhas.join('\n') };
                }

                addBtn.disabled = true;
                addBtn.textContent = 'Adicionando...';
                try {
                    await adicionarBrinde(regra, s.variantId, extraProps);
                    toast(pingente ? '🎁 Pingente adicionado ao seu carrinho!' : '🎁 Brinde adicionado ao seu carrinho!');
                    _seletoresState.delete(String(regraId));
                    const cartAtualizado = await xhrJson('/cart.js');
                    if (window.AmeCart?.refresh) window.AmeCart.refresh(cartAtualizado);
                } catch (err) {
                    console.warn('[Brindes] falha no resgate', err.message);
                    addBtn.disabled = false;
                    addBtn.textContent = 'Tente novamente';
                }
            }
        });

        // Inputs de gravação do pingente — atualizam o estado SEM repaint (pra
        // não perder o foco) e só re-habilitam o botão de resgate.
        document.addEventListener('input', (e) => {
            const field = e.target.closest('[data-gift-ping-field]');
            if (!field) return;
            const card = field.closest('[data-gift-selector]');
            const regraId = card?.dataset.giftRegraId;
            if (!regraId) return;
            const regra = (_regrasCache || []).find(r => String(r.id) === String(regraId));
            if (!regra) return;
            const s = pingState(regra);
            const which = field.dataset.giftPingField;
            if (which === 'tel') { const m = pingMaskTel(field.value); field.value = m; s.p.tel = m; }
            else { const limpo = pingStripEmoji(field.value); if (limpo !== field.value) field.value = limpo; s.p[which] = field.value; }

            const addBtn = card.querySelector('[data-gift-add]');
            if (addBtn) {
                const petOK = s.p.pet.trim().length > 0;
                const telDigits = String(s.p.tel || '').replace(/\D/g, '');
                const telOK = telDigits.length === 0 || telDigits.length >= 10;
                const pronto = !!s.variantId && petOK && telOK;
                addBtn.disabled = !pronto;
                addBtn.textContent = pronto ? 'Resgatar meu brinde'
                    : (!s.variantId ? 'Escolha as opções acima'
                        : (!petOK ? 'Preencha o nome do pet' : 'Telefone incompleto'));
            }
        });
    }

    // Renderiza/atualiza os cards de seleção dentro do drawer.
    // Recebe um array de REGRAS pendentes (satisfeitas, sem brinde no cart).
    function renderizarTodosCards(regrasPendentes) {
        const drawer = document.querySelector('[data-cart-drawer]') || document.querySelector('#cart-drawer');
        if (!drawer) return;
        const lista = drawer.querySelector('[data-cart-items]');
        if (!lista) return;

        // Remove cards velhos (sempre re-renderiza)
        lista.querySelectorAll('[data-gift-selector]').forEach(el => el.remove());

        if (!regrasPendentes || !regrasPendentes.length) return;

        // No TOPO da lista (afterbegin) — um "você ganhou um brinde" precisa
        // estar visível de cara. No fim, com carrinho cheio, fica abaixo da
        // dobra e o cliente não vê o card pra resgatar.
        const html = regrasPendentes.map(regra => renderCardSelecao(regra)).join('');
        lista.insertAdjacentHTML('afterbegin', html);
    }

    // ─── Barra "faltam R$X pro brinde" (só regras de VALOR MÍNIMO) ───
    // Injeta/atualiza uma barrinha de progresso no drawer, ao lado da de frete
    // grátis. Mostra a PRÓXIMA faixa a atingir; se já qualificou, mostra "você
    // ganhou". Reaproveita as classes .ame-cart-shipping-bar (visual nativo).
    // Re-injetada a cada reavaliação (o drawer re-renderiza o corpo no refresh).
    function renderizarBarraBrinde(cart) {
        const drawer = document.querySelector('[data-cart-drawer]') || document.querySelector('#cart-drawer');
        if (!drawer) return;
        const body = drawer.querySelector('[data-cart-body]') || drawer;
        let bar = body.querySelector('[data-gift-bar]');

        const regras = (_regrasCache || []).filter(r =>
            r.tipo_gatilho === 'valor_minimo' && Number(r.gatilho_valor_minimo_cents) > 0);
        if (!regras.length || !cart || !cart.items || cart.item_count === 0) {
            if (bar) bar.remove();
            return;
        }

        const subtotal = subtotalReal(cart);
        const tiers = regras
            .map(r => {
                const lista = listaProdutosRegra(r);
                return { cents: Number(r.gatilho_valor_minimo_cents), titulo: r.brinde_titulo || '', opcoes: lista ? lista.length : 1 };
            })
            .sort((a, b) => a.cents - b.cents);

        // Nome a exibir numa faixa: só usa o nome do brinde quando é UM brinde só
        // (1 regra na faixa, sem lista de opções). Com várias opções — lista de
        // produtos OU regras diferentes no mesmo valor — fica genérico "seu brinde"
        // (evita "...ganhar Lista: 2 produto(s)").
        function labelBrinde(cents) {
            const naFaixa = tiers.filter(t => t.cents === cents);
            const varios = naFaixa.length > 1 || naFaixa.some(t => t.opcoes > 1);
            const titulo = naFaixa.length === 1 ? naFaixa[0].titulo : '';
            if (varios || !titulo || /^\s*lista\s*:/i.test(titulo)) return 'seu brinde';
            return titulo;
        }

        const proximo = tiers.find(t => subtotal < t.cents); // faixa ainda não atingida
        let html;
        if (proximo) {
            const faltam = proximo.cents - subtotal;
            const pct = Math.max(0, Math.min(100, Math.round(subtotal * 100 / proximo.cents)));
            html = `<p class="ame-cart-shipping-bar__text">🎁 Faltam <strong>${money(faltam)}</strong> para ganhar <strong>${esc(labelBrinde(proximo.cents))}</strong></p>
                    <div class="ame-cart-shipping-bar__track"><div class="ame-cart-shipping-bar__fill" style="width:${pct}%"></div></div>`;
        } else {
            const ganhoCents = tiers[tiers.length - 1].cents;
            html = `<p class="ame-cart-shipping-bar__text">🎁 Você ganhou <strong>${esc(labelBrinde(ganhoCents))}</strong>! 🎉</p>
                    <div class="ame-cart-shipping-bar__track"><div class="ame-cart-shipping-bar__fill" style="width:100%"></div></div>`;
        }

        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'ame-cart-shipping-bar ame-cart-gift-bar';
            bar.setAttribute('data-gift-bar', '');
            const shipping = body.querySelector('[data-shipping-bar]');
            const lista = body.querySelector('[data-cart-items]');
            if (shipping) shipping.insertAdjacentElement('afterend', bar);          // logo abaixo da barra de frete
            else if (lista && lista.parentNode) lista.parentNode.insertBefore(bar, lista);
            else body.insertBefore(bar, body.firstChild);
        }
        bar.innerHTML = html;
    }

    // Estilo da barra de brinde: herda da barra de frete, só troca a cor do
    // preenchimento (verde da marca) e dá um respiro. Injetado uma vez.
    function injetarEstiloBarra() {
        if (document.getElementById('ame-gift-bar-style')) return;
        const st = document.createElement('style');
        st.id = 'ame-gift-bar-style';
        st.textContent = '.ame-cart-gift-bar{margin-top:.5rem}.ame-cart-gift-bar:not([hidden]){display:block}.ame-cart-gift-bar .ame-cart-shipping-bar__fill{background:#5a7461}';
        document.head.appendChild(st);
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
            // Barra "faltam R$X pro brinde": adicionar/remover itens-brinde não
            // muda o subtotal REAL, então calcular com este `cart` é estável.
            renderizarBarraBrinde(cart);
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

            // 2. Só 1 brinde por pedido: entre as regras satisfeitas, vence a de
            //    FAIXA MAIOR. As demais (não-vencedoras) têm o brinde removido do
            //    carrinho e não mostram card — a maior "sobrepõe" as menores.
            const satisfeitas = regrasAtivas.filter(r => regraSatisfeita(r, cart));
            const vencedora = escolherVencedora(satisfeitas);

            for (const regra of regrasAtivas) {
                const itemPresente = brindeNoCart(cart, regra);
                const ehVencedora = vencedora && String(regra.id) === String(vencedora.id);
                const clienteEscolhe = !regra.brinde_variant_id;

                // Não é a vencedora (não satisfeita, ou perdeu pra uma faixa maior):
                // garante que NÃO há brinde dela no carrinho.
                if (!ehVencedora) {
                    if (itemPresente) {
                        try {
                            await removerBrinde(itemPresente);
                            mudouCart = true;
                        } catch (e) { console.warn('[Brindes] remover (não-vencedora) falhou', e.message); }
                    }
                    continue;
                }

                // É a vencedora → aplica normalmente.
                if (clienteEscolhe) {
                    // Modo "cliente escolhe" (variação de 1 produto, ou produto+variação de uma lista)
                    if (!itemPresente) {
                        const produtos = produtosDaRegra(regra);
                        const s = selState(regra.id);
                        if (produtos.length === 1) {
                            // Produto único: pré-carrega as variações pro card já mostrar.
                            s.handle = produtos[0].handle;
                            const produto = await carregarProdutoBrinde(s.handle);
                            if (!produto) continue; // falhou → não injeta card quebrado
                            autoSelVariante(regra);
                        } else if (s.handle) {
                            // Lista com produto já escolhido antes → garante variações carregadas.
                            await carregarProdutoBrinde(s.handle);
                            autoSelVariante(regra);
                        }
                        // Lista sem produto escolhido: card mostra o seletor de produtos.
                        seletoresPendentes.push(regra);
                    }
                    // presente: nada a fazer (cliente já escolheu)
                } else {
                    // Modo "variante fixa"
                    if (!itemPresente) {
                        try {
                            await adicionarBrinde(regra, regra.brinde_variant_id);
                            toast(`🎁 Você ganhou: ${regra.brinde_titulo || 'Brinde Incluído'}`);
                            mudouCart = true;
                        } catch (e) { console.warn('[Brindes] adicionar falhou', e.message); }
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

        injetarEstiloBarra();
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
