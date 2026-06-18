/* Âme — Widget custom de reviews no PDP.
 *
 * Solução temporária enquanto a Konfidency não integra com Shopify (~23 dias).
 * O loader oficial deles detecta `platform: "nuvemshop"` e não renderiza widget
 * na Shopify. Esse script consulta o endpoint público de summary com sort
 * (`/{customer}/{sku}/summary/{sortField},{sortOrder}`) que devolve agregado +
 * lista paginada de reviews. Sem credencial, sem auth — endpoint é público.
 *
 * Lê `data-sku` dos elementos já renderizados pelo tema:
 *   - .konfidency-reviews-summary  (estrelinhas + contagem no topo da PDP)
 *   - .konfidency-reviews-details  (lista completa de reviews)
 * O `data-sku` vem de `snippets/konfidency-id.liquid` (1º SKU antigo do grupo).
 *
 * Quando Konfidency integrar oficialmente com Shopify:
 *   1. Loader oficial passa a renderizar nesses mesmos elementos
 *   2. Nosso JS detecta children já presentes e fica inativo (vide markRendered)
 *   3. Pra remover de vez: deletar este arquivo e o <script> em theme.liquid
 *
 * Usa XHR (fetch é interceptado por adsagent/Clarity na Shopify).
 */
(function () {
    'use strict';

    if (window.__ameKonfPdpLoaded) return;
    window.__ameKonfPdpLoaded = true;

    const API_BASE = 'https://reviews-api.konfidency.com.br/ameacessoriospet';
    const PAGE_SIZE = 5;
    const DEFAULT_SORT = 'helpfulScore,desc';

    // ── Helpers ──
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function xhrJson(url) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.timeout = 10000;
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

    // ── Picks o 1º SKU do CSV (data-sku pode ter vários separados por vírgula
    // por causa do espelhamento dos produtos consolidados — vide
    // snippets/konfidency-id.liquid). O endpoint da Konfidency retorna o bucket
    // completo a partir de qualquer SKU do grupo (vimos isso testando: SKUs
    // diferentes do mesmo produto retornam aggregateRating+reviewCount idênticos). ──
    function firstSku(raw) {
        if (!raw) return null;
        return String(raw).split(',')[0].trim() || null;
    }

    // ── Formata "há X tempo" pra data ISO ──
    function tempoRelativo(isoString) {
        if (!isoString) return '';
        const d = new Date(isoString);
        if (isNaN(d)) return '';
        const diff = (Date.now() - d.getTime()) / 1000; // segundos
        if (diff < 60) return 'agora há pouco';
        if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
        if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
        if (diff < 86400 * 30) return `há ${Math.floor(diff / 86400)} dia${Math.floor(diff / 86400) === 1 ? '' : 's'}`;
        if (diff < 86400 * 365) {
            const m = Math.floor(diff / (86400 * 30));
            return `há ${m} ${m === 1 ? 'mês' : 'meses'}`;
        }
        const a = Math.floor(diff / (86400 * 365));
        return `há ${a} ano${a === 1 ? '' : 's'}`;
    }

    // ── Renderiza estrelas (SVG inline pra evitar dependência de font) ──
    function estrelas(rating, size) {
        const s = size || 14;
        const cheia = `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="#f5a623" aria-hidden="true"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;
        const vazia = `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="#d2c3c0" aria-hidden="true"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;
        const n = Math.round(rating || 0);
        return Array.from({ length: 5 }, (_, i) => i < n ? cheia : vazia).join('');
    }

    function fotosHtml(pictures) {
        if (!Array.isArray(pictures) || !pictures.length) return '';
        return `<div class="ame-konfpdp-review__pics">${pictures.map(p => {
            const thumb = p.thumb || p.url;
            const full = p.url || p.thumb;
            if (!thumb) return '';
            // type=button + data-full → lightbox abre via JS (sem href pra
            // navegação acidental ou abertura em nova aba).
            return `<button type="button" class="ame-konfpdp-review__pic" data-ame-konfpdp-pic="${esc(full)}" aria-label="Ampliar foto da avaliação"><img src="${esc(thumb)}" alt="Foto enviada pelo cliente" loading="lazy"></button>`;
        }).join('')}</div>`;
    }

    // ── Lightbox singleton (criado uma vez na 1ª foto clicada) ──
    let lightboxEl = null;
    function ensureLightbox() {
        if (lightboxEl) return lightboxEl;
        lightboxEl = document.createElement('div');
        lightboxEl.className = 'ame-konfpdp-lightbox';
        lightboxEl.hidden = true;
        lightboxEl.innerHTML = `
            <button type="button" class="ame-konfpdp-lightbox__close" aria-label="Fechar">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
            <img class="ame-konfpdp-lightbox__img" src="" alt="">
        `;
        document.body.appendChild(lightboxEl);
        const close = () => {
            lightboxEl.hidden = true;
            document.body.style.overflow = '';
        };
        lightboxEl.addEventListener('click', (e) => {
            // Fecha ao clicar no fundo OU no botão de fechar
            if (e.target === lightboxEl || e.target.closest('.ame-konfpdp-lightbox__close')) close();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !lightboxEl.hidden) close();
        });
        return lightboxEl;
    }
    function openLightbox(url) {
        const lb = ensureLightbox();
        const img = lb.querySelector('.ame-konfpdp-lightbox__img');
        img.src = url;
        img.alt = 'Foto enviada pelo cliente em avaliação';
        lb.hidden = false;
        document.body.style.overflow = 'hidden'; // trava scroll do background
    }

    function reviewHtml(r) {
        const nota = (r.rating || 0).toFixed(1).replace('.', ',');
        const dataRel = tempoRelativo(r.created);
        return `
            <li class="ame-konfpdp-review">
                <header class="ame-konfpdp-review__header">
                    <div class="ame-konfpdp-review__stars" role="img" aria-label="Nota ${nota} de 5">${estrelas(r.rating)}</div>
                    <strong class="ame-konfpdp-review__author">${esc(r.name || 'Anônimo')}</strong>
                    ${dataRel ? `<span class="ame-konfpdp-review__date">${esc(dataRel)}</span>` : ''}
                    ${r.verified ? `<span class="ame-konfpdp-review__verified" title="Comprador verificado">✓ comprador verificado</span>` : ''}
                </header>
                ${r.text ? `<p class="ame-konfpdp-review__text">${esc(r.text)}</p>` : ''}
                ${fotosHtml(r.pictures)}
            </li>
        `;
    }

    // ── Marca elementos pra evitar re-render quando o loader oficial integrar ──
    function jaRenderizado(el) {
        return el && (el.dataset.ameKonfRendered === '1' || el.children.length > 0);
    }
    function markRendered(el) {
        if (el) el.dataset.ameKonfRendered = '1';
    }

    // ── Render do summary (estrelinhas + contagem) ──
    function renderSummary(el, data) {
        if (!el || jaRenderizado(el)) return;
        const reviewCount = data?.reviewCount || 0;
        const rating = data?.aggregateRating || 0;
        if (reviewCount <= 0) { el.hidden = true; return; }
        const nota = rating.toFixed(1).replace('.', ',');
        el.innerHTML = `
            <a href="#pdp-reviews-anchor" class="ame-konfpdp-summary__link" aria-label="${reviewCount} avaliações, nota média ${nota} de 5">
                <span class="ame-konfpdp-summary__stars" aria-hidden="true">${estrelas(rating, 16)}</span>
                <span class="ame-konfpdp-summary__rating">${nota}</span>
                <span class="ame-konfpdp-summary__count">${reviewCount} ${reviewCount === 1 ? 'avaliação' : 'avaliações'}</span>
            </a>
        `;
        markRendered(el);
    }

    // ── Render do bloco completo de reviews ──
    function renderDetails(el, data, sku) {
        if (!el || jaRenderizado(el)) return;
        const reviewCount = data?.reviewCount || 0;
        const rating = data?.aggregateRating || 0;
        const recPct = data?.recommendedPercentage;
        const reviews = data?.reviews || [];

        if (reviewCount <= 0) {
            el.innerHTML = `<p class="ame-konfpdp-empty">Ainda não há avaliações para este produto.</p>`;
            markRendered(el);
            return;
        }

        const nota = rating.toFixed(1).replace('.', ',');
        const recHtml = (typeof recPct === 'number' && recPct >= 0)
            ? `<p class="ame-konfpdp-details__recommend">${Math.round(recPct)}% dos avaliadores recomendam o produto</p>` : '';

        // Click delegation pra abrir lightbox quando o cliente clica numa
        // foto de review. Usa delegation no container — funciona pras reviews
        // que vão chegar via paginação/sort sem precisar re-bindar.
        if (!el.dataset.lightboxBound) {
            el.dataset.lightboxBound = '1';
            el.addEventListener('click', (ev) => {
                const btn = ev.target.closest('[data-ame-konfpdp-pic]');
                if (!btn) return;
                ev.preventDefault();
                openLightbox(btn.dataset.ameKonfpdpPic);
            });
        }

        el.innerHTML = `
            <div id="pdp-reviews-anchor"></div>
            <header class="ame-konfpdp-details__header">
                <div class="ame-konfpdp-details__big-rating">${nota}</div>
                <div class="ame-konfpdp-details__big-stars" aria-hidden="true">${estrelas(rating, 22)}</div>
                <div class="ame-konfpdp-details__big-count">${reviewCount} ${reviewCount === 1 ? 'avaliação' : 'avaliações'}</div>
                ${recHtml}
            </header>
            <div class="ame-konfpdp-details__toolbar">
                <label class="ame-konfpdp-details__sort">
                    Ordenar por:
                    <select data-ame-konfpdp-sort>
                        <option value="helpfulScore,desc">Mais úteis</option>
                        <option value="created,desc">Mais recentes</option>
                        <option value="created,asc">Mais antigas</option>
                        <option value="rating,desc">Maiores notas</option>
                        <option value="rating,asc">Menores notas</option>
                    </select>
                </label>
            </div>
            <ul class="ame-konfpdp-details__list" data-ame-konfpdp-list>
                ${reviews.map(reviewHtml).join('')}
            </ul>
            ${reviews.length < reviewCount
                ? `<div class="ame-konfpdp-details__more-wrap"><button type="button" class="ame-konfpdp-details__more" data-ame-konfpdp-more>Carregar mais avaliações</button></div>`
                : ''}
        `;
        markRendered(el);

        // ── Estado pra paginação/sort ──
        const state = {
            sku,
            sort: DEFAULT_SORT,
            page: 1,
            total: reviewCount,
            loading: false,
        };

        const list = el.querySelector('[data-ame-konfpdp-list]');
        const sortSelect = el.querySelector('[data-ame-konfpdp-sort]');
        let moreBtn = el.querySelector('[data-ame-konfpdp-more]');

        // ── Sort: re-fetch da página 1 e troca lista inteira ──
        sortSelect?.addEventListener('change', async () => {
            if (state.loading) return;
            state.sort = sortSelect.value;
            state.page = 1;
            state.loading = true;
            list.innerHTML = `<li class="ame-konfpdp-details__loading">Carregando...</li>`;
            try {
                const data = await xhrJson(`${API_BASE}/${encodeURIComponent(sku)}/summary/${encodeURIComponent(state.sort)}?page=1&pageSize=${PAGE_SIZE}`);
                const novas = data?.reviews?.[0]?.reviews || [];
                state.total = data?.reviews?.[0]?.reviewCount || state.total;
                list.innerHTML = novas.map(reviewHtml).join('') || '<li class="ame-konfpdp-empty">Sem avaliações para esta ordenação.</li>';
                // Re-cria o botão "carregar mais" se houver mais páginas
                const wrap = el.querySelector('.ame-konfpdp-details__more-wrap');
                if (novas.length < state.total) {
                    if (wrap) {
                        wrap.innerHTML = `<button type="button" class="ame-konfpdp-details__more" data-ame-konfpdp-more>Carregar mais avaliações</button>`;
                    } else {
                        list.insertAdjacentHTML('afterend', `<div class="ame-konfpdp-details__more-wrap"><button type="button" class="ame-konfpdp-details__more" data-ame-konfpdp-more>Carregar mais avaliações</button></div>`);
                    }
                    moreBtn = el.querySelector('[data-ame-konfpdp-more]');
                    bindMoreBtn();
                } else if (wrap) {
                    wrap.remove();
                }
            } catch (e) {
                list.innerHTML = '<li class="ame-konfpdp-details__error">Erro ao carregar avaliações. Tente novamente.</li>';
            } finally {
                state.loading = false;
            }
        });

        // ── "Carregar mais": fetch da próxima página e append ──
        function bindMoreBtn() {
            const btn = el.querySelector('[data-ame-konfpdp-more]');
            if (!btn || btn.dataset.bound) return;
            btn.dataset.bound = '1';
            btn.addEventListener('click', async () => {
                if (state.loading) return;
                state.loading = true;
                const origText = btn.textContent;
                btn.disabled = true;
                btn.textContent = 'Carregando...';
                try {
                    const nextPage = state.page + 1;
                    const data = await xhrJson(`${API_BASE}/${encodeURIComponent(sku)}/summary/${encodeURIComponent(state.sort)}?page=${nextPage}&pageSize=${PAGE_SIZE}`);
                    const novas = data?.reviews?.[0]?.reviews || [];
                    state.page = nextPage;
                    if (novas.length) {
                        list.insertAdjacentHTML('beforeend', novas.map(reviewHtml).join(''));
                    }
                    const loadedSoFar = state.page * PAGE_SIZE;
                    if (loadedSoFar >= state.total || novas.length < PAGE_SIZE) {
                        btn.closest('.ame-konfpdp-details__more-wrap')?.remove();
                    } else {
                        btn.disabled = false;
                        btn.textContent = origText;
                    }
                } catch (e) {
                    btn.disabled = false;
                    btn.textContent = origText;
                    // Erro silencioso — botão volta clicável
                } finally {
                    state.loading = false;
                }
            });
        }
        bindMoreBtn();
    }

    // ── Init ──
    async function init() {
        const summaryEl = document.querySelector('.konfidency-reviews-summary');
        const detailsEl = document.querySelector('.konfidency-reviews-details');
        if (!summaryEl && !detailsEl) return;

        // SKU vem do `data-sku` que o snippet konfidency-id.liquid populou.
        // Usa o 1º elemento que tiver data-sku como autoritativo (ambos devem
        // ter o mesmo valor).
        const rawSku = summaryEl?.dataset.sku || detailsEl?.dataset.sku || '';
        const sku = firstSku(rawSku);
        if (!sku) return;

        // Se o loader oficial já renderizou (futuro pós-integração), não mexe
        if (jaRenderizado(summaryEl) && jaRenderizado(detailsEl)) return;

        try {
            const data = await xhrJson(`${API_BASE}/${encodeURIComponent(sku)}/summary/${encodeURIComponent(DEFAULT_SORT)}?page=1&pageSize=${PAGE_SIZE}`);
            const item = data?.reviews?.[0];
            if (!item) return;
            renderSummary(summaryEl, item);
            renderDetails(detailsEl, item, sku);
        } catch (e) {
            // Falha silenciosa — esconde elementos pra não deixar buraco
            if (summaryEl && !jaRenderizado(summaryEl)) summaryEl.hidden = true;
            if (detailsEl && !jaRenderizado(detailsEl)) detailsEl.hidden = true;
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
