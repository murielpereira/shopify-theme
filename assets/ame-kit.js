/* Âme — Kit de produtos.
 *
 * Substitui o variant picker padrão no PDP quando o produto tem
 * `custom.kit_componentes` (Product reference list). Unifica opções de
 * mesmo nome entre os componentes (Cor, Tamanho, etc) e resolve via
 * fingerprint hierárquico (mesmo algoritmo do cross-sell em theme.liquid)
 * pra casar cores com sufixos diferentes (ex: "Azul" no Peitoral casa com
 * "Azul com pedras Denim" na Guia).
 *
 * Ao submeter, dispara um único POST /cart/add.js com 1 line item por
 * componente — atomico (Shopify garante all-or-nothing). Padrão idêntico
 * ao fluxo de Pingente Customizado.
 *
 * Estoque ignorado por design — produtos da loja não monitoram estoque
 * (vide memory project_shopify_status_unlisted). Combinações que não
 * existem no catálogo (ex: cor X que não tem em nenhuma variante) são
 * filtradas da UI, não exibidas ao cliente.
 */
(function () {
    'use strict';

    if (window.__ameKitLoaded) return;
    window.__ameKitLoaded = true;

    // ── Color fingerprint (extraído de layout/theme.liquid:647-710) ──
    // Mantém duplicado pra não arriscar quebrar o cross-sell ao refatorar.

    function extractColorFingerprint(value) {
        if (!value) return null;
        const s = String(value).trim();
        if (!s) return null;
        let pedra = null;
        const pedraMatch = s.match(/\bpedras?\s+(.+?)(?:\s*\/|$)/i);
        if (pedraMatch) pedra = pedraMatch[1].trim();
        const cleaned = s.replace(/\s+(?:e|com)\s+\bpedras?\s+.*$/i, '').trim();
        const parts = cleaned.split(/\s+com\s+/i);
        const base = (parts[0] || '').trim();
        const accent = parts.length > 1 ? parts[1].trim() : null;
        return {
            base: base.toLowerCase(),
            accent: accent ? accent.toLowerCase() : null,
            pedra: pedra ? pedra.toLowerCase() : null,
        };
    }

    function findBestColorMatch(candidates, refFp) {
        if (!refFp?.base) return null;
        const fps = candidates.map(v => ({ value: v, fp: extractColorFingerprint(v) }));
        const sameBase = fps.filter(g => g.fp?.base === refFp.base);
        if (sameBase.length === 0) return null;

        const lvl1 = sameBase.find(g => g.fp.accent === refFp.accent && g.fp.pedra === refFp.pedra);
        if (lvl1) return lvl1.value;
        if (refFp.pedra) {
            const lvl2 = sameBase.find(g => g.fp.pedra === refFp.pedra);
            if (lvl2) return lvl2.value;
        }
        if (refFp.accent) {
            const lvl3 = sameBase.find(g => g.fp.accent === refFp.accent);
            if (lvl3) return lvl3.value;
        }
        const lvl4 = sameBase.find(g => !g.fp.accent && !g.fp.pedra) || sameBase[0];
        return lvl4 ? lvl4.value : null;
    }

    // Match de valor entre componentes: literal primeiro (case-insensitive),
    // depois fingerprint hierárquico. Retorna o valor MATCHED no candidato
    // ou null se não houver match.
    function findValueMatch(refValue, candidates) {
        if (!refValue || !candidates?.length) return null;
        const ref = String(refValue).trim();
        const exact = candidates.find(v => String(v).trim().toLowerCase() === ref.toLowerCase());
        if (exact) return exact;
        const refFp = extractColorFingerprint(ref);
        if (refFp?.base) {
            const fpMatch = findBestColorMatch(candidates, refFp);
            if (fpMatch) return fpMatch;
        }
        return null;
    }

    // ── Unificação de opções ──
    // Pra cada nome de option (case-insensitive), determina qual componente tem,
    // computa valores unificados (intersection via fingerprint pros compartilhados,
    // união pros exclusivos). Resultado descreve o que renderizar na UI + como
    // mapear seleção → variants de cada componente.
    function unifyOptions(components) {
        // Coleta: nome → { displayName, valuesByComp: { compIdx → [values] }, optIdxByComp: { compIdx → optIdx } }
        const byName = {};
        components.forEach((comp, compIdx) => {
            (comp.options || []).forEach((optName, optIdx) => {
                const key = String(optName).toLowerCase().trim();
                if (!byName[key]) byName[key] = { displayName: optName, valuesByComp: {}, optIdxByComp: {} };
                const values = Array.from(new Set(
                    (comp.variants || []).map(v => v[`option${optIdx + 1}`]).filter(Boolean)
                ));
                byName[key].valuesByComp[compIdx] = values;
                byName[key].optIdxByComp[compIdx] = optIdx;
            });
        });

        const unified = [];
        for (const key of Object.keys(byName)) {
            const entry = byName[key];
            const compIdxs = Object.keys(entry.valuesByComp).map(Number);

            // Exclusiva: aparece em apenas 1 componente
            if (compIdxs.length === 1) {
                const ci = compIdxs[0];
                unified.push({
                    name: entry.displayName,
                    labelSuffix: components.length > 1 ? ` (${components[ci].title})` : '',
                    values: entry.valuesByComp[ci].map(v => ({ display: v, perComp: { [ci]: v } })),
                    appliesTo: compIdxs,
                    optIdxByComp: entry.optIdxByComp,
                });
                continue;
            }

            // Compartilhada: usa o primeiro componente como referência, faz matching
            // pros demais. Mantém só valores que TODOS resolveram.
            const [refIdx, ...others] = compIdxs;
            const refValues = entry.valuesByComp[refIdx];
            const values = [];
            for (const refVal of refValues) {
                const perComp = { [refIdx]: refVal };
                let ok = true;
                for (const oi of others) {
                    const m = findValueMatch(refVal, entry.valuesByComp[oi]);
                    if (m === null) { ok = false; break; }
                    perComp[oi] = m;
                }
                if (ok) values.push({ display: refVal, perComp });
            }
            unified.push({
                name: entry.displayName,
                labelSuffix: '',
                values,
                appliesTo: compIdxs,
                optIdxByComp: entry.optIdxByComp,
            });
        }
        return unified;
    }

    // Dado o estado de seleção (nome unificado → display value escolhido),
    // resolve a variant.id de cada componente.
    function resolveVariants(state, unified, components) {
        return components.map((comp, compIdx) => {
            const selections = (comp.options || []).map((_, optIdx) => {
                const u = unified.find(x => x.optIdxByComp[compIdx] === optIdx && x.appliesTo.includes(compIdx));
                if (!u) return null;
                const display = state[u.name];
                if (!display) return null;
                const ve = u.values.find(v => v.display === display);
                return ve ? ve.perComp[compIdx] : null;
            });
            if (selections.some(v => v === null)) return null;
            return (comp.variants || []).find(v =>
                selections.every((val, i) => v[`option${i + 1}`] === val)
            ) || null;
        });
    }

    // ── Money helper ──
    function fmtMoney(cents) {
        return 'R$ ' + (cents / 100).toFixed(2).replace('.', ',');
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    // ── Cor → hex (replicado do widget de agrupamento) ──
    const COR_MAP = {
        'allure': '#8391a3', 'azul bebê': '#8391a3', 'branco': '#ffffff',
        'borgonha': '#713232', 'bordô': '#5b2c30', 'café': '#664732', 'cafe': '#664732',
        'camel': '#855e43', 'chiclete': '#d95b8a', 'lilás candy': '#dfc9f4',
        'lilas candy': '#dfc9f4', 'marinho': '#414463', 'militar': '#5f624b',
        'nude': '#b59981', 'off white': '#d3cec3', 'preto': '#000000',
        'rosa bebê': '#d7c2b1', 'rosa bebe': '#d7c2b1', 'rosa seco': '#c8a0a7',
        'sépia': '#b6b79d', 'sepia': '#b6b79d', 'smoke': '#656565',
    };
    function corHex(nome) {
        return COR_MAP[String(nome || '').toLowerCase().trim()] || '#cccccc';
    }
    function swatchBg(value) {
        const fp = extractColorFingerprint(value);
        if (!fp?.base) return '#cccccc';
        const baseHex = corHex(fp.base);
        if (fp.accent) {
            const accentHex = corHex(fp.accent);
            return `linear-gradient(135deg, ${baseHex} 50%, ${accentHex} 50%)`;
        }
        return baseHex;
    }

    // ── Componente principal ──
    function init(host) {
        if (host.dataset.init) return;
        host.dataset.init = '1';

        const dataEl = host.querySelector('[data-kit-data]');
        if (!dataEl) return;
        let data;
        try { data = JSON.parse(dataEl.textContent); }
        catch (e) { console.warn('[Kit] JSON inválido', e); return; }

        const components = data.components || [];
        if (components.length < 2) return;

        const unified = unifyOptions(components);
        const optionsWrap = host.querySelector('[data-kit-options]');
        const summaryWrap = host.querySelector('[data-kit-summary]');
        const priceWrap   = host.querySelector('[data-kit-price]');
        const ctaBtn      = host.querySelector('[data-kit-cta]');
        const ctaLabel    = host.querySelector('[data-kit-cta-label]');

        // Estado de seleção: nome unificado → display value
        const state = {};
        // Default: primeiro valor de cada option
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
                                <span class="pdp__option-label">${esc(u.name)}${esc(u.labelSuffix)}</span>
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
                            <span class="pdp__option-label">${esc(u.name)}${esc(u.labelSuffix)}</span>
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

            // Resumo dos itens incluídos
            const summaryItems = components.map((comp, i) => {
                const v = variants[i];
                const variantTitle = v ? v.title : '— (combinação indisponível)';
                return `
                    <li class="pdp-kit__summary-item">
                        <strong>${esc(comp.title)}</strong>
                        <span>${esc(variantTitle)}</span>
                    </li>
                `;
            }).join('');
            summaryWrap.innerHTML = summaryItems;

            // Preço = soma dos variants. Se algum não resolveu, exibe '—'.
            const allResolved = variants.every(v => v !== null);
            if (allResolved) {
                const totalCents = variants.reduce((acc, v) => acc + (v.price || 0), 0);
                priceWrap.textContent = fmtMoney(totalCents);
                ctaBtn.disabled = false;
                ctaBtn.removeAttribute('aria-disabled');
                if (ctaLabel) ctaLabel.textContent = 'Adicionar Kit ao Carrinho';
            } else {
                priceWrap.textContent = '—';
                ctaBtn.disabled = true;
                ctaBtn.setAttribute('aria-disabled', 'true');
                if (ctaLabel) ctaLabel.textContent = 'Combinação indisponível';
            }
        }

        function onOptionClick(e) {
            const btn = e.target.closest('[data-kit-opt]');
            if (!btn) return;
            e.preventDefault();
            const name = btn.dataset.kitOpt;
            const val = btn.dataset.kitVal;
            state[name] = val;
            renderOptions();
            renderSummaryAndPrice();
        }

        async function onSubmit(e) {
            e?.preventDefault?.();
            const variants = resolveVariants(state, unified, components);
            if (variants.some(v => v === null)) return;

            const items = variants.map(v => ({ id: v.id, quantity: 1 }));
            const originalLabel = ctaLabel ? ctaLabel.textContent : '';
            ctaBtn.disabled = true;
            if (ctaLabel) ctaLabel.textContent = 'Adicionando...';

            try {
                // XHR em vez de fetch (memory: feedback_apps_sobrescrevem_fetch_loja)
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

                // Atualiza drawer
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
                ctaBtn.disabled = false;
                if (ctaLabel) ctaLabel.textContent = originalLabel;
            }
        }

        optionsWrap.addEventListener('click', onOptionClick);
        ctaBtn.addEventListener('click', onSubmit);

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
