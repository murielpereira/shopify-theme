/* Âme — Cross-sell genérico tipo "Compre Junto" na PDP.
 *
 * Lê tags `crosssell:<handle>` do produto atual, busca cada produto via
 * /products/<handle>.js e renderiza linhas com checkbox + auto-match de
 * variante + preço. NÃO tem botão de adicionar próprio — expõe
 * window.AmePdpBundle.getSelectedItems() pro submit handler do PDP
 * incluir os items marcados no mesmo POST /cart/add.js do produto principal.
 *
 * Decisões:
 *  - XHR em vez de fetch (Clarity/adsagent interceptam fetch na loja)
 *  - Auto-match casa por OPÇÕES (cor/tamanho) — case-insensitive
 *  - Se cross-sell tem múltiplas variantes e auto-match não cobre todas
 *    as opções, mostra pílulas pro cliente escolher
 *  - Re-faz auto-match no evento `pdp:variant-changed`
 *  - Produto atual NÃO aparece no widget (já vai pelo CTA principal)
 */
(function () {
    'use strict';

    if (window.__amePdpBundleLoaded) return;
    window.__amePdpBundleLoaded = true;

    function xhrJson(url) {
        return new Promise((resolve, reject) => {
            const x = new XMLHttpRequest();
            x.open('GET', url, true);
            x.setRequestHeader('Accept', 'application/json');
            x.timeout = 12000;
            x.onload = () => {
                if (x.status >= 200 && x.status < 300) {
                    try { resolve(JSON.parse(x.responseText || '{}')); }
                    catch (e) { reject(e); }
                } else reject(new Error('HTTP ' + x.status));
            };
            x.onerror = () => reject(new Error('Network'));
            x.ontimeout = () => reject(new Error('Timeout'));
            x.send();
        });
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    }
    function fmtBRL(cents) {
        const n = (Number(cents) || 0) / 100;
        return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    let _items = []; // estado global pra getSelectedItems
    let _cfDefs = []; // configs de custom fields globais (vem do data-pdp-bundle-config)

    // Custom fields que aplicam a um cross-sell, baseado nas tags do produto.
    // Filtramos pra mostrar SÓ tipo 'radio' — escolhas discretas (ex:
    // "Comprimento da guia"). Campos de texto livre (long_text, text) ficam
    // de fora pra não sobrecarregar o widget com perguntas opcionais que
    // o cliente já preenche na PDP do produto principal.
    function cfsForProduct(product) {
        const tags = (product.tags || []).map(t => String(t).toLowerCase());
        return _cfDefs.filter(cf =>
            cf.tag
            && cf.type === 'radio'
            && tags.includes(String(cf.tag).toLowerCase())
        );
    }

    // API pública: o submit handler do PDP chama isto pra pegar os cross-sells
    // marcados e adicioná-los no mesmo POST /cart/add.js do produto principal.
    // Retorna { id, quantity, properties? } — properties só quando o cross-sell
    // tem CFs aplicáveis preenchidos.
    window.AmePdpBundle = {
        getSelectedItems() {
            return _items
                .filter(it => it.checked)
                .map(it => {
                    const payload = { id: it.selectedVariantId, quantity: 1 };
                    const props = readProperties(it);
                    if (props) payload.properties = props;
                    return payload;
                });
        },
        // Valida CFs obrigatórios. Retorna { ok, msg } pra o submit handler
        // poder interromper o add se faltar algo.
        validate() {
            for (const it of _items) {
                if (!it.checked) continue;
                const cfs = cfsForProduct(it.product);
                for (const cf of cfs) {
                    const v = readSingleCf(it, cf);
                    if (cf.required && !v) {
                        const label = cf.title || cf.name || 'campo obrigatório';
                        // marca visualmente o wrapper das pílulas faltantes
                        const wrap = document.querySelector(
                            `[data-pdp-bundle-item][data-idx="${_items.indexOf(it)}"] [data-cf-wrap]`);
                        if (wrap) wrap.classList.add('pdp-bundle__cf--invalid');
                        return { ok: false, msg: `${it.product.title}: selecione ${label}` };
                    }
                }
            }
            return { ok: true };
        },
    };

    function readSingleCf(it, cf) {
        const idx = _items.indexOf(it);
        const sel = `[data-pdp-bundle-item][data-idx="${idx}"] [data-cf-name="${cf.name}"]`;
        const inp = document.querySelector(sel);
        if (!inp) return '';
        return (inp.value || '').trim();
    }
    function readProperties(it) {
        const cfs = cfsForProduct(it.product);
        if (!cfs.length) return null;
        const out = {};
        for (const cf of cfs) {
            const v = readSingleCf(it, cf);
            if (v) out[cf.name] = v;
        }
        return Object.keys(out).length ? out : null;
    }

    function init() {
        const root = document.querySelector('[data-pdp-bundle]');
        if (!root) return;
        const cfgEl = document.querySelector('[data-pdp-bundle-config]');
        if (!cfgEl) return;
        let cfg;
        try { cfg = JSON.parse(cfgEl.textContent); } catch { return; }
        _cfDefs = Array.isArray(cfg.customFields) ? cfg.customFields : [];

        const tags = (cfg.tags || []).map(t => String(t).toLowerCase());
        if (tags.includes('crosssell:none') || tags.includes('no-crosssell')) return;
        const csHandles = tags
            .filter(t => t.startsWith('crosssell:') && t !== 'crosssell:none')
            .map(t => t.slice('crosssell:'.length).trim())
            .filter(Boolean)
            .slice(0, 4);
        if (!csHandles.length) return;

        const list = root.querySelector('[data-pdp-bundle-list]');

        let currentProduct = null;

        function getCurrentVariantId() {
            const form = document.getElementById('pdp-form');
            if (!form) return null;
            const idInput = form.querySelector('input[name="id"]');
            if (!idInput) return null;
            // Tenta value (variante completa). Se vazio (opções parciais),
            // cai no data-effective-id (partial_variant.id do Liquid) — assim
            // o auto-match acompanha o cliente mesmo antes dele escolher todas
            // as opções, mas a validação do submit continua exigindo value=cv.id.
            const raw = idInput.value || idInput.dataset.effectiveId || '';
            const id = Number(raw);
            return Number.isFinite(id) && id > 0 ? id : null;
        }
        function getCurrentVariant(product) {
            if (!product) return null;
            const id = getCurrentVariantId();
            if (id) {
                const found = product.variants.find(v => v.id === id);
                if (found) return found;
            }
            return product.variants.find(v => v.available) || product.variants[0];
        }

        // Quebra "Borgonha com Rosa Bebê" em ["borgonha", "rosa bebê"] — cores
        // compostas do Âme usam " com " como separador. Também aceita " e ",
        // ",", "/" e "+" pra ser resiliente a variações de nomenclatura.
        function tokenizarOpcao(str) {
            return String(str || '')
                .toLowerCase()
                .split(/\s+com\s+|\s+e\s+|[,\/+]/)
                .map(s => s.trim())
                .filter(Boolean);
        }

        // Match: procura a variante do cross-sell mais próxima da variante
        // atual do produto principal. Retorna também `matchedExact` — true só
        // quando TODAS as opções da variante vencedora bateram exatamente
        // (sem match parcial por token). Usado pra decidir se esconde o
        // cross-sell no render (regra do negócio: match parcial de cor não é
        // aceito, ex: "Rosa Bebê" ≠ "Borgonha com Rosa Bebê").
        function autoMatchVariant(product, currentVariant) {
            const targetOpts = (currentVariant?.options || []).map(s => String(s || '').toLowerCase().trim());
            const targetTokens = targetOpts.flatMap(tokenizarOpcao);

            let best = null;
            let bestScore = -1;
            let bestOptsExact = 0;
            let bestTotalOpts = 0;

            for (const v of product.variants) {
                if (!v.available) continue;
                const opts = (v.options || []);
                let score = 0;
                let optsExact = 0;

                for (const raw of opts) {
                    const optLower = String(raw || '').toLowerCase().trim();
                    // Match exato da opção inteira → +2 (prioridade)
                    if (targetOpts.includes(optLower)) {
                        score += 2;
                        optsExact++;
                        continue;
                    }
                    // Match parcial por token — ainda pontua pra priorizar a
                    // variante "mais próxima" caso o produto SÓ tenha cores
                    // compostas, mas não conta como match "aceito" (matchedExact).
                    const tokens = tokenizarOpcao(raw);
                    for (const tk of tokens) {
                        if (targetTokens.includes(tk)) {
                            score += 1;
                            break;
                        }
                    }
                }

                if (score > bestScore) {
                    best = v;
                    bestScore = score;
                    bestOptsExact = optsExact;
                    bestTotalOpts = opts.length;
                }
            }
            if (!best) best = product.variants.find(v => v.available) || product.variants[0];
            // matchedExact=true SÓ quando TODAS as opções bateram exatamente.
            // Se uma opção deu apenas match parcial (cor composta), retorna
            // false → o render esconde o cross-sell inteiro.
            const matchedExact = bestTotalOpts > 0 && bestOptsExact === bestTotalOpts;
            return { variant: best, matched: matchedExact, matchedExact: matchedExact };
        }

        // Carrega produto atual (pra ter as opções da variante selecionada)
        // + todos os cross-sells em paralelo
        Promise.all([
            xhrJson('/products/' + encodeURIComponent(cfg.currentHandle) + '.js').catch(() => null),
            ...csHandles.map(h => xhrJson('/products/' + encodeURIComponent(h) + '.js').catch(() => null)),
        ]).then(([self, ...others]) => {
            if (!self) return;
            currentProduct = self;

            const cur = getCurrentVariant(self);
            for (const p of others) {
                if (!p || !p.available) continue;
                const m = autoMatchVariant(p, cur);
                _items.push({
                    product: p,
                    selectedVariantId: m.variant.id,
                    // Começa desmarcado — o cliente escolhe o que levar. Marcar
                    // por default incluía o cross-sell mesmo pra clientes que
                    // só queriam o produto principal.
                    checked: false,
                    matched: m.matched,
                    matchedExact: m.matchedExact,
                });
            }

            if (!_items.length) return; // sem nenhum cross-sell disponível, não renderiza
            renderAll();
            // renderAll já ajusta root.hidden com base no filtro de matchedExact.
        });

        function renderAll() {
            // Snapshot dos CFs antes de re-render (re-criar HTML zeraria os inputs).
            for (const it of _items) {
                it._cfSnap = {};
                const cfs = cfsForProduct(it.product);
                for (const cf of cfs) {
                    const v = readSingleCf(it, cf);
                    if (v) it._cfSnap[cf.name] = v;
                }
            }
            // Só renderiza cross-sells com match EXATO da variante atual.
            // Match parcial (ex: cor "Rosa Bebê" da coleira x "Borgonha com
            // Rosa Bebê" do peitoral) esconde o cross-sell — regra de negócio
            // pra evitar sugerir variante visualmente próxima mas errada.
            // Usa data-idx = índice ORIGINAL em _items pra os handlers de
            // click continuarem apontando pro item certo mesmo com filtro.
            list.innerHTML = _items
                .map((it, i) => ({ it, i }))
                .filter(({ it }) => it.matchedExact)
                .map(({ it, i }) => renderItem(it, i))
                .join('');
            // Se todos os cross-sells ficaram fora, esconde o bloco inteiro.
            root.hidden = list.children.length === 0;
            attachItemListeners();
            // Restaura valores nos inputs novos + marca pílula correspondente.
            for (let idx = 0; idx < _items.length; idx++) {
                const snap = _items[idx]._cfSnap;
                if (!snap) continue;
                for (const name in snap) {
                    const inp = list.querySelector(
                        `[data-pdp-bundle-item][data-idx="${idx}"] [data-cf-name="${name}"]`);
                    if (!inp) continue;
                    inp.value = snap[name];
                    const wrap = inp.closest('[data-cf-wrap]');
                    const pill = wrap?.querySelector(`[data-cf-pill-val="${CSS.escape(snap[name])}"]`);
                    if (pill) pill.setAttribute('aria-pressed', 'true');
                }
            }
        }

        function renderItem(it, idx) {
            const v = it.product.variants.find(x => x.id === it.selectedVariantId)
                   || it.product.variants[0];
            // Prioriza foto da VARIANTE (cada variant pode ter featured_image
            // própria no Shopify). Sem isso, o cross-sell mostrava sempre a
            // foto padrão do produto, mesmo após o cliente trocar de cor.
            // Fallback: featured_image do produto → primeira imagem.
            let imgUrl = '';
            const vImg = v && v.featured_image;
            if (vImg) imgUrl = typeof vImg === 'string' ? vImg : (vImg.src || vImg.url || '');
            if (!imgUrl) {
                const imgRaw = it.product.featured_image || it.product.images?.[0] || '';
                imgUrl = typeof imgRaw === 'string' ? imgRaw : (imgRaw.url || imgRaw.src || '');
            }
            const showPicker = it.product.variants.length > 1 && !it.matched;
            const cfs = cfsForProduct(it.product);
            return [
                '<li class="pdp-bundle__item' + (it.checked ? '' : ' is-unchecked')
                  + '" data-pdp-bundle-item data-idx="' + idx + '">',
                '  <div class="pdp-bundle__row">',
                '    <input type="checkbox" class="pdp-bundle__check" '
                    + (it.checked ? 'checked' : '')
                    + ' data-pdp-bundle-check'
                    + ' aria-label="Incluir ' + esc(it.product.title) + '">',
                '    <img class="pdp-bundle__img" src="' + esc(imgUrl)
                    + '" alt="" loading="lazy" width="48" height="48">',
                '    <div class="pdp-bundle__info">',
                '      <p class="pdp-bundle__name">' + esc(it.product.title) + '</p>',
                       showPicker
                          ? renderVariantPicker(it, idx)
                          : (v.title && v.title !== 'Default Title'
                              ? '<p class="pdp-bundle__variant-label">' + esc(v.title) + '</p>'
                              : ''),
                '    </div>',
                '  </div>',
                // Preço sai do row pra ganhar largura própria embaixo — antes
                // dividia espaço com .pdp-bundle__info e cortava o nome do produto.
                '  <p class="pdp-bundle__price">' + fmtBRL(v.price) + '</p>',
                   cfs.map(cf => renderCf(it, idx, cf)).join(''),
                '</li>',
            ].join('');
        }

        function renderCf(it, idx, cf) {
            // Só tipo 'radio' chega aqui (filtrado em cfsForProduct).
            // Renderiza como pílulas + hidden input pra value (compatível
            // com readSingleCf que lê via [data-cf-name]).
            const opts = String(cf.options || '').split(',')
                .map(s => s.trim()).filter(Boolean);
            const labelHtml = '<div class="pdp-bundle__cf-label'
                + (cf.required ? ' pdp-bundle__cf-label--required' : '')
                + '">' + esc(cf.title || cf.name) + '</div>';
            const pills = opts.map(opt =>
                '<button type="button" class="pdp-bundle__cf-pill"'
                + ' data-cf-pill data-cf-pill-val="' + esc(opt) + '"'
                + ' aria-pressed="false">' + esc(opt) + '</button>'
            ).join('');
            // NÃO usar `data-cf-required` aqui — esse atributo é lido pelo
            // submit handler do PDP principal, que aborta o submit se algum
            // input com esse data-attr estiver vazio. A validação do bundle
            // já acontece em AmePdpBundle.validate() separadamente.
            const hidden = '<input type="hidden" data-cf-name="' + esc(cf.name) + '"'
                + (cf.required ? ' data-cf-bundle-required="true"' : '') + '>';
            const helperHtml = cf.helper
                ? '<p class="pdp-bundle__cf-helper">' + esc(cf.helper) + '</p>'
                : '';
            return '<div class="pdp-bundle__cf" data-cf-wrap>'
                + labelHtml
                + '<div class="pdp-bundle__cf-pills">' + pills + '</div>'
                + hidden + helperHtml + '</div>';
        }

        function renderVariantPicker(it, idx) {
            const variants = it.product.variants.slice(0, 8);
            const btns = variants.map(v => {
                const label = v.title && v.title !== 'Default Title'
                    ? v.title
                    : (v.options || []).join(' / ');
                const isSel = v.id === it.selectedVariantId;
                return '<button type="button" class="pdp-bundle__variant-btn"'
                    + ' aria-pressed="' + (isSel ? 'true' : 'false') + '"'
                    + (v.available ? '' : ' disabled')
                    + ' data-variant-id="' + v.id + '"'
                    + ' data-item-idx="' + idx + '">'
                    + esc(label) + '</button>';
            }).join('');
            return '<div class="pdp-bundle__variants" role="radiogroup"'
                + ' aria-label="Variantes de ' + esc(it.product.title) + '">'
                + btns + '</div>';
        }

        function attachItemListeners() {
            list.querySelectorAll('[data-pdp-bundle-check]').forEach(cb => {
                cb.addEventListener('change', e => {
                    const li = e.target.closest('[data-pdp-bundle-item]');
                    const idx = Number(li.dataset.idx);
                    if (!_items[idx]) return;
                    _items[idx].checked = e.target.checked;
                    li.classList.toggle('is-unchecked', !e.target.checked);
                });
            });
            // Pílulas dos CFs (tipo radio): clique seleciona, atualiza
            // hidden input do CF e marca aria-pressed.
            list.querySelectorAll('[data-cf-pill]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const wrap = btn.closest('[data-cf-wrap]');
                    if (!wrap) return;
                    wrap.querySelectorAll('[data-cf-pill]').forEach(b => b.setAttribute('aria-pressed', 'false'));
                    btn.setAttribute('aria-pressed', 'true');
                    const hidden = wrap.querySelector('[data-cf-name]');
                    if (hidden) {
                        hidden.value = btn.dataset.cfPillVal || '';
                        wrap.classList.remove('pdp-bundle__cf--invalid');
                    }
                });
            });
            list.querySelectorAll('[data-variant-id]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const variantId = Number(btn.dataset.variantId);
                    const idx = Number(btn.dataset.itemIdx);
                    if (!_items[idx]) return;
                    _items[idx].selectedVariantId = variantId;
                    const li = list.querySelector('[data-idx="' + idx + '"]');
                    if (li) li.outerHTML = renderItem(_items[idx], idx);
                    attachItemListeners(); // re-bind após outerHTML
                });
            });
        }

        // Re-match quando o cliente muda variante do produto principal
        // (Section Rendering API substitui o picker → dispatch deste evento)
        document.addEventListener('pdp:variant-changed', () => {
            if (!currentProduct) return;
            const cur = getCurrentVariant(currentProduct);
            for (const it of _items) {
                const m = autoMatchVariant(it.product, cur);
                it.selectedVariantId = m.variant.id;
                it.matched = m.matched;
                it.matchedExact = m.matchedExact;
            }
            renderAll();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
