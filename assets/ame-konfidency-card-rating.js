/* Âme — Badge de rating sobre cards de produto, populado pela REST API
 * pública do Konfidency Reviews. Não depende do loader.js (que cuida do PDP
 * e da página /avaliacoes) — é um caminho independente porque o widget JS
 * do Konfidency é grande demais pra caber num badge compacto sobre a imagem.
 *
 * Suporta AGREGAÇÃO de SKUs: quando `data-konfidency-rating` traz uma lista
 * CSV (ex: "id1,id2,id3"), soma todos os reviewCount e calcula a média
 * ponderada. Necessário pq muitos produtos Shopify novos consolidam vários
 * produtos Nuvemshop antigos — vide snippets/konfidency-id.liquid.
 *
 * Como funciona:
 *   1. Coleta todos `data-konfidency-rating` no DOM (cada valor pode ser
 *      um ID singular ou CSV de IDs)
 *   2. Junta todos os IDs únicos em um Set; tenta cache (chave = grupo CSV
 *      original); chama API só pros grupos não cacheados
 *   3. Faz request batch /ratings/?skus=id1,id2,... com todos os IDs flat
 *   4. Pra cada grupo, agrega os ratings dos IDs que retornaram e popula
 *   5. Cacheia o resultado AGREGADO por grupo (15min sessionStorage)
 *
 * Usa XMLHttpRequest porque a loja Shopify Âme tem apps que sobrescrevem
 * window.fetch (adsagent/Microsoft Clarity) — vide memory.
 */
(function () {
    'use strict';

    if (window.__ameKonfRatingLoaded) return;
    window.__ameKonfRatingLoaded = true;

    const CUSTOMER = 'ameacessoriospet';
    // Endpoint API real é `reviews-api.konfidency.com.br` — o host
    // `reviews.konfidency.com.br` serve só o loader.js (CDN/S3 estático,
    // 404 em /ratings). Sufixo `/?_v=3` espelha o loader oficial.
    const API_BASE = `https://reviews-api.konfidency.com.br/${CUSTOMER}`;
    // v3: introduzimos agregação de CSV (formato de cache mudou).
    const CACHE_KEY_PREFIX = 'konf:rating:v3:';
    const CACHE_TTL_MS = 15 * 60 * 1000;
    const BATCH_SIZE = 80; // URLs do Shopify CDN suportam até ~4 KB; grupos de 80 IDs ≈ 1 KB

    function lerCache(grupoKey) {
        try {
            const raw = sessionStorage.getItem(CACHE_KEY_PREFIX + grupoKey);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            if (!obj || typeof obj.at !== 'number') return null;
            if (Date.now() - obj.at > CACHE_TTL_MS) return null;
            return obj.data;
        } catch (_) { return null; }
    }

    function gravarCache(grupoKey, data) {
        try {
            sessionStorage.setItem(CACHE_KEY_PREFIX + grupoKey, JSON.stringify({ at: Date.now(), data }));
        } catch (_) { /* quota cheia, ignora */ }
    }

    // Agrega N respostas individuais num único {aggregateRating, reviewCount}.
    //
    // Por que dedup por assinatura: a Konfidency armazena reviews por "produto
    // pai Nuvemshop" e devolve as MESMAS reviews pra todas as variantes-de-cor
    // (ex: 36 SKUs do Atena retornam `5 × 115` idêntico). Somar direto inflaria
    // pra 4140 reviews falsas. Heurística: assinatura (rating, count) idêntica
    // = mesma pool de reviews, conta uma vez. Variantes genuinamente diferentes
    // (lançadas depois com reviews próprias) terão `count` diferente e somam OK.
    function agregar(respostasDoGrupo) {
        const seen = new Set();
        let totalCount = 0;
        let weightedSum = 0;
        respostasDoGrupo.forEach(r => {
            if (!r || typeof r.aggregateRating !== 'number') return;
            const c = parseInt(r.reviewCount, 10) || 0;
            if (c <= 0) return;
            // Round o rating pra evitar drift de float em assinaturas (5 vs 5.0000001)
            const sig = r.aggregateRating.toFixed(3) + ':' + c;
            if (seen.has(sig)) return;
            seen.add(sig);
            totalCount += c;
            weightedSum += r.aggregateRating * c;
        });
        if (totalCount === 0) return { aggregateRating: 0, reviewCount: 0 };
        return {
            aggregateRating: weightedSum / totalCount,
            reviewCount: totalCount,
        };
    }

    function aplicar(grupoKey, data) {
        if (!data || typeof data.aggregateRating !== 'number' || data.aggregateRating <= 0) {
            // Sem reviews em nenhum SKU do grupo — esconde os badges
            document.querySelectorAll(`[data-konfidency-rating="${grupoKey}"]`).forEach(el => {
                el.setAttribute('hidden', '');
            });
            return;
        }
        const nota = data.aggregateRating.toFixed(1).replace('.', ',');
        const ariaLabel = `Avaliação: ${nota} de 5${data.reviewCount ? ` em ${data.reviewCount} avaliações` : ''}`;
        document.querySelectorAll(`[data-konfidency-rating="${grupoKey}"]`).forEach(el => {
            const valor = el.querySelector('[data-konfidency-rating-value]');
            if (valor) valor.textContent = nota;
            el.setAttribute('aria-label', ariaLabel);
            el.removeAttribute('hidden');
        });
    }

    function xhrBatch(ids) {
        return new Promise((resolve) => {
            const url = `${API_BASE}/ratings/?skus=${encodeURIComponent(ids.join(','))}&_v=3`;
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

        // Coleta grupos únicos (cada grupo é a string CSV original do atributo).
        const gruposTodos = new Set();
        elementos.forEach(el => {
            const grupo = el.dataset.konfidencyRating;
            if (grupo) gruposTodos.add(grupo);
        });

        // Aplica do cache + identifica grupos que precisam de fetch
        const gruposPraBuscar = [];
        const idsParaApi = new Set();
        gruposTodos.forEach(grupo => {
            const cached = lerCache(grupo);
            if (cached) {
                aplicar(grupo, cached);
                return;
            }
            gruposPraBuscar.push(grupo);
            grupo.split(',').forEach(id => {
                const trimmed = id.trim();
                if (trimmed) idsParaApi.add(trimmed);
            });
        });

        if (idsParaApi.size === 0) return;

        // Batch fetch de todos os IDs únicos (1 ou múltiplas requests se passar BATCH_SIZE)
        const idsFlat = [...idsParaApi];
        const porSku = new Map();
        for (let i = 0; i < idsFlat.length; i += BATCH_SIZE) {
            const chunk = idsFlat.slice(i, i + BATCH_SIZE);
            const respostas = await xhrBatch(chunk);
            respostas.forEach(r => { if (r && r.sku) porSku.set(String(r.sku), r); });
        }

        // Pra cada grupo, agrega os ratings dos SKUs que retornaram, cacheia e aplica
        gruposPraBuscar.forEach(grupo => {
            const skus = grupo.split(',').map(s => s.trim()).filter(Boolean);
            const respostasDoGrupo = skus.map(sku => porSku.get(sku)).filter(Boolean);
            const dataAgregada = agregar(respostasDoGrupo);
            gravarCache(grupo, dataAgregada);
            aplicar(grupo, dataAgregada);
        });
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
