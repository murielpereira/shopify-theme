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

    // Match de valor entre componentes:
    //   1. Match literal (case-insensitive)
    //   2. Token match — ref está em tokens do candidato separados por '/'
    //      (ex: "XPP" casa com "XPP / XPP+ / 12mm", "Borgonha" casa com
    //      "Borgonha / M / 20mm")
    //   3. Token reverso — candidato está em tokens do ref
    //   4. Fingerprint hierárquico (cores compostas com base+accent+pedra)
    function findValueMatch(refValue, candidates) {
        if (!refValue || !candidates?.length) return null;
        const ref = String(refValue).trim();
        const refLower = ref.toLowerCase();

        const exact = candidates.find(v => String(v).trim().toLowerCase() === refLower);
        if (exact) return exact;

        // Token match (ex: "XPP" ∈ ["XPP", "XPP+", "12mm"])
        for (const cand of candidates) {
            const tokens = String(cand).split(/\s*\/\s*/).map(t => t.trim().toLowerCase());
            if (tokens.includes(refLower)) return cand;
        }
        // Reverso (caso ref seja composto)
        const refTokens = ref.split(/\s*\/\s*/).map(t => t.trim().toLowerCase());
        if (refTokens.length > 1) {
            for (const cand of candidates) {
                if (refTokens.includes(String(cand).trim().toLowerCase())) return cand;
            }
        }

        // Fingerprint (cores)
        const refFp = extractColorFingerprint(ref);
        if (refFp?.base) {
            const fpMatch = findBestColorMatch(candidates, refFp);
            if (fpMatch) return fpMatch;
        }
        return null;
    }

    // Verifica se duas listas de valores são "equivalentes" (mesmo significado
    // semântico apesar de nomes diferentes). Critério: PELO MENOS metade do
    // menor conjunto (com mínimo absoluto de 2) tem match no maior. Permite
    // unificar Tamanho do Peitoral [XPP, XPP+, PP, P] com Largura da Guia
    // [XPP/XPP+/12mm, PP/P/15mm, M/G/20mm] — só 2 dos 3 da Guia batem
    // (M/G/20mm fica sem match), mas tudo bem: os valores não-mapeáveis do
    // ref são filtrados na unificação. Cor + Cor do Metal não fundem porque
    // os valores são completamente diferentes (zero matches).
    function valuesCompatible(valuesA, valuesB) {
        if (!valuesA?.length || !valuesB?.length) return false;
        const [smaller, larger] = valuesA.length <= valuesB.length ? [valuesA, valuesB] : [valuesB, valuesA];
        let matches = 0;
        for (const v of smaller) {
            if (findValueMatch(v, larger) !== null) matches++;
        }
        const minNeeded = Math.max(2, Math.ceil(smaller.length / 2));
        return matches >= minNeeded;
    }

    // Score de "compactness" — quanto MENOS barras nos valores, mais compacto.
    // Usado pra escolher qual componente vira REF da UI: o Peitoral tem
    // tamanhos compactos ("XPP", "PP") e vence a Guia que tem "XPP / XPP+ / 12mm".
    function compactScore(values) {
        if (!values?.length) return 0;
        return values.filter(v => !String(v).includes('/')).length;
    }

    // ── Unificação de opções ──
    // Agrupa options de componentes diferentes que representem a MESMA escolha,
    // mesmo com nomes distintos. Critérios pra agrupar:
    //   1. Mesmo nome (case-insensitive) → ex: "Cor" + "Cor"
    //   2. Valores semanticamente compatíveis (token match) → ex: "Tamanho"
    //      do Peitoral [XPP, PP, M] com "Largura" da Guia [XPP/XPP+/12mm,
    //      PP/P/15mm, M/G/20mm].
    //
    // Quando uma option só aparece em 1 componente (ex: Comprimento, exclusivo
    // da Guia), entra como grupo solo com label sufixado pelo nome do produto.
    function unifyOptions(components) {
        // Pass 1: coleta cada (compIdx, optIdx) com seus valores únicos.
        // Prioriza `option_values` (option.values do Liquid — todos os valores
        // únicos da option) que NÃO sofre do limite de 250 variantes do array
        // `variants`. Pra produtos com >250 variantes (caso do Peitoral Gabriel),
        // derivar de `variants` fazia tamanhos M/G sumirem.
        const allOpts = [];
        components.forEach((comp, ci) => {
            (comp.options || []).forEach((optName, oi) => {
                let values;
                if (comp.option_values && comp.option_values[oi]) {
                    values = comp.option_values[oi].values || [];
                } else {
                    // Fallback: deriva das variants (compatibilidade caso o
                    // Liquid não tenha emitido option_values).
                    values = Array.from(new Set(
                        (comp.variants || []).map(v => v[`option${oi + 1}`]).filter(Boolean)
                    ));
                }
                allOpts.push({ ci, oi, name: optName, values });
            });
        });

        // Pass 2: agrupa opts equivalentes (nunca 2 do mesmo componente no
        // mesmo grupo). Tenta nome literal primeiro; depois valores compatíveis.
        const groups = [];
        for (const opt of allOpts) {
            const optNameLower = opt.name.toLowerCase().trim();
            const fit = groups.find(g => {
                if (g.some(it => it.ci === opt.ci)) return false;
                const sample = g[0];
                if (sample.name.toLowerCase().trim() === optNameLower) return true;
                if (valuesCompatible(sample.values, opt.values)) return true;
                return false;
            });
            if (fit) fit.push(opt);
            else groups.push([opt]);
        }

        // Pass 3: pra cada grupo, computa valores unificados. Escolha de
        // referência (define os valores apresentados na UI):
        //   1º critério: maior compactness (valores sem barra "/") — prefere
        //                Peitoral "XPP" sobre Guia "XPP / XPP+ / 12mm"
        //   2º critério (tiebreaker): mais valores
        const out = groups.map(group => {
            const sortedByPref = [...group].sort((a, b) => {
                const sa = compactScore(a.values);
                const sb = compactScore(b.values);
                if (sa !== sb) return sb - sa;
                return b.values.length - a.values.length;
            });
            const ref = sortedByPref[0];
            const others = group.filter(o => o.ci !== ref.ci);

            const values = [];
            for (const refVal of ref.values) {
                const perComp = { [ref.ci]: refVal };
                let ok = true;
                for (const o of others) {
                    const m = findValueMatch(refVal, o.values);
                    if (m === null) { ok = false; break; }
                    perComp[o.ci] = m;
                }
                if (ok) values.push({ display: refVal, perComp });
            }

            // Usa o nome do REF (componente com mais valores compactos) em
            // vez do primeiro do array — assim "Tamanho" do Peitoral vence
            // "Largura" da Guia quando fundem. Também garante que orderScore
            // (Pass 4) consiga ordenar corretamente — "Largura" cai pro
            // final, "Tamanho" vai pro topo.
            const labelSuffix = (group.length === 1 && components.length > 1)
                ? ` (${components[group[0].ci].title})`
                : '';
            const optIdxByComp = group.reduce((acc, g) => { acc[g.ci] = g.oi; return acc; }, {});

            return {
                name: ref.name,
                labelSuffix,
                values,
                appliesTo: group.map(g => g.ci),
                optIdxByComp,
            };
        });

        // Pass 4: ordenação preferencial — Tamanho > Cor > Cor do Metal >
        // Comprimento > demais. Match por substring no nome (case-insensitive)
        // pra cobrir "Largura", "Size", etc — mas como o agrupamento já
        // funde Largura+Tamanho com nome "Tamanho", suficiente.
        const ORDER = ['tamanho', 'size', 'cor do metal', 'cor', 'color', 'comprimento'];
        function orderScore(name) {
            const n = String(name).toLowerCase();
            for (let i = 0; i < ORDER.length; i++) {
                if (n.includes(ORDER[i])) return i;
            }
            return ORDER.length;
        }
        out.sort((a, b) => orderScore(a.name) - orderScore(b.name));
        return out;
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

    // ── Cor → hex ──
    // Fonte principal: settings.swatch_solido_cores (injetado pelo
    // kit-picker.liquid em data.swatch_colors). Mantém o COR_MAP hardcoded
    // como fallback caso o setting esteja vazio. Por instância de host
    // (cada PDP renderiza só 1, mas o factory recebe o mapa via closure).
    const COR_MAP_FALLBACK = {
        'allure': '#8391a3', 'azul bebê': '#b1d4e0', 'azul bebe': '#b1d4e0',
        'branco': '#ffffff', 'borgonha': '#713232', 'bordô': '#5b2c30', 'bordo': '#5b2c30',
        'café': '#664732', 'cafe': '#664732', 'camel': '#855e43', 'chiclete': '#d95b8a',
        'lilás candy': '#dfc9f4', 'lilas candy': '#dfc9f4', 'marinho': '#414463',
        'militar': '#5f624b', 'nude': '#b59981', 'off white': '#d3cec3', 'preto': '#000000',
        'rosa bebê': '#f6d4d2', 'rosa bebe': '#f6d4d2', 'rosa seco': '#c8a0a7',
        'sépia': '#b6b79d', 'sepia': '#b6b79d', 'smoke': '#656565',
    };
    function makeColorResolver(themeColors) {
        const map = Object.assign({}, COR_MAP_FALLBACK, themeColors || {});
        function corHex(nome) {
            return map[String(nome || '').toLowerCase().trim()] || '#cccccc';
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
        return { corHex, swatchBg };
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

        // Resolver de cor usa settings.swatch_solido_cores do tema
        // (injetado em data.swatch_colors), com fallback hardcoded.
        const { swatchBg } = makeColorResolver(data.swatch_colors);

        const unified = unifyOptions(components);
        const optionsWrap  = host.querySelector('[data-kit-options]');
        const summaryWrap  = host.querySelector('[data-kit-summary]');
        const showcaseWrap = host.querySelector('[data-kit-showcase]');

        // Preço/CTA agora ficam FORA do snippet (no #pdp-price-block padrão
        // do PDP + no #pdp-add-btn padrão do form). Vide sections/product.liquid.
        const priceTotalEl       = document.querySelector('[data-kit-price-total]');
        const pricePixEl         = document.querySelector('[data-kit-price-pix]');
        const pixRow             = document.querySelector('[data-kit-pix-row]');
        const installmentsRow    = document.querySelector('[data-kit-installments-row]');
        const installmentValueEl = document.querySelector('[data-kit-price-installment]');
        const productForm        = document.getElementById('pdp-form');
        const ctaBtn             = document.getElementById('pdp-add-btn');

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

            // Showcase: 1 card por componente, com foto da variant selecionada
            // (fallback: featured_image do produto). Atualiza em cada mudança.
            if (showcaseWrap) {
                showcaseWrap.innerHTML = components.map((comp, i) => {
                    const v = variants[i];
                    const img = (v && v.featured_image) || comp.featured_image || '';
                    const variantTitle = v ? v.title : '—';
                    return `
                        <div class="pdp-kit__showcase-card">
                            <div class="pdp-kit__showcase-img-wrap">
                                ${img
                                    ? `<img class="pdp-kit__showcase-img" src="${esc(img)}" alt="${esc(comp.title)}" loading="lazy">`
                                    : ''}
                            </div>
                            <div class="pdp-kit__showcase-meta">
                                <p class="pdp-kit__showcase-title">${esc(comp.title)}</p>
                                <span class="pdp-kit__showcase-variant">${esc(variantTitle)}</span>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            // Resumo de itens (texto compacto)
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
                const totalCents = variants.reduce((acc, v) => acc + (v.price || 0), 0);
                if (priceTotalEl) priceTotalEl.textContent = fmtMoney(totalCents);

                // Pix (% lido do data-attribute pra evitar duplicar config no JS)
                const pixPct  = parseInt(host.dataset.pixPct  || '5', 10);
                const inst    = parseInt(host.dataset.instCount || '3', 10);
                if (pricePixEl && pixRow) {
                    const pixCents = totalCents - Math.floor(totalCents * pixPct / 100);
                    pricePixEl.textContent = fmtMoney(pixCents);
                    pixRow.hidden = false;
                }
                if (installmentValueEl && installmentsRow && inst > 1) {
                    installmentValueEl.textContent = fmtMoney(Math.floor(totalCents / inst));
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
            const name = btn.dataset.kitOpt;
            const val = btn.dataset.kitVal;
            state[name] = val;
            renderOptions();
            renderSummaryAndPrice();
        }

        // Coleta valores de custom fields no DOM (renderizados em
        // sections/product.liquid baseado em effective_tags). Pra cada CF
        // anotado com data-cf-tag, mapeia pro componente que TEM essa tag.
        // Retorna array paralelo a `components` com properties dict ou {}.
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
                    if ((comp.tags || []).includes(tag)) {
                        props[i][name] = value;
                    }
                });
            });
            return props;
        }

        // Valida custom fields obrigatórios (data-cf-required) na PDP do
        // kit. Cada wrapper .pdp__custom-field tem data-cf-tag pra saber
        // a qual componente o CF pertence — só validamos os CFs cujo
        // componente está realmente sendo adicionado. Marca o wrapper
        // com .pdp__custom-field--invalid e foca o primeiro inválido.
        function validateRequiredCustomFields() {
            const fields = document.querySelectorAll('.pdp__custom-field[data-cf-tag]');
            const invalids = [];
            fields.forEach(node => {
                const tag = node.dataset.cfTag;
                // Algum componente do kit tem essa tag?
                const isRelevant = components.some(c => (c.tags || []).includes(tag));
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
            // Scroll suave até o primeiro inválido + foca
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

            // Bloqueia submit se houver custom field obrigatório vazio
            if (!validateRequiredCustomFields()) return;

            const propsByComp = collectPropertiesByComponent();
            const items = variants.map((v, i) => {
                const item = { id: v.id, quantity: 1 };
                if (Object.keys(propsByComp[i]).length > 0) item.properties = propsByComp[i];
                return item;
            });

            // Restaura o label "Adicionando..." só na primeira text node do CTA
            // (o ícone shopping_bag fica como segundo filho).
            const labelTextNode = ctaBtn && ctaBtn.childNodes[0];
            const originalLabel = (labelTextNode && labelTextNode.nodeType === 3) ? labelTextNode.textContent : '';
            if (ctaBtn) ctaBtn.disabled = true;
            if (labelTextNode && labelTextNode.nodeType === 3) labelTextNode.textContent = 'Adicionando...';

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
                if (ctaBtn) ctaBtn.disabled = false;
                if (labelTextNode && labelTextNode.nodeType === 3) labelTextNode.textContent = originalLabel;
            }
        }

        optionsWrap.addEventListener('click', onOptionClick);
        // Intercepta submit do form padrão do produto — o CTA visível na PDP
        // é #pdp-add-btn (mesmo botão que produtos normais usam).
        if (productForm) productForm.addEventListener('submit', onSubmit);
        else if (ctaBtn) ctaBtn.addEventListener('click', onSubmit);

        renderOptions();
        renderSummaryAndPrice();

        // Em paralelo, busca o array COMPLETO de variants de cada componente
        // (Liquid capa em 250). Quando terminar, re-renderiza pra refletir
        // combinações que agora resolvem (ex: tamanho M+G do Peitoral Gabriel).
        enrichComponentsVariants(components, () => {
            renderSummaryAndPrice();
        });
    }

    // Liquid `product.variants` é capado em 250 variantes. Pra produtos com
    // mais (Peitoral Gabriel tem ~280 com M/G), as últimas variantes ficam
    // fora do JSON embedado — `resolveVariants` retorna null e cliente vê
    // "Combinação indisponível". Endpoint /products/<handle>.js retorna
    // TODAS as variantes. Faz fetch em paralelo no boot e substitui o
    // array `variants` de cada componente.
    function xhrJsonProduct(handle) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', '/products/' + encodeURIComponent(handle) + '.js', true);
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.timeout = 8000;
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { resolve(JSON.parse(xhr.responseText)); }
                    catch (e) { reject(e); }
                } else reject(new Error('HTTP ' + xhr.status));
            };
            xhr.onerror = () => reject(new Error('Network'));
            xhr.ontimeout = () => reject(new Error('Timeout'));
            xhr.send();
        });
    }

    function normalizeVariants(raw) {
        return (raw || []).map(v => ({
            id: v.id,
            title: v.title || '',
            price: v.price,
            available: v.available,
            option1: v.option1 || null,
            option2: v.option2 || null,
            option3: v.option3 || null,
            featured_image: (v.featured_image && (v.featured_image.src || v.featured_image)) || '',
        }));
    }

    async function enrichComponentsVariants(components, onUpdated) {
        // v2 = invalida caches antigos que tinham apenas as 250 primeiras
        // variants (do JSON do Liquid). v2 sempre vem do /products/X.js que
        // retorna o array completo.
        const CACHE_PREFIX = 'kit:variants:v2:';
        await Promise.all(components.map(async (comp, i) => {
            if (!comp.handle) return;
            const key = CACHE_PREFIX + comp.handle;
            // Cache 15min em sessionStorage
            try {
                const raw = sessionStorage.getItem(key);
                if (raw) {
                    const obj = JSON.parse(raw);
                    if (obj && obj.at && (Date.now() - obj.at) < 15 * 60 * 1000) {
                        components[i].variants = obj.variants;
                        return;
                    }
                }
            } catch (_) {}
            try {
                const data = await xhrJsonProduct(comp.handle);
                const variants = normalizeVariants(data.variants);
                console.log('[Kit] variants completas de', comp.handle, '→', variants.length, 'variantes');
                components[i].variants = variants;
                try {
                    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), variants }));
                } catch (_) {}
            } catch (e) {
                console.warn('[Kit] Falha ao carregar variants completas de', comp.handle, e.message);
                // Mantém as variantes parciais do JSON embedado
            }
        }));
        if (typeof onUpdated === 'function') onUpdated();
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
