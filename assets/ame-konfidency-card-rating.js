/* Âme — Badge de rating sobre cards de produto, populado pela REST API
 * pública do Konfidency Reviews. Não depende do loader.js (que cuida do PDP
 * e da página /avaliacoes) — é um caminho independente porque o widget JS
 * do Konfidency é grande demais pra caber num badge compacto sobre a imagem.
 *
 * Como funciona:
 *   1. Coleta todos [data-konfidency-rating] visíveis no DOM que ainda
 *      estão `hidden` (sem fallback de metafield)
 *   2. Agrupa IDs únicos, filtra os que já estão no sessionStorage
 *   3. Faz 1 request batch pra /ratings?skus=id1,id2,id3
 *   4. Popula cada elemento + cacheia em sessionStorage por 15min
 *
 * Usa XMLHttpRequest porque a loja Shopify Âme tem apps que sobrescrevem
 * window.fetch (adsagent/Microsoft Clarity) — vide memory.
 */
(function () {
    'use strict';

    if (window.__ameKonfRatingLoaded) return;
    window.__ameKonfRatingLoaded = true;

    const CUSTOMER = 'ameacessoriospet';
    const API_BASE = `https://reviews.konfidency.com.br/${CUSTOMER}`;
    const CACHE_KEY_PREFIX = 'konf:rating:';
    const CACHE_TTL_MS = 15 * 60 * 1000;
    const BATCH_SIZE = 50; // limite seguro pra URL não estourar 2KB

    function lerCache(id) {
        try {
            const raw = sessionStorage.getItem(CACHE_KEY_PREFIX + id);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            if (!obj || typeof obj.at !== 'number') return null;
            if (Date.now() - obj.at > CACHE_TTL_MS) return null;
            return obj.data;
        } catch (_) { return null; }
    }

    function gravarCache(id, data) {
        try {
            sessionStorage.setItem(CACHE_KEY_PREFIX + id, JSON.stringify({ at: Date.now(), data }));
        } catch (_) { /* quota cheia, ignora */ }
    }

    function aplicar(id, data) {
        if (!data || typeof data.aggregateRating !== 'number' || data.aggregateRating <= 0) {
            // Sem reviews — esconde os badges desse produto
            document.querySelectorAll(`[data-konfidency-rating="${id}"]`).forEach(el => {
                el.setAttribute('hidden', '');
            });
            return;
        }
        const nota = data.aggregateRating.toFixed(1).replace('.', ',');
        const ariaLabel = `Avaliação: ${nota} de 5${data.reviewCount ? ` em ${data.reviewCount} avaliações` : ''}`;
        document.querySelectorAll(`[data-konfidency-rating="${id}"]`).forEach(el => {
            const valor = el.querySelector('[data-konfidency-rating-value]');
            if (valor) valor.textContent = nota;
            el.setAttribute('aria-label', ariaLabel);
            el.removeAttribute('hidden');
        });
    }

    function xhrBatch(ids) {
        return new Promise((resolve) => {
            const url = `${API_BASE}/ratings?skus=${encodeURIComponent(ids.join(','))}`;
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.onload = () => {
                if (xhr.status < 200 || xhr.status >= 300) return resolve([]);
                try { resolve(JSON.parse(xhr.responseText) || []); }
                catch (_) { resolve([]); }
            };
            xhr.onerror = () => resolve([]);
            xhr.timeout = 8000;
            xhr.ontimeout = () => resolve([]);
            xhr.send();
        });
    }

    async function processar() {
        const elementos = document.querySelectorAll('[data-konfidency-rating]');
        if (!elementos.length) return;

        const idsTodos = new Set();
        elementos.forEach(el => {
            const id = el.dataset.konfidencyRating;
            if (id) idsTodos.add(id);
        });

        const idsPraBuscar = [];
        idsTodos.forEach(id => {
            const cached = lerCache(id);
            if (cached) {
                aplicar(id, cached);
            } else {
                idsPraBuscar.push(id);
            }
        });

        if (!idsPraBuscar.length) return;

        // Batch em chunks de BATCH_SIZE
        for (let i = 0; i < idsPraBuscar.length; i += BATCH_SIZE) {
            const chunk = idsPraBuscar.slice(i, i + BATCH_SIZE);
            const respostas = await xhrBatch(chunk);
            const porSku = new Map();
            respostas.forEach(r => { if (r && r.sku) porSku.set(String(r.sku), r); });
            chunk.forEach(id => {
                const data = porSku.get(String(id)) || null;
                gravarCache(id, data || { aggregateRating: 0, reviewCount: 0 });
                aplicar(id, data);
            });
        }
    }

    // Roda no load inicial
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', processar);
    } else {
        processar();
    }

    // Re-roda quando novos cards aparecem (paginação ajax, search preditivo,
    // cross-sell no drawer). MutationObserver leve filtrado pra evitar overhead.
    let pendente = null;
    const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.addedNodes && m.addedNodes.length) {
                for (const n of m.addedNodes) {
                    if (n.nodeType === 1 && (n.matches?.('[data-konfidency-rating]') || n.querySelector?.('[data-konfidency-rating]'))) {
                        if (pendente) clearTimeout(pendente);
                        pendente = setTimeout(processar, 150);
                        return;
                    }
                }
            }
        }
    });
    obs.observe(document.body, { childList: true, subtree: true });
})();
