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
        const summaryWrap     = host.querySelector('[data-kit-summary]');
        const summaryWrapBox  = host.querySelector('[data-kit-summary-wrap]');
        const showcaseWrap    = host.querySelector('[data-kit-showcase]');

        // Preço/CTA ficam no #pdp-price-block / #pdp-add-btn padrão do PDP
        const priceTotalEl       = document.querySelector('[data-kit-price-total]');
        const pricePixEl         = document.querySelector('[data-kit-price-pix]');
        const pixRow             = document.querySelector('[data-kit-pix-row]');
        const installmentsRow    = document.querySelector('[data-kit-installments-row]');
        const installmentValueEl = document.querySelector('[data-kit-price-installment]');
        const productForm        = document.getElementById('pdp-form');
        const ctaBtn             = document.getElementById('pdp-add-btn');

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
                showcaseWrap.innerHTML = components.map((comp, i) => {
                    const v = variants[i];
                    const img = (v && v.featured_image) || comp.featured_image || '';
                    const variantTitle = v ? v.title : '—';
                    return `
                        <div class="pdp-kit__showcase-card">
                            <div class="pdp-kit__showcase-img-wrap">
                                ${img ? `<img class="pdp-kit__showcase-img" src="${esc(img)}" alt="${esc(comp.title)}" loading="lazy">` : ''}
                            </div>
                            <div class="pdp-kit__showcase-meta">
                                <p class="pdp-kit__showcase-title">${esc(comp.title)}</p>
                                <span class="pdp-kit__showcase-variant">${esc(variantTitle)}</span>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            if (summaryWrapBox) summaryWrapBox.hidden = false;
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

            const allResolved = variants.every(v => v !== null);
            if (allResolved) {
                // price vem em REAIS (float) do Waltz, converte pra cents
                const totalCents = variants.reduce((acc, v) => acc + Math.round((v.price || 0) * 100), 0);
                if (priceTotalEl) priceTotalEl.textContent = fmtMoney(totalCents / 100);

                const pixPct = parseInt(host.dataset.pixPct || '5', 10);
                const inst   = parseInt(host.dataset.instCount || '3', 10);
                if (pricePixEl && pixRow) {
                    const pixCents = totalCents - Math.floor(totalCents * pixPct / 100);
                    pricePixEl.textContent = fmtMoney(pixCents / 100);
                    pixRow.hidden = false;
                }
                if (installmentValueEl && installmentsRow && inst > 1) {
                    installmentValueEl.textContent = fmtMoney(Math.floor(totalCents / inst) / 100);
                    installmentsRow.hidden = false;
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
                if (pixRow) pixRow.hidden = true;
                if (installmentsRow) installmentsRow.hidden = true;
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

            const propsByComp = collectPropertiesByComponent();
            const items = variants.map((v, i) => {
                const item = { id: v.id, quantity: 1 };
                if (Object.keys(propsByComp[i]).length > 0) item.properties = propsByComp[i];
                return item;
            });

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
