/* Âme — Kit de produtos.
 *
 * Substitui o variant picker padrão no PDP quando o produto tem
 * `custom.kit_componentes`. A lógica pesada (paginar variants, unificar
 * options via fingerprint, ordenar) ficou centralizada no Waltz —
 * endpoint /api/public/kit/:handle. Isso resolve o limite de 250
 * variantes do Liquid/Ajax da Shopify e isola complexidade.
 *
 * Ao submeter, dispara um único POST /cart/add.js com 1 line item por
 * componente — atomico (Shopify garante all-or-nothing).
 *
 * Pra debug:
 *   curl https://waltz.up.railway.app/api/public/kit/kit-gabriel
 */
(function () {
    'use strict';

    if (window.__ameKitLoaded) return;
    window.__ameKitLoaded = true;

    const WALTZ_BASE = 'https://waltz.up.railway.app';

    // ── XHR helpers ──
    function xhrJson(url) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.timeout = 12000;
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { resolve(JSON.parse(xhr.responseText)); }
                    catch (e) { reject(e); }
                } else reject(new Error('HTTP ' + xhr.status + ': ' + xhr.responseText.slice(0, 200)));
            };
            xhr.onerror = () => reject(new Error('Network'));
            xhr.ontimeout = () => reject(new Error('Timeout'));
            xhr.send();
        });
    }

    // ── Resolve variant.id de cada componente dado o state de seleção ──
    function resolveVariants(state, unified, components) {
        return components.map((comp, compIdx) => {
            const selections = (comp.options || []).map((_, optIdx) => {
                const u = unified.find(x =>
                    x.optIdxByComp[compIdx] === optIdx && x.appliesTo.indexOf(compIdx) >= 0
                );
                if (!u) return null;
                const display = state[u.name];
                if (!display) return null;
                const ve = u.values.find(v => v.display === display);
                return ve ? ve.perComp[compIdx] : null;
            });
            if (selections.some(v => v === null)) return null;
            return (comp.variants || []).find(v =>
                selections.every((val, i) => v['option' + (i + 1)] === val)
            ) || null;
        });
    }

    function fmtMoney(value) {
        const cents = typeof value === 'string'
            ? Math.round(parseFloat(value.replace(',', '.')) * 100)
            : Math.round(value * 100);
        return 'R$ ' + (cents / 100).toFixed(2).replace('.', ',');
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    // ── Color → hex resolver (usa settings.swatch_solido_cores do tema) ──
    const COR_MAP_FALLBACK = {
        'allure': '#8391a3', 'azul bebê': '#b1d4e0', 'azul bebe': '#b1d4e0',
        'branco': '#ffffff', 'borgonha': '#713232', 'bordô': '#5b2c30', 'bordo': '#5b2c30',
        'café': '#664732', 'cafe': '#664732', 'camel': '#855e43', 'chiclete': '#d95b8a',
        'lilás candy': '#dfc9f4', 'lilas candy': '#dfc9f4', 'marinho': '#414463',
        'militar': '#5f624b', 'nude': '#b59981', 'off white': '#d3cec3', 'preto': '#000000',
        'rosa bebê': '#f6d4d2', 'rosa bebe': '#f6d4d2', 'rosa seco': '#c8a0a7',
        'sépia': '#b6b79d', 'sepia': '#b6b79d', 'smoke': '#656565',
    };

    function extractColorFingerprint(value) {
        if (!value) return null;
        const s = String(value).trim();
        if (!s) return null;
        const cleaned = s.replace(/\s+(?:e|com)\s+\bpedras?\s+.*$/i, '').trim();
        const parts = cleaned.split(/\s+com\s+/i);
        return {
            base: (parts[0] || '').trim().toLowerCase(),
            accent: parts.length > 1 ? parts[1].trim().toLowerCase() : null,
        };
    }

    function makeColorResolver(themeColors) {
        const map = Object.assign({}, COR_MAP_FALLBACK, themeColors || {});
        function corHex(nome) {
            return map[String(nome || '').toLowerCase().trim()] || '#cccccc';
        }
        function swatchBg(value) {
            const fp = extractColorFingerprint(value);
            if (!fp || !fp.base) return '#cccccc';
            const baseHex = corHex(fp.base);
            if (fp.accent) {
                const accentHex = corHex(fp.accent);
                return `linear-gradient(135deg, ${baseHex} 50%, ${accentHex} 50%)`;
            }
            return baseHex;
        }
        return { corHex, swatchBg };
    }

    // ── Init ──
    async function init(host) {
        if (host.dataset.init) return;
        host.dataset.init = '1';

        const handle = host.dataset.kitHandle;
        if (!handle) return;

        const configEl = host.querySelector('[data-kit-config]');
        let config = { swatch_colors: {} };
        if (configEl) {
            try { config = JSON.parse(configEl.textContent); } catch (_) {}
        }
        const { swatchBg } = makeColorResolver(config.swatch_colors);

        const optionsWrap     = host.querySelector('[data-kit-options]');
        // Showcase virou child direto de .pdp (coluna lateral sticky no
        // desktop) e summary fica logo antes do CTA — ambos hosts injetados
        // em sections/product.liquid via Liquid quando is_kit.
        const showcaseWrap    = document.querySelector('[data-kit-showcase]');
        const summaryBottomHost = document.querySelector('[data-kit-summary-bottom]');
        let summaryWrap = null;
        if (summaryBottomHost) {
            summaryBottomHost.innerHTML = `
                <div class="pdp-kit__summary-wrap" data-kit-summary-wrap>
                    <p class="pdp-kit__summary-title">
                        <span class="material-symbols-outlined" aria-hidden="true">redeem</span>
                        Itens inclusos no kit
                    </p>
                    <ul class="pdp-kit__summary" data-kit-summary></ul>
                </div>
            `;
            summaryWrap = summaryBottomHost.querySelector('[data-kit-summary]');
        }
        const summaryWrapBox = summaryBottomHost?.querySelector('[data-kit-summary-wrap]');

        // Preço/CTA ficam no #pdp-price-block / #pdp-add-btn padrão do PDP.
        // Pix e parcelas saíram do tema — quem renderiza é o app de pagamento
        // da Shopify (via pdp__app-slot--after-price). Aqui só atualizamos
        // preço total + cashback conforme o cliente escolhe variantes do kit.
        const priceTotalEl       = document.querySelector('[data-kit-price-total]');
        const productForm        = document.getElementById('pdp-form');
        const ctaBtn             = document.getElementById('pdp-add-btn');
        const cashbackEl         = document.querySelector('#pdp-cashback-wrap [data-cashback]');

        // ── Fetch dos dados do Waltz ──
        let data;
        try {
            data = await xhrJson(`${WALTZ_BASE}/api/public/kit/${encodeURIComponent(handle)}`);
        } catch (e) {
            console.error('[Kit] erro ao carregar dados do Waltz:', e.message);
            optionsWrap.innerHTML = '<p class="pdp-kit__option-empty">Não foi possível carregar o kit. Tente recarregar a página.</p>';
            return;
        }

        const components = data.components || [];
        const unified = data.unified_options || [];
        if (components.length < 2 || unified.length === 0) {
            optionsWrap.innerHTML = '<p class="pdp-kit__option-empty">Kit incompleto.</p>';
            return;
        }

        // ── Estado de seleção ──
        const state = {};
        unified.forEach(u => {
            if (u.values.length > 0) state[u.name] = u.values[0].display;
        });

        function isColorOption(name) {
            const n = String(name).toLowerCase();
            return n === 'cor' || n === 'color' || n === 'acabamento';
        }
        function isMetalColorOption(name) {
            const n = String(name).toLowerCase();
            return n === 'cor do metal' || n === 'metal';
        }

        function renderOptions() {
            const html = unified.map(u => {
                if (u.values.length === 0) {
                    return `
                        <div class="pdp__option pdp__option--kit-disabled">
                            <div class="pdp__option-header">
                                <span class="pdp__option-label">${esc(u.name)}${esc(u.labelSuffix || '')}</span>
                            </div>
                            <p class="pdp-kit__option-empty">Sem combinação compatível entre os produtos.</p>
                        </div>
                    `;
                }

                const isColor = isColorOption(u.name);
                const isMetal = isMetalColorOption(u.name);
                const selected = state[u.name];

                const items = u.values.map(val => {
                    const isSel = val.display === selected;
                    if (isColor) {
                        return `
                            <button
                                type="button"
                                class="pdp__swatch ${isSel ? 'pdp__swatch--active' : ''}"
                                data-kit-opt="${esc(u.name)}"
                                data-kit-val="${esc(val.display)}"
                                aria-label="${esc(val.display)}"
                                title="${esc(val.display)}"
                                aria-pressed="${isSel}"
                            >
                                <span class="ame-swatch-solido ${val.display.toLowerCase().includes(' com ') ? 'ame-swatch-solido--dual' : 'ame-swatch-solido--single'}"
                                      style="background: ${swatchBg(val.display)};"
                                      aria-hidden="true"></span>
                            </button>
                        `;
                    }
                    if (isMetal) {
                        const slug = String(val.display).toLowerCase().replace(/\s+/g, '-');
                        return `
                            <button
                                type="button"
                                class="pdp__size-btn pdp__size-btn--metal ${isSel ? 'pdp__size-btn--active' : ''}"
                                data-kit-opt="${esc(u.name)}"
                                data-kit-val="${esc(val.display)}"
                                aria-pressed="${isSel}"
                            >
                                <span class="pdp__metal-dot" aria-hidden="true"
                                      style="background:var(--metal-${slug}, var(--color-surface-container,#f8ece0));"></span>
                                ${esc(val.display)}
                            </button>
                        `;
                    }
                    return `
                        <button
                            type="button"
                            class="pdp__size-btn ${isSel ? 'pdp__size-btn--active' : ''}"
                            data-kit-opt="${esc(u.name)}"
                            data-kit-val="${esc(val.display)}"
                            aria-pressed="${isSel}"
                        >${esc(val.display)}</button>
                    `;
                }).join('');

                const containerClass = isColor ? 'pdp__swatches pdp__swatches--solido' : 'pdp__sizes';

                return `
                    <div class="pdp__option" data-kit-option="${esc(u.name)}">
                        <div class="pdp__option-header">
                            <span class="pdp__option-label">${esc(u.name)}${esc(u.labelSuffix || '')}</span>
                            <span class="pdp__option-value" data-kit-opt-value="${esc(u.name)}">${esc(selected || '')}</span>
                        </div>
                        <div class="${containerClass}">${items}</div>
                    </div>
                `;
            }).join('');

            optionsWrap.innerHTML = html;
        }

        function renderSummaryAndPrice() {
            const variants = resolveVariants(state, unified, components);

            if (showcaseWrap) {
                showcaseWrap.dataset.kitCount = String(components.length);
                showcaseWrap.innerHTML = components.map((comp, i) => {
                    const v = variants[i];
                    const imgOriginal = (v && v.featured_image) || comp.featured_image || '';
                    // CDN da Shopify aceita ?width=N — pedimos 600px (DPR 2x num
                    // card de ~250px). Sem isso, vinha imagem original (2000×2000
                    // = 280 KB) pra display de 185px. Fix do PSI image-delivery.
                    const img = imgOriginal
                        ? (imgOriginal.includes('?')
                            ? imgOriginal + '&width=600'
                            : imgOriginal + '?width=600')
                        : '';
                    // O 1º card é (na maioria dos kits) o que renderiza acima do
                    // fold → é o LCP element. PSI confirmou: lazy nesse img
                    // adicionava 900ms+ de "resource load delay". Eager-load só
                    // o primeiro, demais ficam lazy.
                    const isFirst = i === 0;
                    const loading = isFirst ? 'eager' : 'lazy';
                    const fetchprio = isFirst ? ' fetchpriority="high"' : '';
                    return `
                        <div class="pdp-kit__showcase-card">
                            <div class="pdp-kit__showcase-img-wrap">
                                ${img ? `<img class="pdp-kit__showcase-img" src="${esc(img)}" alt="${esc(comp.title)}" loading="${loading}"${fetchprio} width="600" height="600">` : ''}
                            </div>
                            <div class="pdp-kit__showcase-meta">
                                <p class="pdp-kit__showcase-title">${esc(comp.title)}</p>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            if (summaryWrapBox) summaryWrapBox.hidden = false;
            if (summaryWrap) {
                summaryWrap.innerHTML = components.map((comp, i) => {
                    const v = variants[i];
                    const variantTitle = v ? v.title : '— (combinação indisponível)';
                    return `
                        <li class="pdp-kit__summary-item">
                            <strong>${esc(comp.title)}</strong>
                            <span>${esc(variantTitle)}</span>
                        </li>
                    `;
                }).join('');
            }

            const allResolved = variants.every(v => v !== null);
            if (allResolved) {
                // price vem em REAIS (float) do Waltz, converte pra cents
                const totalCents = variants.reduce((acc, v) => acc + Math.round((v.price || 0) * 100), 0);
                if (priceTotalEl) priceTotalEl.textContent = fmtMoney(totalCents / 100);

                // Cashback: recalcula em centavos. Reconstrói o texto pra incluir/omitir
                // a "R$" — porque snippet só renderiza a cifra quando o valor passa do
                // mínimo, e o kit começa com cashback_price=0 (sem cifra no DOM).
                if (cashbackEl) {
                    const cbPct = parseFloat(cashbackEl.dataset.pct || '0');
                    const cbMin = parseFloat(cashbackEl.dataset.min || '0');
                    const textEl = cashbackEl.querySelector('.ame-cashback__text');
                    if (textEl && cbPct > 0) {
                        const cashbackCents = Math.floor(totalCents * cbPct / 100);
                        const minCents = Math.round(cbMin * 100);
                        if (cashbackCents >= minCents) {
                            const fmtVal = (cashbackCents / 100).toFixed(2).replace('.', ',');
                            textEl.innerHTML = `Ganhe <strong class="ame-cashback__cifra">R$</strong> <strong class="ame-cashback__value" data-cashback-value>${fmtVal}</strong> de cashback.`;
                        } else {
                            textEl.innerHTML = `Ganhe <strong class="ame-cashback__value" data-cashback-value>${Math.round(cbPct)}%</strong> de cashback.`;
                        }
                    }
                }

                if (ctaBtn) {
                    ctaBtn.disabled = false;
                    ctaBtn.removeAttribute('aria-disabled');
                    ctaBtn.classList.remove('pdp__add-btn--sold-out');
                    const labelTextNode = ctaBtn.childNodes[0];
                    if (labelTextNode && labelTextNode.nodeType === 3) {
                        labelTextNode.textContent = 'Adicionar Kit ao Carrinho';
                    }
                }
            } else {
                if (priceTotalEl) priceTotalEl.textContent = '—';
                if (ctaBtn) {
                    ctaBtn.disabled = true;
                    ctaBtn.setAttribute('aria-disabled', 'true');
                    const labelTextNode = ctaBtn.childNodes[0];
                    if (labelTextNode && labelTextNode.nodeType === 3) {
                        labelTextNode.textContent = 'Combinação indisponível';
                    }
                }
            }
        }

        function onOptionClick(e) {
            const btn = e.target.closest('[data-kit-opt]');
            if (!btn) return;
            e.preventDefault();
            state[btn.dataset.kitOpt] = btn.dataset.kitVal;
            renderOptions();
            renderSummaryAndPrice();
            // Notifica o pingente (e quaisquer outros listeners de variante)
            // sobre a mudança — análogo ao que o PDP normal faz.
            document.dispatchEvent(new CustomEvent('pdp:variant-changed'));
        }

        function collectPropertiesByComponent() {
            const cfNodes = document.querySelectorAll('.pdp__custom-field[data-cf-tag]');
            const props = components.map(() => ({}));
            cfNodes.forEach(node => {
                const tag = node.dataset.cfTag;
                const name = node.dataset.cfName;
                if (!tag || !name) return;
                const input = node.querySelector('input[name^="properties"], textarea[name^="properties"]');
                if (!input) return;
                const value = String(input.value || '').trim();
                if (!value) return;
                components.forEach((comp, i) => {
                    if ((comp.tags || []).indexOf(tag) >= 0) {
                        props[i][name] = value;
                    }
                });
            });
            return props;
        }

        function validateRequiredCustomFields() {
            const fields = document.querySelectorAll('.pdp__custom-field[data-cf-tag]');
            const invalids = [];
            fields.forEach(node => {
                const tag = node.dataset.cfTag;
                const isRelevant = components.some(c => (c.tags || []).indexOf(tag) >= 0);
                if (!isRelevant) return;
                const input = node.querySelector('[data-cf-required]');
                if (!input) return;
                const value = String(input.value || '').trim();
                if (!value) {
                    node.classList.add('pdp__custom-field--invalid');
                    invalids.push({ node, input });
                } else {
                    node.classList.remove('pdp__custom-field--invalid');
                }
            });
            if (invalids.length === 0) return true;
            const headerH = document.querySelector('.ame-header-group')?.getBoundingClientRect().height || 0;
            const top = invalids[0].node.getBoundingClientRect().top + window.scrollY - headerH - 16;
            window.scrollTo({ top, behavior: 'smooth' });
            setTimeout(() => invalids[0].input.focus(), 350);
            return false;
        }

        async function onSubmit(e) {
            e?.preventDefault?.();
            const variants = resolveVariants(state, unified, components);
            if (variants.some(v => v === null)) return;
            if (!validateRequiredCustomFields()) return;

            // Pingente opcional: valida ANTES do POST. Se inválido, aborta.
            if (window.amePingente?.isActive()) {
                const pv = window.amePingente.validate();
                if (!pv.ok) {
                    (window.AmePdpToast || ((m) => alert(m)))(pv.msg);
                    return;
                }
            }

            const propsByComp = collectPropertiesByComponent();
            // Gera uma chave que vincula o pingente ao primeiro componente do kit
            // (a "coleira" do kit). Cliente removendo esse item no carrinho remove
            // o pingente junto — mesma convenção do PDP normal.
            const willAddPingente = window.amePingente?.isActive() && window.amePingente.getCartItem;
            let coleiraKey = '';
            if (willAddPingente) {
                coleiraKey = 'ck-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
            }

            const items = variants.map((v, i) => {
                const item = { id: v.id, quantity: 1 };
                const props = { ...propsByComp[i] };
                // Vincula só o PRIMEIRO componente do kit com a _coleira_key.
                if (willAddPingente && i === 0) props['_coleira_key'] = coleiraKey;
                if (Object.keys(props).length > 0) item.properties = props;
                return item;
            });

            if (willAddPingente) {
                const pingenteItem = window.amePingente.getCartItem(1, coleiraKey);
                if (pingenteItem) items.push(pingenteItem);
            }

            const labelTextNode = ctaBtn && ctaBtn.childNodes[0];
            const originalLabel = (labelTextNode && labelTextNode.nodeType === 3) ? labelTextNode.textContent : '';
            if (ctaBtn) ctaBtn.disabled = true;
            if (labelTextNode && labelTextNode.nodeType === 3) labelTextNode.textContent = 'Adicionando...';

            try {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', '/cart/add.js', true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.setRequestHeader('Accept', 'application/json');
                const done = new Promise((resolve, reject) => {
                    xhr.onload = () => {
                        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
                        else reject(new Error('HTTP ' + xhr.status + ': ' + xhr.responseText));
                    };
                    xhr.onerror = () => reject(new Error('Network'));
                });
                xhr.send(JSON.stringify({ items }));
                await done;

                const cartXhr = new XMLHttpRequest();
                cartXhr.open('GET', '/cart.js', true);
                cartXhr.setRequestHeader('Accept', 'application/json');
                cartXhr.onload = () => {
                    if (cartXhr.status >= 200 && cartXhr.status < 300) {
                        try {
                            const cart = JSON.parse(cartXhr.responseText);
                            window.AmeCart?.refresh?.(cart);
                            window.AmeCart?.open?.();
                        } catch (_) {}
                    }
                };
                cartXhr.send();
            } catch (err) {
                console.error('[Kit] erro ao adicionar', err);
                alert('Não foi possível adicionar o kit. Tente novamente.');
            } finally {
                if (ctaBtn) ctaBtn.disabled = false;
                if (labelTextNode && labelTextNode.nodeType === 3) labelTextNode.textContent = originalLabel;
            }
        }

        optionsWrap.addEventListener('click', onOptionClick);
        if (productForm) productForm.addEventListener('submit', onSubmit);
        else if (ctaBtn) ctaBtn.addEventListener('click', onSubmit);

        renderOptions();
        renderSummaryAndPrice();
    }

    function boot() {
        document.querySelectorAll('[data-kit-host]').forEach(init);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
