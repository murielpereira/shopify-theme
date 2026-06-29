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

    // API pública: o submit handler do PDP chama isto pra pegar os cross-sells
    // marcados e adicioná-los no mesmo POST /cart/add.js do produto principal.
    window.AmePdpBundle = {
        getSelectedItems() {
            return _items
                .filter(it => it.checked)
                .map(it => ({ id: it.selectedVariantId, quantity: 1 }));
        },
    };

    function init() {
        const root = document.querySelector('[data-pdp-bundle]');
        if (!root) return;
        const cfgEl = document.querySelector('[data-pdp-bundle-config]');
        if (!cfgEl) return;
        let cfg;
        try { cfg = JSON.parse(cfgEl.textContent); } catch { return; }

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
            const id = idInput ? Number(idInput.value) : null;
            return Number.isFinite(id) ? id : null;
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

        function autoMatchVariant(product, currentVariant) {
            const target = (currentVariant?.options || []).map(s => String(s || '').toLowerCase());
            let best = null;
            let bestScore = -1;
            for (const v of product.variants) {
                if (!v.available) continue;
                const opts = (v.options || []).map(s => String(s || '').toLowerCase());
                let score = 0;
                for (const o of opts) if (target.includes(o)) score++;
                if (score > bestScore) { best = v; bestScore = score; }
            }
            if (!best) best = product.variants.find(v => v.available) || product.variants[0];
            return { variant: best, matched: bestScore > 0 };
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
                    checked: true,
                    matched: m.matched,
                });
            }

            if (!_items.length) return; // sem nenhum cross-sell disponível, não renderiza
            renderAll();
            root.hidden = false;
        });

        function renderAll() {
            list.innerHTML = _items.map((it, i) => renderItem(it, i)).join('');
            attachItemListeners();
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
            return [
                '<li class="pdp-bundle__item' + (it.checked ? '' : ' is-unchecked')
                  + '" data-pdp-bundle-item data-idx="' + idx + '">',
                '  <input type="checkbox" class="pdp-bundle__check" '
                  + (it.checked ? 'checked' : '')
                  + ' data-pdp-bundle-check'
                  + ' aria-label="Incluir ' + esc(it.product.title) + '">',
                '  <img class="pdp-bundle__img" src="' + esc(imgUrl)
                  + '" alt="" loading="lazy" width="48" height="48">',
                '  <div class="pdp-bundle__info">',
                '    <p class="pdp-bundle__name">' + esc(it.product.title) + '</p>',
                showPicker
                    ? renderVariantPicker(it, idx)
                    : (v.title && v.title !== 'Default Title'
                        ? '<p class="pdp-bundle__variant-label">' + esc(v.title) + '</p>'
                        : ''),
                '  </div>',
                '  <p class="pdp-bundle__price">' + fmtBRL(v.price) + '</p>',
                '</li>',
            ].join('');
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
