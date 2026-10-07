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

    // Artigo "o/a" pra montar "Selecione a Cor" / "Selecione o Tamanho".
    // Espelha a lógica do Liquid em sections/product.liquid — mesma lista
    // de masculinos, default feminino.
    const KIT_ARTICLE_MASCULINOS = new Set([
        'tamanho', 'formato', 'comprimento', 'modelo', 'material',
        'tipo', 'aroma', 'sabor', 'acabamento',
    ]);
    function articleFor(name) {
        const first = String(name || '').split(' ')[0].toLowerCase();
        return KIT_ARTICLE_MASCULINOS.has(first) ? 'o' : 'a';
    }

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

    // Waltz manda `available` por variante (estoque + política de venda).
    // Variante sem o campo (resposta antiga em cache) conta como disponível,
    // que era o comportamento anterior.
    function isAvailable(v) {
        return !!v && v.available !== false;
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
        // Caixa do passo a passo (snippets/kit-picker.liquid).
        const wizardEl = host.querySelector('[data-kit-wizard]');
        const navEl    = host.querySelector('[data-kit-wizard-nav]');
        const voltarEl = host.querySelector('[data-kit-voltar]');
        const corpoEl  = host.querySelector('[data-kit-wizard-corpo]');
        const liveEl   = host.querySelector('[data-kit-wizard-live]');
        const paineis  = {
            info:     host.querySelector('[data-kit-painel="info"]'),
            pingente: host.querySelector('[data-kit-painel="pingente"]'),
            resumo:   host.querySelector('[data-kit-painel="resumo"]'),
        };
        // A etapa atual vai no .pdp como data-attr: o CSS do kit-picker esconde
        // o CTA e o Compre Junto fora das etapas em que eles cabem.
        const pdpRoot = document.querySelector('.pdp--is-kit');
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
                    <div class="pdp-kit__summary-total" data-kit-summary-total hidden>
                        <span>Total do kit</span>
                        <strong data-kit-summary-total-valor></strong>
                        <small data-kit-summary-total-pix></small>
                    </div>
                </div>
            `;
            summaryWrap = summaryBottomHost.querySelector('[data-kit-summary]');
        }
        const summaryWrapBox = summaryBottomHost?.querySelector('[data-kit-summary-wrap]');
        const summaryTotal = summaryBottomHost?.querySelector('[data-kit-summary-total]');

        // Preço/CTA ficam no #pdp-price-block / #pdp-add-btn padrão do PDP.
        // Pix e parcelas são apenas anúncio (pagar.me calcula no checkout —
        // valores aqui precisam estar sincronizados com o admin pagar.me).
        const priceTotalEl       = document.querySelector('[data-kit-price-total]');
        const pricePixEl         = document.querySelector('[data-kit-price-pix]');
        const pixRow             = document.querySelector('[data-kit-pix-row]');
        const installmentsRow    = document.querySelector('[data-kit-installments-row]');
        const installmentValueEl = document.querySelector('[data-kit-price-installment]');
        const installmentNEl     = document.querySelector('[data-kit-installments-n]');
        const productForm        = document.getElementById('pdp-form');
        const ctaBtn             = document.getElementById('pdp-add-btn');
        const cashbackEl         = document.querySelector('#pdp-cashback-wrap [data-cashback]');
        // Selo de desconto dinâmico do kit (De: + % OFF), calculado dos componentes.
        const compareRow         = document.querySelector('[data-kit-compare-row]');
        const compareEl          = document.querySelector('[data-kit-compare]');
        const discountBadge      = document.querySelector('[data-kit-discount-badge]');
        const imgBadgeWrap       = document.getElementById('pdp-img-badge-wrap');

        // Desativa o sticky do .pdp-kit__showcase quando o CTA "Adicionar"
        // aparece na viewport, evitando que o showcase cubra o botão de compra.
        // O CTA é substituído pela Section Rendering API ao mudar variante, por
        // isso re-observamos no evento pdp:variant-changed.
        if (showcaseWrap && 'IntersectionObserver' in window) {
            let obs = null;
            const startObserving = () => {
                if (obs) obs.disconnect();
                const cta = document.getElementById('pdp-add-btn');
                if (!cta) return;
                obs = new IntersectionObserver((entries) => {
                    for (const e of entries) {
                        showcaseWrap.classList.toggle('is-unstuck', e.isIntersecting);
                    }
                }, {
                    // CTA é considerado "perto" quando ainda falta 20% da
                    // viewport pra ele aparecer — assim o sticky solta antes
                    // de chegar a cobrir o botão.
                    rootMargin: '0px 0px 20% 0px',
                });
                obs.observe(cta);
            };
            startObserving();
            document.addEventListener('pdp:variant-changed', startObserving);
        }

        // Config de parcelamento (lida do kit-picker.liquid via data-attrs)
        const instMax       = parseInt(host.dataset.installmentsMax || '12', 10);
        const instNoInt     = Math.min(parseInt(host.dataset.installmentsNoInterest || '6', 10), instMax);
        const instMinCents  = parseFloat(host.dataset.installmentMinValue || '40') * 100;
        const instTableRaw  = host.dataset.installmentsTable || '';

        // Parse "1:2.61, 2:3.81, ..." → Map<int n, float taxa_pct>
        const instTable = new Map();
        instTableRaw.split(',').forEach(p => {
            const [k, v] = p.split(':').map(s => (s || '').trim());
            const ki = parseInt(k, 10);
            const vf = parseFloat(v);
            if (!isNaN(ki) && !isNaN(vf)) instTable.set(ki, vf);
        });

        // Retorna o MAIOR N sem juros (1..instNoInt) onde parcela >= min_value
        function bestNoInterestN(priceCents) {
            for (let n = instNoInt; n >= 1; n--) {
                if (Math.floor(priceCents / n) >= instMinCents) return n;
            }
            return 0;
        }

        // Tabela completa pro modal — array de { n, parc, total, taxa, semJuros }
        function fullInstallmentsTable(priceCents) {
            const rows = [];
            for (let n = 1; n <= instMax; n++) {
                const taxa = n <= instNoInt ? 0 : (instTable.get(n) || 0);
                const totalCents = Math.round(priceCents * (10000 + taxa * 100) / 10000);
                const parcCents = Math.floor(totalCents / n);
                if (parcCents < instMinCents && n > 1) continue;
                rows.push({ n, parc: parcCents, total: totalCents, taxa, semJuros: taxa === 0 });
            }
            return rows;
        }

        function fmtBR(cents) {
            return 'R$ ' + (cents / 100).toFixed(2).replace('.', ',');
        }

        // Re-popula o <table> do modal com a tabela calculada + bloco Pix
        function repopulateInstallmentsModal(priceCents) {
            const modal = document.querySelector('[data-installments-modal]');
            if (!modal) return;
            // Atualiza Pix
            const pixValueEl = modal.querySelector('[data-installments-modal-pix-value]');
            const pixSavedEl = modal.querySelector('[data-installments-modal-pix-saved]');
            const pixPct = parseInt(host.dataset.pixPct || '5', 10);
            if (pixValueEl && pixPct > 0) {
                const disc = Math.floor(priceCents * pixPct / 100);
                pixValueEl.textContent = fmtBR(priceCents - disc);
                if (pixSavedEl) pixSavedEl.textContent = 'Economize ' + fmtBR(disc);
            }
            // Re-monta tabela
            const tbody = modal.querySelector('tbody');
            if (!tbody) return;
            const rows = fullInstallmentsTable(priceCents);
            tbody.innerHTML = rows.map(r => `
                <tr class="ame-installments-modal__row${r.semJuros ? ' ame-installments-modal__row--no-interest' : ''}">
                    <td><strong>${r.n}x</strong>${r.semJuros
                        ? '<span class="ame-installments-modal__tag ame-installments-modal__tag--no-interest">sem juros</span>'
                        : '<span class="ame-installments-modal__tag">+' + r.taxa.toFixed(2) + '%</span>'}
                    </td>
                    <td>${fmtBR(r.parc)}</td>
                    <td>${fmtBR(r.total)}</td>
                </tr>
            `).join('');
        }

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

        // A variante do componente bate com as opções já escolhidas em `st`?
        // Opção ainda não escolhida não restringe.
        function variantMatches(v, compIdx, st) {
            return unified.every(u => {
                if (u.appliesTo.indexOf(compIdx) < 0 || !st[u.name]) return true;
                const ve = u.values.find(x => x.display === st[u.name]);
                return !!ve && v['option' + (u.optIdxByComp[compIdx] + 1)] === ve.perComp[compIdx];
            });
        }

        // Completa uma seleção: mantém as opções de `fixos` e acha valores pras
        // demais de modo que TODOS os componentes tenham variante em estoque.
        // Devolve { opção: valor } ou null. Tenta primeiro o valor de
        // `preferencia` em cada opção livre — assim trocar o tamanho não
        // embaralha a cor que já estava. Busca em profundidade com poda: com
        // uma opção fixada, cada componente ainda precisa ter alguma variante
        // disponível compatível. `budget` limita kits com muitas opções.
        function completar(fixos, preferencia) {
            const st = {};
            for (const u of unified) {
                if (fixos[u.name] != null && u.values.some(v => v.display === fixos[u.name])) st[u.name] = fixos[u.name];
            }
            const livres = unified.filter(u => u.values.length > 0 && st[u.name] == null);
            let budget = 3000;
            const stillPossible = () => components.every((comp, ci) =>
                (comp.variants || []).some(v => isAvailable(v) && variantMatches(v, ci, st))
            );
            function dfs(i) {
                if (i === livres.length) return true;
                const u = livres[i];
                const pref = preferencia && preferencia[u.name];
                const valores = pref
                    ? [...u.values].sort((a, b) => (b.display === pref) - (a.display === pref))
                    : u.values;
                for (const val of valores) {
                    if (--budget < 0) return false;
                    st[u.name] = val.display;
                    if (stillPossible() && dfs(i + 1)) return true;
                }
                delete st[u.name];
                return false;
            }
            return stillPossible() && dfs(0) ? { ...st } : null;
        }

        // ── Estado de seleção ──
        // Começa na primeira combinação com TODOS os componentes em estoque
        // (equivalente ao selected_or_first_available_variant do PDP normal) —
        // é ela que dá o "A partir de" do preço enquanto a cliente escolhe.
        // Sem nenhuma em estoque, cai no primeiro valor de cada opção.
        const state = completar({}, null) || {};
        unified.forEach(u => {
            if (!state[u.name] && u.values.length > 0) state[u.name] = u.values[0].display;
        });

        // Seleção atual {opção: valor} — o Compre Junto (ame-pdp-bundle.js)
        // casa a variante do cross-sell com ela. Lida sob demanda, então
        // sempre reflete o state do momento.
        window.AmeKit = { getSelection: () => ({ ...state }) };

        // ── Passo a passo ──
        // Opção com um valor só não vira etapa: já nasce escolhida.
        // `confirmados` = opções que a CLIENTE escolheu (o resto do state é só
        // o preenchimento automático que sustenta o preço "A partir de").
        const confirmados = new Set(unified.filter(u => u.values.length === 1).map(u => u.name));
        const feitos = new Set();   // etapas que não são opção: 'info', 'pingente'
        let passos = [];
        let passoAtual = 0;
        let timerAvanco = null;

        // Escolhas confirmadas ANTES desta opção, na ordem das etapas. Etapa
        // posterior não conta: escolher um tamanho nunca fica bloqueado pela cor
        // que ainda vai ser escolhida (se ela não servir, volta a ser pergunta).
        function fixosAntesDe(nome) {
            const out = {};
            for (const u of unified) {
                if (u.name === nome) break;
                if (confirmados.has(u.name)) out[u.name] = state[u.name];
            }
            return out;
        }

        // Valor "esgotado" = não existe combinação em estoque com ele e com o que
        // a cliente já escolheu antes. O botão continua visível (risco diagonal),
        // e tocar nele avisa em vez de avançar.
        function valueAvailable(name, display) {
            return completar({ ...fixosAntesDe(name), [name]: display }, state) !== null;
        }

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
                                <span class="pdp__option-label">Selecione ${articleFor(u.name)} ${esc(u.name)}${esc(u.labelSuffix || '')}</span>
                            </div>
                            <p class="pdp-kit__option-empty">Sem combinação compatível entre os produtos.</p>
                        </div>
                    `;
                }

                const isColor = isColorOption(u.name);
                const isMetal = isMetalColorOption(u.name);
                // Etapa ainda não respondida não mostra nada marcado: o valor no
                // state é só o preenchimento automático, a cliente escolhe.
                const selected = confirmados.has(u.name) ? state[u.name] : '';

                const items = u.values.map(val => {
                    const isSel = val.display === selected;
                    const off = !valueAvailable(u.name, val.display);
                    const label = esc(val.display) + (off ? ' (Esgotado)' : '');
                    const offAttrs = off ? ` aria-disabled="true" aria-label="${label}" title="${label}"` : '';
                    if (isColor) {
                        return `
                            <button
                                type="button"
                                class="pdp__swatch ${isSel ? 'pdp__swatch--active' : ''}${off ? ' pdp__swatch--disabled' : ''}"
                                data-kit-opt="${esc(u.name)}"
                                data-kit-val="${esc(val.display)}"
                                aria-label="${label}"
                                title="${label}"
                                aria-pressed="${isSel}"
                                ${off ? 'aria-disabled="true"' : ''}
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
                                class="pdp__size-btn pdp__size-btn--metal ${isSel ? 'pdp__size-btn--active' : ''}${off ? ' pdp__size-btn--disabled' : ''}"
                                data-kit-opt="${esc(u.name)}"
                                data-kit-val="${esc(val.display)}"
                                aria-pressed="${isSel}"${offAttrs}
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
                            class="pdp__size-btn ${isSel ? 'pdp__size-btn--active' : ''}${off ? ' pdp__size-btn--disabled' : ''}"
                            data-kit-opt="${esc(u.name)}"
                            data-kit-val="${esc(val.display)}"
                            aria-pressed="${isSel}"${offAttrs}
                        >${esc(val.display)}</button>
                    `;
                }).join('');

                const containerClass = isColor ? 'pdp__swatches pdp__swatches--solido' : 'pdp__sizes';

                return `
                    <div class="pdp__option" data-kit-option="${esc(u.name)}">
                        <div class="pdp__option-header">
                            <span class="pdp__option-label">Selecione ${articleFor(u.name)} ${esc(u.name)}${esc(u.labelSuffix || '')}</span>
                            <span class="pdp__option-value" data-kit-opt-value="${esc(u.name)}">${esc(selected || '')}</span>
                        </div>
                        <div class="${containerClass}">${items}</div>
                    </div>
                `;
            }).join('');

            optionsWrap.innerHTML = html;
            if (passos.length) aplicarVisibilidade();
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
                    // o primeiro, demais ficam lazy. No celular o showcase fica
                    // oculto (as fotos vão pro resumo do passo a passo): lá nada
                    // de eager, senão a foto escondida disputa banda com o LCP.
                    const isFirst = i === 0 && window.matchMedia('(min-width: 1024px)').matches;
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
                    const soldOutTag = v && !isAvailable(v)
                        ? '<b class="pdp-kit__summary-tag">Esgotado</b>' : '';
                    const foto = (v && v.featured_image) || comp.featured_image || '';
                    const thumb = foto
                        ? `<img class="pdp-kit__summary-thumb" src="${esc(foto + (foto.includes('?') ? '&' : '?') + 'width=120')}" alt="" loading="lazy" width="48" height="48">`
                        : '<span class="pdp-kit__summary-thumb" aria-hidden="true"></span>';
                    return `
                        <li class="pdp-kit__summary-item">
                            ${thumb}
                            <div class="pdp-kit__summary-txt">
                                <strong>${esc(comp.title)}</strong>
                                <span>${esc(variantTitle)}${soldOutTag}</span>
                            </div>
                        </li>
                    `;
                }).join('');
            }

            const allResolved = variants.every(v => v !== null);
            const soldOut = allResolved && !variants.every(isAvailable);
            if (allResolved) {
                // price vem em REAIS (float) do Waltz, converte pra cents
                const totalCents = variants.reduce((acc, v) => acc + Math.round((v.price || 0) * 100), 0);
                if (priceTotalEl) priceTotalEl.textContent = fmtMoney(totalCents / 100);

                // Selo de desconto DINÂMICO: soma o compare_at de cada componente
                // (usa o próprio price quando não há desconto naquele item) e
                // compara com o total. Reflete o desconto real por componente —
                // ex: 5% no peitoral + 15% na guia → % ponderada pelo valor.
                // Degrada bem: se o Waltz ainda não devolve compare_at (cache
                // antigo), c fica 0, compareCents == totalCents e o selo some.
                const compareCents = variants.reduce((acc, v) => {
                    const p = Math.round((v.price || 0) * 100);
                    const c = Math.round((v.compare_at || 0) * 100);
                    return acc + (c > p ? c : p);
                }, 0);
                const kitPct = compareCents > totalCents
                    ? Math.round((compareCents - totalCents) * 100 / compareCents) : 0;
                if (kitPct > 0) {
                    if (compareEl) compareEl.textContent = fmtMoney(compareCents / 100);
                    if (compareRow) compareRow.hidden = false;
                    if (discountBadge) { discountBadge.textContent = '−' + kitPct + '% OFF'; discountBadge.hidden = false; }
                    if (imgBadgeWrap) imgBadgeWrap.innerHTML = '<span class="pdp__img-discount-badge" aria-label="' + kitPct + '% de desconto">' + kitPct + '% OFF</span>';
                } else {
                    if (compareRow) compareRow.hidden = true;
                    if (discountBadge) discountBadge.hidden = true;
                    if (imgBadgeWrap) imgBadgeWrap.innerHTML = '';
                }

                const pixPct = parseInt(host.dataset.pixPct || '5', 10);
                const pixCents = totalCents - Math.floor(totalCents * pixPct / 100);
                if (pricePixEl && pixRow) {
                    pricePixEl.textContent = fmtMoney(pixCents / 100);
                    pixRow.hidden = false;
                }
                // Total repetido no resumo: na última etapa o preço do topo já
                // saiu da tela, e é ali que a cliente decide.
                if (summaryTotal) {
                    summaryTotal.querySelector('[data-kit-summary-total-valor]').textContent = fmtMoney(totalCents / 100);
                    summaryTotal.querySelector('[data-kit-summary-total-pix]').textContent =
                        pixPct > 0 ? `ou ${fmtMoney(pixCents / 100)} no Pix` : '';
                    summaryTotal.hidden = false;
                }
                // Parcelas: max sem juros viável (respeita min_value)
                const bestN = bestNoInterestN(totalCents);
                if (installmentValueEl && installmentsRow && bestN > 1) {
                    const parc = Math.floor(totalCents / bestN);
                    if (installmentNEl) installmentNEl.textContent = String(bestN);
                    installmentValueEl.textContent = fmtMoney(parc / 100);
                    installmentsRow.hidden = false;
                } else if (installmentsRow) {
                    installmentsRow.hidden = true;
                }
                // Modal: repopula a tabela completa com base no total atual
                repopulateInstallmentsModal(totalCents);

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
                            textEl.innerHTML = `Ganhe até <strong class="ame-cashback__cifra">R$</strong> <strong class="ame-cashback__value" data-cashback-value>${fmtVal}</strong> de cashback.`;
                        } else {
                            textEl.innerHTML = `Ganhe <strong class="ame-cashback__value" data-cashback-value>${Math.round(cbPct)}%</strong> de cashback.`;
                        }
                    }
                }

                // Preço continua visível com item esgotado (igual ao PDP
                // normal); só o CTA trava.
                ctaResumo = soldOut
                    ? { rotulo: 'Esgotado nesta combinação', travado: true }
                    : { rotulo: 'Adicionar Kit ao Carrinho', travado: false };
            } else {
                if (priceTotalEl) priceTotalEl.textContent = '—';
                if (pixRow) pixRow.hidden = true;
                if (installmentsRow) installmentsRow.hidden = true;
                if (compareRow) compareRow.hidden = true;
                if (discountBadge) discountBadge.hidden = true;
                if (imgBadgeWrap) imgBadgeWrap.innerHTML = '';
                if (summaryTotal) summaryTotal.hidden = true;
                ctaResumo = { rotulo: 'Combinação indisponível', travado: true };
            }
            atualizarCta();
        }

        // O que o CTA diz na etapa Resumo (calculado com o preço). Nas outras
        // etapas ele é o "Continuar" do passo a passo.
        let ctaResumo = { rotulo: 'Adicionar Kit ao Carrinho', travado: false };

        function atualizarCta() {
            const p = passos[passoAtual];
            if (p && p.tipo !== 'resumo') setCta('Continuar', false, 'arrow_forward');
            else setCta(ctaResumo.rotulo, ctaResumo.travado, 'shopping_bag');
        }

        function setCta(label, disabled, icone) {
            if (!ctaBtn) return;
            ctaBtn.disabled = disabled;
            if (disabled) ctaBtn.setAttribute('aria-disabled', 'true');
            else ctaBtn.removeAttribute('aria-disabled');
            ctaBtn.classList.toggle('pdp__add-btn--sold-out', disabled);
            const labelTextNode = ctaBtn.childNodes[0];
            if (labelTextNode && labelTextNode.nodeType === 3) labelTextNode.textContent = label;
            // Ícone da sacola some com o botão travado, como no "Produto esgotado"
            // do PDP normal. style.display porque [hidden] perde pra regra da classe.
            // `icone` precisa estar no subset da fonte (snippets/css-variables.liquid).
            const icon = ctaBtn.querySelector('.material-symbols-outlined');
            if (icon) {
                if (icone) icon.textContent = icone;
                icon.style.display = disabled ? 'none' : '';
            }
        }

        function onOptionClick(e) {
            const btn = e.target.closest('[data-kit-opt]');
            if (!btn) return;
            e.preventDefault();
            escolher(btn.dataset.kitOpt, btn.dataset.kitVal);
        }

        function toast(msg) {
            (window.AmePdpToast || ((m) => alert(m)))(msg);
        }

        // A cliente escolheu um valor numa etapa de opção.
        function escolher(nome, valor) {
            pararAvanco();
            // Mesmo valor numa etapa já respondida: só segue em frente.
            if (confirmados.has(nome) && state[nome] === valor) {
                irPara(proximoPendente());
                return;
            }
            // Mantém tudo que já foi escolhido, se der. Se a escolha nova não
            // combina com alguma posterior (ex: cor que não existe no tamanho
            // novo), mantém só as anteriores e a posterior volta a ser pergunta.
            const outras = {};
            confirmados.forEach(n => { if (n !== nome) outras[n] = state[n]; });
            const novo = completar({ ...outras, [nome]: valor }, state)
                || completar({ ...fixosAntesDe(nome), [nome]: valor }, state);
            if (!novo) {
                toast(`${valor} está esgotado nesta combinação. Escolha outra opção.`);
                return;
            }
            unified.forEach(u => {
                if (u.name !== nome && confirmados.has(u.name) && novo[u.name] !== state[u.name]) confirmados.delete(u.name);
            });
            Object.assign(state, novo);
            confirmados.add(nome);

            // Pausa curta pra cliente ver o botão marcado antes de a caixa trocar.
            // Armada ANTES do render: aplicarVisibilidade() lê o timer.
            timerAvanco = setTimeout(() => {
                timerAvanco = null;
                irPara(proximoPendente());
            }, 280);
            renderOptions();
            renderSummaryAndPrice();
            renderNav();
            // Notifica o pingente (e quaisquer outros listeners de variante)
            // sobre a mudança — análogo ao que o PDP normal faz.
            document.dispatchEvent(new CustomEvent('pdp:variant-changed'));
        }

        function pararAvanco() {
            clearTimeout(timerAvanco);
            timerAvanco = null;
        }

        function passoFeito(p) {
            if (p.tipo === 'opcao') return confirmados.has(p.nome);
            if (p.tipo === 'resumo') return false;
            return feitos.has(p.tipo);
        }

        // Primeira etapa por responder; com tudo respondido, o Resumo.
        function proximoPendente() {
            const i = passos.findIndex(p => !passoFeito(p));
            return i < 0 ? passos.length - 1 : i;
        }

        function irPara(i) {
            const dir = i > passoAtual ? 1 : (i < passoAtual ? -1 : 0);
            passoAtual = Math.max(0, Math.min(i, passos.length - 1));
            aplicarPasso(dir);
        }

        // "Continuar" (o CTA fora do Resumo, ou Enter num campo de texto).
        function avancar() {
            const p = passos[passoAtual];
            if (p.tipo === 'opcao' && !confirmados.has(p.nome)) {
                toast(`Escolha ${articleFor(p.nome)} ${p.nome.toLowerCase()}.`);
                return;
            }
            if (p.tipo === 'info') {
                if (!validateRequiredCustomFields()) return;
                feitos.add('info');
            }
            if (p.tipo === 'pingente') {
                if (window.amePingente?.hasAnswered && !window.amePingente.hasAnswered()) {
                    toast('Escolha se deseja adicionar um pingente personalizado.');
                    document.querySelector('[data-pingente-opt-row]')?.classList.add('is-invalid');
                    return;
                }
                if (window.amePingente?.isActive()) {
                    const pv = window.amePingente.validate();
                    if (!pv.ok) { toast(pv.msg); return; }
                }
                feitos.add('pingente');
            }
            irPara(proximoPendente());
        }

        // Mostra só a etapa atual. Não redesenha as opções: trocar de etapa é
        // só classe — o botão da tabela de medidas (Waltz) injetado no
        // cabeçalho do Tamanho sobrevive.
        function aplicarVisibilidade() {
            const p = passos[passoAtual];
            if (!p) return;
            optionsWrap.querySelectorAll('.pdp__option').forEach(el => {
                el.classList.toggle('is-kit-step-hidden', !(p.tipo === 'opcao' && el.dataset.kitOption === p.nome));
            });
            optionsWrap.classList.toggle('is-kit-step-hidden', p.tipo !== 'opcao');
            Object.entries(paineis).forEach(([tipo, el]) => el && el.classList.toggle('is-ativo', p.tipo === tipo));
            if (pdpRoot) {
                pdpRoot.dataset.kitPasso = p.tipo;
                // Durante a pausa do avanço automático o "Continuar" não aparece:
                // surgiria por 280 ms e sumiria, empurrando a página.
                pdpRoot.dataset.kitPassoOk = passoFeito(p) && !timerAvanco ? '1' : '0';
            }
        }

        function aplicarPasso(dir) {
            aplicarVisibilidade();
            renderNav();
            atualizarCta();
            const p = passos[passoAtual];
            if (liveEl && dir) liveEl.textContent = `Etapa ${passoAtual + 1} de ${passos.length}: ${p.titulo}`;
            if (dir && corpoEl) {
                corpoEl.classList.remove('is-entrando-frente', 'is-entrando-tras');
                void corpoEl.offsetWidth; // reinicia a animação
                corpoEl.classList.add(dir > 0 ? 'is-entrando-frente' : 'is-entrando-tras');
            }
            if (dir) rolarParaEtapa();
        }

        // Traz a etapa nova pra tela só quando ela não está à vista — rolar a
        // cada toque cansaria. No Resumo, garante também o CTA visível.
        function rolarParaEtapa() {
            if (!wizardEl) return;
            const headerH = document.querySelector('.ame-header-group')?.getBoundingClientRect().height || 0;
            const margem = 12;
            const r = wizardEl.getBoundingClientRect();
            let delta = 0;
            if (r.top < headerH + margem) {
                delta = r.top - headerH - margem;
            } else if (r.bottom > window.innerHeight) {
                const alvo = passos[passoAtual].tipo === 'resumo' && ctaBtn
                    ? ctaBtn.getBoundingClientRect().bottom + margem
                    : r.bottom + margem;
                // Desce o necessário, sem tirar o topo da caixa da tela.
                delta = Math.min(alvo - window.innerHeight, r.top - headerH - margem);
            }
            if (delta > 4 || delta < -4) {
                const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                window.scrollBy({ top: delta, behavior: suave ? 'smooth' : 'auto' });
            }
        }

        function rotuloCurto(nome) {
            // "Cor do Metal" → "Metal": a etapa tem pouco espaço no celular.
            return String(nome).replace(/^cor d[oa]s?\s+/i, '').replace(/^./, c => c.toUpperCase());
        }

        function renderNav() {
            if (!navEl) return;
            const fronteira = proximoPendente();
            navEl.innerHTML = `
                <ol class="pdp-kit-wizard__chips" style="--kit-passos:${passos.length}">
                    ${passos.map((p, i) => {
                        const feito = passoFeito(p);
                        const atual = i === passoAtual;
                        const alcancavel = feito || i <= fronteira;
                        const valor = p.tipo === 'opcao' && feito ? state[p.nome] : '';
                        return `
                            <li>
                                <button type="button"
                                    class="pdp-kit-wizard__chip${atual ? ' is-atual' : ''}${feito ? ' is-feito' : ''}"
                                    data-kit-ir="${i}"
                                    ${atual ? 'aria-current="step"' : ''}
                                    ${alcancavel ? '' : 'disabled'}
                                    aria-label="${esc(p.titulo + (valor ? ': ' + valor : ''))}">
                                    <span class="pdp-kit-wizard__chip-rotulo">${esc(p.curto)}</span>
                                    ${valor ? `<span class="pdp-kit-wizard__chip-valor">${esc(valor)}</span>` : ''}
                                </button>
                            </li>
                        `;
                    }).join('')}
                </ol>
            `;
            if (voltarEl) voltarEl.hidden = passoAtual === 0;
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
                let value = String(input.value || '').trim();
                if (!value) return;
                // <input type="date"> retorna .value sempre em ISO (YYYY-MM-DD),
                // mesmo com locale pt-BR na UI. Converte pra DD/MM/YYYY pra
                // admin Shopify e Tiny mostrarem no formato brasileiro.
                if (input.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                    const [y, m, d] = value.split('-');
                    value = `${d}/${m}/${y}`;
                }
                components.forEach((comp, i) => {
                    if ((comp.tags || []).indexOf(tag) >= 0) {
                        props[i][name] = value;
                    }
                });
            });
            return props;
        }

        // Campos obrigatórios em branco, sem marcar nada na tela.
        function camposObrigatoriosVazios() {
            const invalids = [];
            document.querySelectorAll('.pdp__custom-field[data-cf-tag]').forEach(node => {
                const tag = node.dataset.cfTag;
                const isRelevant = components.some(c => (c.tags || []).indexOf(tag) >= 0);
                if (!isRelevant) return;
                const input = node.querySelector('[data-cf-required]');
                if (!input) return;
                if (!String(input.value || '').trim()) invalids.push({ node, input });
            });
            return invalids;
        }

        function validateRequiredCustomFields() {
            const invalids = camposObrigatoriosVazios();
            document.querySelectorAll('.pdp__custom-field[data-cf-tag]').forEach(node => {
                node.classList.toggle('pdp__custom-field--invalid', invalids.some(x => x.node === node));
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
            pararAvanco();
            // Fora do Resumo, o botão (e o Enter num campo de texto) é o
            // "Continuar" do passo a passo.
            if (passos.length && passos[passoAtual].tipo !== 'resumo') {
                avancar();
                return;
            }
            const variants = resolveVariants(state, unified, components);
            if (variants.some(v => v === null)) return;
            // O CTA já fica travado, mas Enter num campo de texto ainda
            // submete o form — barra aqui também.
            const soldOutIdx = variants.findIndex(v => !isAvailable(v));
            if (soldOutIdx >= 0) {
                (window.AmePdpToast || ((m) => alert(m)))(
                    components[soldOutIdx].title + ' está esgotado nesta combinação. Escolha outra opção.'
                );
                return;
            }
            // Rede de segurança: as etapas já validaram, mas se algo ficou para
            // trás, volta pra etapa dele ANTES de validar — a rolagem até o
            // campo precisa dele à vista.
            const idxInfo = passos.findIndex(p => p.tipo === 'info');
            if (idxInfo >= 0 && camposObrigatoriosVazios().length) irPara(idxInfo);
            if (!validateRequiredCustomFields()) return;

            // Pingente opcional: valida ANTES do POST. Se inválido, aborta.
            const idxPingente = passos.findIndex(p => p.tipo === 'pingente');
            if (window.amePingente?.isActive()) {
                const pv = window.amePingente.validate();
                if (!pv.ok) {
                    if (idxPingente >= 0) irPara(idxPingente);
                    (window.AmePdpToast || ((m) => alert(m)))(pv.msg);
                    return;
                }
            }

            // Compre Junto: campo obrigatório de cross-sell marcado em branco
            // (ex: "Comprimento da guia") barra o add — igual ao PDP normal.
            if (window.AmePdpBundle?.validate) {
                const bv = window.AmePdpBundle.validate();
                if (!bv.ok) {
                    (window.AmePdpToast || ((m) => alert(m)))(bv.msg);
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
                coleiraKey = 'k' + Math.random().toString(36).slice(2, 6);
            }

            const items = variants.map((v, i) => {
                const item = { id: v.id, quantity: 1 };
                const props = { ...propsByComp[i] };
                // Vincula só o PRIMEIRO componente do kit com a _kit.
                if (willAddPingente && i === 0) props['_kit'] = coleiraKey;
                // Marca o item como componente de kit — impede o cross-sell
                // "Adicione a guia perfeita" no drawer de sugerir mais uma
                // guia quando o kit já vem com uma. Prefixo `_` esconde do
                // cart visível pro cliente.
                props['_from_kit'] = '1';
                if (Object.keys(props).length > 0) item.properties = props;
                return item;
            });

            if (willAddPingente) {
                const pingenteItem = window.amePingente.getCartItem(1, coleiraKey);
                if (pingenteItem) items.push(pingenteItem);
            }

            // Cross-sells marcados no Compre Junto vão no mesmo POST atômico.
            // Sem `_from_kit`: não fazem parte do kit.
            if (window.AmePdpBundle?.getSelectedItems) {
                const bundleItems = window.AmePdpBundle.getSelectedItems();
                if (bundleItems && bundleItems.length) items.push(...bundleItems);
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
                        if (xhr.status >= 200 && xhr.status < 300) return resolve(JSON.parse(xhr.responseText));
                        // 422 = Shopify recusou o lote (ex: estoque acabou dentro
                        // dos 5 min de cache do Waltz). O `description` vem em
                        // PT-BR dizendo qual item — é o que o cliente precisa ler.
                        const err = new Error('HTTP ' + xhr.status + ': ' + xhr.responseText);
                        try {
                            const d = JSON.parse(xhr.responseText).description;
                            if (typeof d === 'string') err.userMessage = d;
                        } catch (_) {}
                        reject(err);
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
                (window.AmePdpToast || ((m) => alert(m)))(
                    err.userMessage || 'Não foi possível adicionar o kit. Tente novamente.'
                );
            } finally {
                if (ctaBtn) ctaBtn.disabled = false;
                if (labelTextNode && labelTextNode.nodeType === 3) labelTextNode.textContent = originalLabel;
            }
        }

        // ── Monta as etapas ──
        // Campos personalizados, pingente e resumo saem do lugar de origem no
        // form e entram nos painéis da caixa. Mover o nó leva junto os ouvintes
        // (pílulas de rádio, contador, máscara de telefone) e o `name` dos
        // inputs — continuam dentro do mesmo form.
        const camposInfo = productForm
            ? [...productForm.querySelectorAll('.pdp__custom-field[data-cf-tag]')].filter(el => !host.contains(el))
            : [];
        if (paineis.info) camposInfo.forEach(el => paineis.info.appendChild(el));
        const pingenteEl = productForm ? productForm.querySelector('.ame-pingente') : null;
        if (pingenteEl && paineis.pingente) paineis.pingente.appendChild(pingenteEl);
        if (summaryBottomHost && paineis.resumo) paineis.resumo.appendChild(summaryBottomHost);

        passos = [
            ...unified.filter(u => u.values.length > 1).map(u => ({
                tipo: 'opcao', nome: u.name, curto: rotuloCurto(u.name), titulo: u.name + (u.labelSuffix || ''),
            })),
            ...(camposInfo.length ? [{ tipo: 'info', curto: 'Detalhes', titulo: 'Informações adicionais' }] : []),
            ...(pingenteEl ? [{ tipo: 'pingente', curto: 'Pingente', titulo: 'Pingente' }] : []),
            { tipo: 'resumo', curto: 'Resumo', titulo: 'Resumo do kit' },
        ];
        passoAtual = proximoPendente();

        optionsWrap.addEventListener('click', onOptionClick);
        if (productForm) productForm.addEventListener('submit', onSubmit);
        else if (ctaBtn) ctaBtn.addEventListener('click', onSubmit);
        // Direto no elemento, não delegado no document: apps da loja (Easify)
        // interceptam clique no document.
        if (navEl) navEl.addEventListener('click', (e) => {
            const b = e.target.closest('[data-kit-ir]');
            if (!b || b.disabled) return;
            pararAvanco();
            irPara(Number(b.dataset.kitIr));
        });
        if (voltarEl) voltarEl.addEventListener('click', () => {
            pararAvanco();
            irPara(passoAtual - 1);
        });

        renderOptions();
        renderSummaryAndPrice();
        aplicarPasso(0);

        // Dispatch pra widgets externos (ex: tabela de medidas do Waltz)
        // saberem que o kit terminou de renderizar. Sem isso, widgets que
        // rodam no DOMContentLoaded procuravam pelas opções do produto
        // antes delas existirem no DOM e o cliente precisava recarregar
        // a página pra tabela aparecer.
        document.dispatchEvent(new CustomEvent('ame:kit-rendered', {
            detail: { host, handle: host.dataset.kitHandle || '' },
        }));
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
