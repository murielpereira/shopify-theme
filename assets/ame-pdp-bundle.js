/* Âme — Cross-sell genérico tipo "Compre Junto" na PDP.
 *
 * Lê tags `crosssell:<handle>` do produto atual (cfg JSON injetado pelo
 * snippet pdp-bundle.liquid), busca cada produto via /products/<handle>.js,
 * monta linha com checkbox + auto-match de variante + preço, soma o total
 * e adiciona tudo ao carrinho num clique.
 *
 * Decisões:
 *  - XHR em vez de fetch (Clarity intercepta fetch na loja, padrão do tema)
 *  - Auto-match casa por OPÇÕES (cor/tamanho) — case-insensitive
 *  - Se o produto cross-sell tem múltiplas variantes e o auto-match não
 *    cobre todas as opções, mostra pílulas pro cliente escolher
 *  - Re-faz auto-match no evento `pdp:variant-changed` (Section Rendering)
 *  - Produto atual fica no topo, checkbox marcado e desabilitado (não
 *    desmarcável — adicionar o bundle sempre inclui o produto da página)
 */
(function () {
    'use strict';

    if (window.__amePdpBundleLoaded) return;
    window.__amePdpBundleLoaded = true;

    function xhrJson(url, method, body) {
        return new Promise((resolve, reject) => {
            const x = new XMLHttpRequest();
            x.open(method || 'GET', url, true);
            x.setRequestHeader('Accept', 'application/json');
            if (body) x.setRequestHeader('Content-Type', 'application/json');
            x.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            x.timeout = 12000;
            x.onload = () => {
                if (x.status >= 200 && x.status < 300) {
                    try { resolve(JSON.parse(x.responseText || '{}')); }
                    catch (e) { reject(e); }
                } else reject(new Error('HTTP ' + x.status));
            };
            x.onerror = () => reject(new Error('Network'));
            x.ontimeout = () => reject(new Error('Timeout'));
            x.send(body ? JSON.stringify(body) : null);
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
            .slice(0, 4); // máx 4 cross-sells (5 itens no total c/ produto atual)
        if (!csHandles.length) return;

        const list = root.querySelector('[data-pdp-bundle-list]');
        const cta = root.querySelector('[data-pdp-bundle-add]');
        const ctaLabelEl = cta.querySelector('.pdp-bundle__cta-label');
        const totalEl = root.querySelector('[data-pdp-bundle-total]');

        let currentProduct = null;
        const items = []; // { product, selectedVariantId, checked, isSelf, matched }

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

        // Tenta casar a variante por opções (cor/tamanho). Retorna { variant, matched }
        // onde `matched` indica se conseguiu casar PELO MENOS UMA opção — usado
        // pra decidir se mostra picker (sem match) ou só info (com match).
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

        // Carrega produto atual + cross-sells em paralelo
        Promise.all([
            xhrJson('/products/' + encodeURIComponent(cfg.currentHandle) + '.js').catch(() => null),
            ...csHandles.map(h => xhrJson('/products/' + encodeURIComponent(h) + '.js').catch(() => null)),
        ]).then(([self, ...others]) => {
            if (!self) return;
            currentProduct = self;

            items.push({
                product: self,
                selectedVariantId: getCurrentVariantId() || self.variants[0].id,
                checked: true,
                isSelf: true,
                matched: true,
            });

            const cur = getCurrentVariant(self);
            for (const p of others) {
                if (!p || !p.available) continue;
                const m = autoMatchVariant(p, cur);
                items.push({
                    product: p,
                    selectedVariantId: m.variant.id,
                    checked: true,
                    isSelf: false,
                    matched: m.matched,
                });
            }

            if (items.length < 2) return; // produto atual sozinho não vale render
            renderAll();
            root.hidden = false;
        });

        function renderAll() {
            list.innerHTML = items.map((it, i) => renderItem(it, i)).join('');
            attachItemListeners();
            updateTotal();
        }

        function renderItem(it, idx) {
            const v = it.product.variants.find(x => x.id === it.selectedVariantId)
                   || it.product.variants[0];
            const imgRaw = it.product.featured_image || it.product.images?.[0] || '';
            const imgUrl = typeof imgRaw === 'string' ? imgRaw : (imgRaw.url || '');
            const showPicker = !it.isSelf
                && it.product.variants.length > 1
                && !it.matched;
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
            // Lista as primeiras 8 variantes disponíveis como pílulas
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
                    if (!items[idx]) return;
                    items[idx].checked = e.target.checked;
                    li.classList.toggle('is-unchecked', !e.target.checked);
                    updateTotal();
                });
            });
            list.querySelectorAll('[data-variant-id]').forEach(btn => {
                btn.addEventListener('click', e => {
                    const variantId = Number(btn.dataset.variantId);
                    const idx = Number(btn.dataset.itemIdx);
                    if (!items[idx]) return;
                    items[idx].selectedVariantId = variantId;
                    // Re-render apenas esse item pra atualizar preço + estado dos botões
                    const li = list.querySelector('[data-idx="' + idx + '"]');
                    if (li) li.outerHTML = renderItem(items[idx], idx);
                    attachItemListeners(); // re-bind após outerHTML
                    updateTotal();
                });
            });
        }

        function updateTotal() {
            const total = items.reduce((acc, it) => {
                if (!it.checked) return acc;
                const v = it.product.variants.find(x => x.id === it.selectedVariantId);
                return acc + (v?.price || 0);
            }, 0);
            totalEl.textContent = fmtBRL(total);
            cta.disabled = !items.some(it => it.checked);
        }

        cta.addEventListener('click', async () => {
            // Adiciona TUDO marcado, incluindo o produto atual — assim o
            // cliente que cliquei no bundle não precisa adicionar separado.
            const toAdd = items
                .filter(it => it.checked)
                .map(it => ({ id: it.selectedVariantId, quantity: 1 }));
            if (!toAdd.length) return;

            const orig = ctaLabelEl.textContent;
            ctaLabelEl.textContent = 'Adicionando...';
            cta.disabled = true;
            try {
                await xhrJson('/cart/add.js', 'POST', { items: toAdd });
                const cart = await xhrJson('/cart.js');
                if (window.AmeCart) {
                    if (typeof window.AmeCart.refresh === 'function') window.AmeCart.refresh(cart);
                    if (typeof window.AmeCart.open === 'function') window.AmeCart.open();
                }
            } catch (e) {
                alert('Não foi possível adicionar o combo ao carrinho. ' + (e.message || ''));
            } finally {
                ctaLabelEl.textContent = orig;
                updateTotal();
            }
        });

        // Re-match quando o cliente muda variante do produto-pai (Section Rendering API)
        document.addEventListener('pdp:variant-changed', () => {
            if (!currentProduct) return;
            const cur = getCurrentVariant(currentProduct);
            for (const it of items) {
                if (it.isSelf) {
                    it.selectedVariantId = cur ? cur.id : it.selectedVariantId;
                } else {
                    const m = autoMatchVariant(it.product, cur);
                    it.selectedVariantId = m.variant.id;
                    it.matched = m.matched;
                }
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
