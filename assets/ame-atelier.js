/**
 * Ateliê — a coleira montada em etapas (sections/atelier-coleira.liquid).
 *
 * Etapas: Cores · Metal · Tamanho · Pingente · Resumo (índices em `E`).
 * O nome do pet só é pedido dentro do Pingente, depois de escolher um tipo.
 *
 * O palco mostra a FOTO REAL da combinação escolhida. As 104 fotos (26 cores ×
 * 4 metais) têm o mesmo enquadramento (medido em 13/10/2026: a coleira ocupa
 * x 7,5–94 %, y 35,8–58,8 % em todas), então trocar a foto parece a cor sendo
 * aplicada na mesma peça, e dá para mirar fivela, passador e argola por
 * coordenada fixa (PONTOS, abaixo). Se um dia entrarem fotos com outro
 * enquadramento, o zoom e o pingente pendurado erram de lugar — conferir.
 *
 * O pingente é DESENHADO (SVG), não fotografado: as fotos dos pingentes vêm
 * com "nome do seu pet" gravado, e o ponto aqui é a cliente ver o nome DELA.
 *
 * Carrinho: as mesmas properties da página normal (ver o comentário da seção),
 * mais `_origem = 'atelier'` nas duas linhas para o relatório do Waltz.
 */
(function () {
    'use strict';

    const root = document.querySelector('[data-atl]');
    if (!root) return;

    let CFG;
    try {
        CFG = JSON.parse(root.querySelector('[data-atl-config]').textContent);
    } catch (e) {
        console.error('[ateliê] configuração ilegível', e);
        return;
    }

    // ═══════════════════════════ utilidades ═══════════════════════════

    const $ = (s, el) => (el || root).querySelector(s);
    const $$ = (s, el) => Array.from((el || root).querySelectorAll(s));
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const compacto = (s) => norm(s).replace(/[^a-z0-9]/g, '');
    const slugify = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    const dinheiro = (cents) => BRL.format((cents || 0) / 100);
    const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ehToque = window.matchMedia('(hover: none)').matches;
    const espera = (ms) => new Promise((r) => setTimeout(r, ms));

    // Emoji e símbolos saem: o conector Shopify→Tiny corta a observação no
    // primeiro emoji, e não dá para gravar emoji no metal (igual ao snippet
    // pingente-customization).
    function semEmoji(v) {
        v = String(v == null ? '' : v).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');
        try {
            v = v.replace(/[←-⇿⌀-➿☀-⛿⬀-⯿︀-️‍⃣]/g, '');
        } catch (e) { /* no-op */ }
        return v;
    }
    const limpo = (v) => semEmoji(v).replace(/[ \t]{2,}/g, ' ').trim();

    // XHR e não fetch: apps da loja sobrescrevem window.fetch e engolem o
    // POST do /cart/add.js (comentário em sections/product.liquid).
    function xhr(metodo, url, corpo, timeout) {
        return new Promise((resolve, reject) => {
            const x = new XMLHttpRequest();
            x.open(metodo, url, true);
            x.setRequestHeader('Accept', 'application/json');
            if (corpo) {
                x.setRequestHeader('Content-Type', 'application/json');
                x.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            }
            x.timeout = timeout || 15000;
            x.onload = () => {
                let json = null;
                try { json = JSON.parse(x.responseText); } catch (e) { /* corpo não-JSON */ }
                if (x.status >= 200 && x.status < 300) return resolve(json);
                const erro = new Error('HTTP ' + x.status);
                erro.status = x.status;
                erro.corpo = json || x.responseText.slice(0, 300);
                reject(erro);
            };
            x.onerror = () => reject(new Error('rede'));
            x.ontimeout = () => reject(new Error('tempo esgotado'));
            x.send(corpo ? JSON.stringify(corpo) : null);
        });
    }

    const guarda = {
        // v2: em 13/10/2026 a etapa Nome saiu e os índices mudaram.
        chave: 'ame-atelier:v2:' + CFG.handle,
        ler() {
            try { return JSON.parse(window.localStorage.getItem(this.chave) || 'null'); } catch (e) { return null; }
        },
        gravar(v) {
            try { window.localStorage.setItem(this.chave, JSON.stringify(v)); } catch (e) { /* modo privado */ }
        },
        apagar() {
            try { window.localStorage.removeItem(this.chave); } catch (e) { /* no-op */ }
        },
    };

    function publicar(evento, dados) {
        try { window.Shopify && window.Shopify.analytics && window.Shopify.analytics.publish('atelier_' + evento, dados || {}); } catch (e) { /* no-op */ }
        try { if (Array.isArray(window.dataLayer)) window.dataLayer.push(Object.assign({ event: 'atelier_' + evento }, dados || {})); } catch (e) { /* no-op */ }
    }

    // ═══════════════════════════ estado ═══════════════════════════

    const PASSOS = ['Cores', 'Metal', 'Tamanho', 'Pingente', 'Resumo'];
    // Índice de cada etapa pelo nome: mudar a ordem é mudar só aqui.
    const E = { cores: 0, metal: 1, tamanho: 2, pingente: 3, resumo: 4 };
    const S = {
        passo: 0,
        maxPasso: 0,
        couro: null,      // cor principal ("Allure")
        cor: null,        // valor da opção Cor ("Allure com Off White")
        metal: null,
        tamanho: null,
        tamanhoManual: false,
        raca: '',
        idade: '',
        idadeUn: 'anos',
        peso: '',
        extras: {},       // outros campos personalizados, por nome
        pTipo: null,      // 'nenhum' | 'metal' | 'couro' | 'metal-couro'
        pFormato: null,
        pFrente: '',      // nome do pet: frente do pingente
        pTutor: '',
        pTel: '',
    };
    const CAMPOS_SALVOS = ['maxPasso', 'couro', 'cor', 'metal', 'tamanho', 'tamanhoManual', 'raca', 'idade', 'idadeUn', 'peso', 'extras', 'pTipo', 'pFormato', 'pFrente', 'pTutor', 'pTel'];

    let salvarTimer = 0;
    function salvar() {
        clearTimeout(salvarTimer);
        salvarTimer = setTimeout(() => {
            const dados = { salvoEm: Date.now() };
            CAMPOS_SALVOS.forEach((k) => (dados[k] = S[k]));
            guarda.gravar(dados);
        }, 250);
    }

    // ═══════════════════════════ catálogo ═══════════════════════════

    /** Modelo da coleira montado a partir do produto completo do Waltz. */
    let M = null;
    let TM = null;                       // tabela de medidas (Waltz)
    const pingentes = new Map();         // handle → produto da loja (Promise)

    function indiceOpcao(opcoes, testes) {
        return opcoes.findIndex((o) => testes.some((t) => t(norm(typeof o === 'string' ? o : o.name))));
    }

    function montarModelo(prod) {
        const opcoes = prod.options || [];
        // Metal ANTES de cor: "cor do metal" contém "cor".
        const iMetal = indiceOpcao(opcoes, [(n) => n === 'cor do metal', (n) => n === 'metal', (n) => n.includes('metal')]);
        const iCor = indiceOpcao(opcoes, [(n, i) => n === 'cor']);
        const iTam = indiceOpcao(opcoes, [(n) => n === 'tamanho']);
        if (iMetal < 0 || iCor < 0 || iTam < 0) throw new Error('opções inesperadas: ' + opcoes.map((o) => o.name || o).join(', '));

        const ov = (v, i) => v['option' + (i + 1)];
        const variantes = new Map();
        const fotos = new Map();
        const precoTam = new Map();
        const deTam = new Map();
        for (const v of prod.variants || []) {
            const t = ov(v, iTam), c = ov(v, iCor), m = ov(v, iMetal);
            variantes.set(t + '|' + c + '|' + m, v);
            const src = v.featured_image && (v.featured_image.src || v.featured_image);
            if (src && !fotos.has(c + '|' + m)) fotos.set(c + '|' + m, src);
            if (!precoTam.has(t) || v.price < precoTam.get(t)) precoTam.set(t, v.price);
            if (v.compare_at_price && v.compare_at_price > v.price) deTam.set(t, v.compare_at_price);
        }

        const valores = (i) => (opcoes[i].values || []).map(String);

        // Cor composta: a PRIMEIRA parte é o couro, o resto é o passador
        // ("Allure com Off White"). Cor sem " com " é couro e passador iguais.
        const couros = [];
        const porCouro = new Map();
        for (const cor of valores(iCor)) {
            const partes = cor.split(/\s+com\s+/i);
            const couro = partes[0].trim();
            const passador = partes.length > 1 ? partes.slice(1).join(' com ').trim() : null;
            if (!porCouro.has(couro)) {
                porCouro.set(couro, []);
                couros.push(couro);
            }
            porCouro.get(couro).push({ cor, passador });
        }
        // Sem passador (cor lisa) vem primeiro.
        porCouro.forEach((lista) => lista.sort((a, b) => (a.passador ? 1 : 0) - (b.passador ? 1 : 0)));

        return {
            iTam, iCor, iMetal,
            tamanhos: valores(iTam),
            metais: valores(iMetal),
            couros,
            porCouro,
            variantes,
            fotos,
            precoTam,
            deTam,
            variante(t, c, m) { return variantes.get(t + '|' + c + '|' + m) || null; },
            foto(c, m) { return fotos.get(c + '|' + m) || null; },
        };
    }

    // ── Cores e metais ──
    const SWATCH = {};
    Object.keys(CFG.swatches || {}).forEach((k) => (SWATCH[norm(k)] = CFG.swatches[k]));
    const hexDe = (nome) => SWATCH[norm(nome)] || '#cdbfb2';

    function claroOuEscuro(hex) {
        const h = String(hex || '').replace('#', '');
        if (h.length < 6) return 'claro';
        const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
        return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? 'claro' : 'escuro';
    }

    const METAL_ESTILO = {
        ouro: { g: ['#fff4d6', '#ecd08a', '#cfa24a', '#a87b2c', '#7d5a1f'], aresta: '#8a6322', gravura: '#4a3210', luz: '#fff8e6' },
        prata: { g: ['#ffffff', '#e8e8ea', '#c2c3c7', '#9c9da2', '#6e6f74'], aresta: '#7a7b80', gravura: '#2c2d30', luz: '#ffffff' },
        rose: { g: ['#fff1eb', '#f3c9b9', '#dc9e8e', '#ba7a6b', '#8c5749'], aresta: '#925e51', gravura: '#55291f', luz: '#fff0ea' },
        grafite: { g: ['#a3a3a6', '#707074', '#4a4a4e', '#2f2f32', '#1a1a1c'], aresta: '#202022', gravura: '#e6e6e8', luz: '#d9d9dc' },
    };
    const chaveMetal = (m) => {
        const n = compacto(m);
        if (n.startsWith('ouro') || n.startsWith('dourad')) return 'ouro';
        if (n.startsWith('prat')) return 'prata';
        if (n.startsWith('rose') || n.startsWith('rosa')) return 'rose';
        if (n.startsWith('grafit') || n.startsWith('negr') || n.startsWith('pret')) return 'grafite';
        return 'ouro';
    };
    const fundoMetal = (m) => {
        const g = METAL_ESTILO[chaveMetal(m)].g;
        return `linear-gradient(135deg, ${g[0]} 0%, ${g[1]} 28%, ${g[2]} 55%, ${g[3]} 78%, ${g[4]} 100%)`;
    };

    /** "Ouro | descrição | Camel, Nude" → { ouro: { desc, combina: Set } } */
    const METAL_INFO = {};
    String(CFG.metais || '').split(/\r?\n/).forEach((linha) => {
        const p = linha.split('|').map((s) => s.trim());
        if (!p[0]) return;
        METAL_INFO[chaveMetal(p[0])] = {
            desc: p[1] || '',
            combina: new Set(String(p[2] || '').split(',').map(norm).filter(Boolean)),
        };
    });

    // ═══════════════════════════ pingente: dados ═══════════════════════════

    const PG = CFG.pingente || {};
    const lista = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s || '').trim()).filter(Boolean);
    const HANDLES = { metal: PG.metal ? [PG.metal] : [], couro: lista(PG.couro), 'metal-couro': lista(PG.metalCouro) };
    const MAPA_PADRAO = { XPP: 'P', 'XPP+': 'P', PP: 'P', P: 'P', M: 'G', G: 'G' };
    const MAPA = Object.assign({}, MAPA_PADRAO);
    String(PG.mapaTamanho || '').split(',').forEach((par) => {
        const [k, v] = par.split('=').map((s) => (s || '').trim());
        if (k && v) MAPA[k] = v;
    });
    const IGNORAR = lista(PG.ignorar).map((s) => s.toLowerCase());
    const REMOVER = lista(PG.remover);

    // Mesma regra do snippet: o couro do pingente é a ÚLTIMA cor ("Allure com
    // Off White" → Off White), depois de tirar pedras e termos ignorados.
    function ultimaCor(cor) {
        let c = String(cor || '');
        REMOVER.forEach((t) => {
            c = c.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
        });
        c = c.replace(/\s+/g, ' ').replace(/\s+(com|e)\s*$/i, '').trim();
        const partes = c.split(/\s+com\s+/i).map((s) => s.trim()).filter(Boolean);
        for (let i = partes.length - 1; i >= 0; i--) {
            const l = partes[i].toLowerCase();
            if (!IGNORAR.some((t) => t && l.startsWith(t))) return partes[i];
        }
        return partes[0] || '';
    }

    function handlePingente(tipo, cor) {
        const escopo = HANDLES[tipo] || [];
        if (tipo === 'metal') return escopo[0] || null;
        const slug = slugify(ultimaCor(cor));
        if (!slug) return null;
        return escopo.find((h) => h === slug || h.endsWith('-' + slug)) || null;
    }

    function produtoPingente(handle) {
        if (!handle) return Promise.resolve(null);
        if (!pingentes.has(handle)) {
            pingentes.set(handle, xhr('GET', '/products/' + encodeURIComponent(handle) + '.js').catch((e) => {
                console.warn('[ateliê] pingente indisponível', handle, e.message);
                pingentes.delete(handle);
                return null;
            }));
        }
        return pingentes.get(handle);
    }

    function indicesPingente(prod) {
        const nomes = (prod.options || []).map((o) => norm(typeof o === 'string' ? o : o.name));
        const acha = (testes) => nomes.findIndex((n) => testes.some((t) => n === t || n.startsWith(t + ' ') || n.endsWith(' ' + t) || n.includes(' ' + t + ' ')));
        return { formato: acha(['formato']), metal: acha(['cor do metal', 'metal']), tamanho: acha(['tamanho', 'size']), nomes };
    }

    function variantePingente(prod, formato, metal, tamanhoColeira) {
        if (!prod) return null;
        const ix = indicesPingente(prod);
        if (ix.formato < 0) return null;
        const candidatos = [MAPA[tamanhoColeira], MAPA_PADRAO[tamanhoColeira]].filter(Boolean);
        if (!candidatos.length) candidatos.push(null);
        for (const tam of candidatos) {
            const v = prod.variants.find((vv) => {
                if (vv['option' + (ix.formato + 1)] !== formato) return false;
                if (ix.metal >= 0 && metal && vv['option' + (ix.metal + 1)] !== metal) return false;
                if (ix.tamanho >= 0 && tam && vv['option' + (ix.tamanho + 1)] !== tam) return false;
                return true;
            });
            if (v && v.available) return v;
        }
        return null;
    }

    function formatosDe(prod) {
        if (!prod) return [];
        const ix = indicesPingente(prod);
        if (ix.formato < 0) return [];
        const o = prod.options[ix.formato];
        const vals = (o.values || []).map(String);
        const ordem = ['coracao', 'osso', 'circulo', 'flor'];
        return vals.sort((a, b) => {
            const ia = ordem.indexOf(compacto(a)), ib = ordem.indexOf(compacto(b));
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
    }

    // ═══════════════════════════ pingente: desenho ═══════════════════════════

    function florPath(cx, cy, n, d, rp, rot) {
        const C = [];
        for (let i = 0; i < n; i++) {
            const a = rot + (i * 2 * Math.PI) / n;
            C.push([cx + d * Math.cos(a), cy + d * Math.sin(a)]);
        }
        const P = C.map((c, i) => {
            const c2 = C[(i + 1) % n];
            const mx = (c[0] + c2[0]) / 2, my = (c[1] + c2[1]) / 2;
            const dx = c2[0] - c[0], dy = c2[1] - c[1];
            const L = Math.hypot(dx, dy);
            const h = Math.sqrt(Math.max(0, rp * rp - (L / 2) * (L / 2)));
            let ux = -dy / L, uy = dx / L;
            if ((mx - cx) * ux + (my - cy) * uy < 0) { ux = -ux; uy = -uy; }
            return [mx + ux * h, my + uy * h];
        });
        const f = (v) => v.toFixed(2);
        let s = `M${f(P[n - 1][0])},${f(P[n - 1][1])}`;
        for (let i = 0; i < n; i++) {
            const a0 = Math.atan2(P[(i + n - 1) % n][1] - C[i][1], P[(i + n - 1) % n][0] - C[i][0]);
            let a1 = Math.atan2(P[i][1] - C[i][1], P[i][0] - C[i][0]);
            while (a1 < a0) a1 += 2 * Math.PI;
            const grande = a1 - a0 > Math.PI ? 1 : 0;
            s += ` A${rp},${rp} 0 ${grande},1 ${f(P[i][0])},${f(P[i][1])}`;
        }
        return s + ' Z';
    }

    // viewBox 0..100. As quatro formas são simétricas e o furo fica no
    // CENTRO, em cima, como nas peças reais (fotos "Wendy" e "Bento" que o
    // Muriel mandou em 13/10/2026). Por isso o pingente pendura reto, com o
    // nome alinhado à coleira, e o verso é o mesmo recorte, sem espelhar.
    //
    // `texto` e `verso`: centro (x, y), largura e altura úteis, corpo máximo
    // da letra e quantas linhas cabem. O nome é medido e encolhe até caber
    // nos dois sentidos, então nunca sai da peça.
    //
    // O OSSO foi traçado da foto do pingente "Bento" (raios do centro até a
    // borda dourada, simetria esquerda/direita, média de 5°): 92 × 56 unidades,
    // proporção 1,64 como a peça. Para retraçar com outra foto: de cada grau,
    // um raio vindo de FORA até o primeiro pixel do aro (dourado ou sombra),
    // a argola e a corrente descartadas, simetria esquerda/direita, média de
    // 5° e 72 pontos ligados por Catmull-Rom.
    const OSSO_D = 'M90.23,55.14 C90.38,56.38 92.48,57.61 93.16,58.91 C93.84,60.22 93.87,61.53 94.32,62.95 C94.78,64.37 95.72,65.98 95.90,67.44 C96.09,68.89 95.78,70.32 95.44,71.67 C95.09,73.03 94.51,74.35 93.80,75.56 C93.10,76.77 92.27,77.96 91.21,78.93 C90.15,79.89 88.79,80.69 87.45,81.36 C86.10,82.02 84.74,82.67 83.13,82.93 C81.52,83.19 79.54,83.06 77.79,82.92 C76.04,82.79 74.33,82.55 72.63,82.11 C70.93,81.66 69.16,80.94 67.58,80.25 C66.01,79.56 64.44,78.58 63.17,77.94 C61.89,77.31 60.90,76.85 59.94,76.46 C58.99,76.08 58.23,75.88 57.47,75.65 C56.70,75.42 56.01,75.24 55.34,75.08 C54.67,74.92 54.06,74.80 53.45,74.69 C52.84,74.58 52.26,74.47 51.69,74.42 C51.11,74.37 50.56,74.41 50.00,74.41 C49.44,74.41 48.89,74.37 48.31,74.42 C47.74,74.47 47.16,74.58 46.55,74.69 C45.94,74.80 45.33,74.92 44.66,75.08 C43.99,75.24 43.30,75.42 42.53,75.65 C41.77,75.88 41.01,76.08 40.06,76.46 C39.10,76.85 38.11,77.31 36.83,77.94 C35.56,78.58 33.99,79.56 32.42,80.25 C30.84,80.94 29.07,81.66 27.37,82.11 C25.67,82.55 23.96,82.79 22.21,82.92 C20.46,83.06 18.48,83.19 16.87,82.93 C15.26,82.67 13.90,82.02 12.55,81.36 C11.21,80.69 9.85,79.89 8.79,78.93 C7.73,77.96 6.90,76.77 6.20,75.56 C5.49,74.35 4.91,73.03 4.56,71.67 C4.22,70.32 3.91,68.89 4.10,67.44 C4.28,65.98 5.22,64.37 5.68,62.95 C6.13,61.53 6.16,60.22 6.84,58.91 C7.52,57.61 9.62,56.38 9.77,55.14 C9.91,53.89 8.48,52.75 7.71,51.44 C6.94,50.12 5.77,48.66 5.17,47.23 C4.56,45.80 4.20,44.28 4.10,42.84 C4.00,41.40 4.24,39.97 4.55,38.59 C4.85,37.22 5.17,35.76 5.95,34.60 C6.74,33.43 8.09,32.51 9.26,31.62 C10.43,30.72 11.78,29.99 12.96,29.20 C14.14,28.42 14.88,27.28 16.35,26.90 C17.82,26.52 19.97,26.73 21.80,26.94 C23.64,27.15 25.61,27.67 27.34,28.14 C29.08,28.60 30.70,29.15 32.21,29.74 C33.73,30.32 35.21,31.12 36.45,31.66 C37.69,32.21 38.74,32.72 39.67,32.98 C40.60,33.24 41.27,33.13 42.02,33.20 C42.77,33.27 43.48,33.34 44.18,33.40 C44.87,33.47 45.54,33.53 46.20,33.59 C46.86,33.65 47.50,33.72 48.13,33.78 C48.76,33.83 49.38,33.90 50.00,33.90 C50.62,33.90 51.24,33.83 51.87,33.78 C52.50,33.72 53.14,33.65 53.80,33.59 C54.46,33.53 55.13,33.47 55.82,33.40 C56.52,33.34 57.23,33.27 57.98,33.20 C58.73,33.13 59.40,33.24 60.33,32.98 C61.26,32.72 62.31,32.21 63.55,31.66 C64.79,31.12 66.27,30.32 67.79,29.74 C69.30,29.15 70.92,28.60 72.66,28.14 C74.39,27.67 76.36,27.15 78.20,26.94 C80.03,26.73 82.18,26.52 83.65,26.90 C85.12,27.28 85.86,28.42 87.04,29.20 C88.22,29.99 89.57,30.72 90.74,31.62 C91.91,32.51 93.26,33.43 94.05,34.60 C94.83,35.76 95.15,37.22 95.45,38.59 C95.76,39.97 96.00,41.40 95.90,42.84 C95.80,44.28 95.44,45.80 94.83,47.23 C94.23,48.66 93.06,50.12 92.29,51.44 C91.52,52.75 90.09,53.89 90.23,55.14 Z';
    const ARGOLA_RY = 8.5; // a argola, vista de frente, é um aro estreito na vertical ("I")
    const FORMAS = {
        circulo: {
            d: 'M12,54 A38,38 0 1,0 88,54 A38,38 0 1,0 12,54 Z',
            furo: [50, 20.5],
            texto: { x: 50, y: 54, w: 58, h: 34, max: 17, linhas: 2 },
            verso: { x: 50, y: 55, w: 60, h: 30, max: 10, linhas: 2 },
        },
        coracao: {
            d: 'M50,90 C46,86 10,62 10,36 C10,22 21,13 33,13 C41,13 47,18 50,24 C53,18 59,13 67,13 C79,13 90,22 90,36 C90,62 54,86 50,90 Z',
            furo: [50, 29],
            texto: { x: 50, y: 49, w: 54, h: 28, max: 15, linhas: 2 },
            verso: { x: 50, y: 49, w: 52, h: 24, max: 9, linhas: 2 },
        },
        flor: {
            d: florPath(50, 54, 6, 25, 15, -Math.PI / 2),
            furo: [50, 19.5],
            texto: { x: 50, y: 54, w: 50, h: 32, max: 15, linhas: 2 },
            verso: { x: 50, y: 55, w: 50, h: 26, max: 9, linhas: 2 },
        },
        osso: {
            d: OSSO_D,
            furo: [50, 37.5],
            texto: { x: 50, y: 57, w: 62, h: 26, max: 19, linhas: 1 },
            verso: { x: 50, y: 57.5, w: 64, h: 26, max: 10, linhas: 2 },
        },
    };
    const formaDe = (formato) => FORMAS[compacto(formato)] || FORMAS.coracao;

    // Gravação em Exo Medium (a fonte da gravação de verdade). A largura é
    // medida no canvas para o nome caber na peça; até a fonte carregar, uma
    // estimativa, e o pingente é redesenhado quando ela chega.
    const FONTE_GRAVACAO = "Exo, 'Lexend', system-ui, sans-serif";
    const medidor = document.createElement('canvas').getContext('2d');
    let exoPronta = false;
    function larguraPorCorpo(texto) {
        if (exoPronta && medidor) {
            medidor.font = '500 100px Exo';
            return medidor.measureText(String(texto)).width / 100;
        }
        return String(texto).length * 0.58;
    }
    if (document.fonts && document.fonts.load) {
        document.fonts.load('500 20px Exo').then(() => {
            exoPronta = document.fonts.check('500 20px Exo');
            if (!exoPronta) return;
            if (palco.dataset.modo === 'p3d') desenhar3D();
            desenharPendurado();
            if (S.passo === E.pingente) renderTipos();
        }).catch(() => { /* fica a estimativa */ });
    }

    let svgSeq = 0;

    /**
     * Uma face do pingente. `lado` = 'frente' | 'verso' | 'aresta'.
     * Couro e metal com couro são iguais dos dois lados; o metal é metal dos dois.
     */
    function svgPingente(op) {
        const id = 'atlp' + (++svgSeq);
        const f = formaDe(op.formato);
        const me = METAL_ESTILO[chaveMetal(op.metal)];
        const couroHex = op.couroHex || '#d3cec3';
        const verso = op.lado === 'verso';
        const temCouro = op.tipo === 'couro' || op.tipo === 'metal-couro';
        const tudoCouro = op.tipo === 'couro';

        if (op.lado === 'aresta') {
            const cor = tudoCouro ? sombraHex(couroHex, 0.62) : me.aresta;
            return `<svg viewBox="-8 -8 116 116" aria-hidden="true"><path d="${f.d}" fill="${cor}"/></svg>`;
        }

        const g = me.g;
        const defs = `
          <defs>
            <linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="${g[0]}"/><stop offset=".3" stop-color="${g[1]}"/>
              <stop offset=".58" stop-color="${g[2]}"/><stop offset=".8" stop-color="${g[3]}"/><stop offset="1" stop-color="${g[4]}"/>
            </linearGradient>
            <linearGradient id="${id}b" gradientUnits="userSpaceOnUse" x1="-40" y1="0" x2="60" y2="100" gradientTransform="translate(${op.brilhoX || 0} 0)" data-atl-brilho-grad>
              <stop offset=".35" stop-color="#fff" stop-opacity="0"/>
              <stop offset=".5" stop-color="${me.luz}" stop-opacity="${tudoCouro ? 0.16 : 0.55}"/>
              <stop offset=".65" stop-color="#fff" stop-opacity="0"/>
            </linearGradient>
            <clipPath id="${id}c"><path d="${f.d}"/></clipPath>
            <filter id="${id}g" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency=".62" numOctaves="2" seed="11" result="n"/>
              <feDiffuseLighting in="n" surfaceScale=".9" lighting-color="#fff" result="l"><feDistantLight azimuth="235" elevation="60"/></feDiffuseLighting>
              <feComponentTransfer in="l" result="l2"><feFuncR type="linear" slope=".34" intercept=".72"/><feFuncG type="linear" slope=".34" intercept=".72"/><feFuncB type="linear" slope=".34" intercept=".72"/></feComponentTransfer>
              <feComposite in="l2" in2="SourceAlpha" operator="in" result="lc"/>
              <feBlend in="SourceGraphic" in2="lc" mode="multiply"/>
            </filter>
          </defs>`;

        let corpo = '';
        if (tudoCouro) {
            corpo += `<path d="${f.d}" fill="${couroHex}" filter="url(#${id}g)"/>`;
        } else if (temCouro) {
            // Metal com couro: couro por dentro e aro de metal. O traço grosso
            // recortado pela própria forma deixa só a metade de dentro.
            corpo += `<path d="${f.d}" fill="${couroHex}" filter="url(#${id}g)"/>`;
            corpo += `<path d="${f.d}" fill="none" stroke="url(#${id}m)" stroke-width="5.4" clip-path="url(#${id}c)"/>`;
        } else {
            corpo += `<path d="${f.d}" fill="url(#${id}m)"/>`;
        }
        // Bisel: luz em cima, sombra embaixo, sempre dentro da forma.
        corpo += `<g clip-path="url(#${id}c)">
            <path d="${f.d}" fill="none" stroke="rgba(255,255,255,${tudoCouro ? 0.18 : 0.55})" stroke-width="2.2" transform="translate(.6 .9)"/>
            <path d="${f.d}" fill="none" stroke="rgba(0,0,0,${tudoCouro ? 0.2 : 0.28})" stroke-width="2.2" transform="translate(-.6 -.9)"/>
          </g>`;

        // Furo no centro, em cima. No couro e no metal com couro, um ilhós de metal.
        const fx = f.furo[0], fy = f.furo[1];
        if (temCouro) corpo += `<circle cx="${fx}" cy="${fy}" r="3.4" fill="none" stroke="url(#${id}m)" stroke-width="1.6"/>`;
        corpo += `<circle cx="${fx}" cy="${fy}" r="2.1" fill="rgba(32,27,20,.6)"/>`;
        // A argola atravessa o furo de lado: de frente ela é um aro estreito
        // na vertical, como um "I" (no 3D, um aro perpendicular vira "O" ao girar).
        let argola = '';
        if (op.argola !== false) {
            const ay = fy - ARGOLA_RY + 1.6;
            argola = `<g fill="none">
                <ellipse cx="${fx}" cy="${ay}" rx="2.5" ry="${ARGOLA_RY}" stroke="${me.aresta}" stroke-width="2.6"/>
                <ellipse cx="${fx}" cy="${ay}" rx="2.5" ry="${ARGOLA_RY}" stroke="url(#${id}m)" stroke-width="1.5"/>
                <path d="M${fx - 1.2},${ay - ARGOLA_RY + 1.4} L${fx - 1.2},${ay + ARGOLA_RY - 1.4}" stroke="rgba(255,255,255,.55)" stroke-width=".5" stroke-linecap="round"/>
              </g>`;
        }

        if (op.semTexto) {
            const brilhoMini = `<rect x="-10" y="-10" width="120" height="120" fill="url(#${id}b)" clip-path="url(#${id}c)" style="mix-blend-mode:screen"/>`;
            return `<svg viewBox="-8 -8 116 116" aria-hidden="true">${defs}${corpo}${brilhoMini}${argola}</svg>`;
        }

        // Gravação: sempre PRETA, porque é queimada a laser (metal ou couro).
        // O corpo da letra é o maior que cabe na largura E na altura da área.
        const area = verso ? f.verso : f.texto;
        const linhas = (verso ? [op.tutor, op.tel] : quebrarNome(op.nome, area.linhas)).filter((l) => l && String(l).trim());
        const vazio = !linhas.length;
        const marcador = verso ? ['Nome do tutor', '11 99999-9999'] : (area.linhas > 1 ? ['nome do', 'seu pet'] : ['nome do pet']);
        const usar = vazio ? marcador : linhas;
        const maior = usar.reduce((m, l) => Math.max(m, larguraPorCorpo(l)), 0.01);
        const lhFator = 1.12;
        const fs = Math.max(3.6, Math.min(area.max, area.w / maior, area.h / (usar.length * lhFator)));
        const lh = fs * lhFator;
        const y0 = area.y - ((usar.length - 1) * lh) / 2 + fs * 0.36;
        const tspans = usar.map((l, i) => `<tspan x="${area.x}" y="${(y0 + i * lh).toFixed(2)}">${esc(l)}</tspan>`).join('');
        const gravura = `<text text-anchor="middle" font-family="${FONTE_GRAVACAO}" font-weight="500" font-size="${fs.toFixed(2)}" fill="#1b1714" opacity="${vazio ? 0.3 : 0.9}">${tspans}</text>`;

        const brilho = `<rect x="-10" y="-10" width="120" height="120" fill="url(#${id}b)" clip-path="url(#${id}c)" style="mix-blend-mode:screen"/>`;

        return `<svg viewBox="-8 -8 116 116" role="img" aria-label="${esc(verso ? 'Verso do pingente' : 'Frente do pingente')}">${defs}${corpo}${gravura}${brilho}${argola}</svg>`;
    }

    function quebrarNome(nome, maxLinhas) {
        const n = String(nome || '').trim();
        if (!n) return [];
        if (maxLinhas === 1 || n.length <= 9 || !n.includes(' ')) return [n];
        // Duas linhas equilibradas, quebrando num espaço.
        let melhor = [n], dif = Infinity;
        n.split('').forEach((ch, i) => {
            if (ch !== ' ') return;
            const a = n.slice(0, i).trim(), b = n.slice(i + 1).trim();
            const d = Math.abs(a.length - b.length);
            if (d < dif) { dif = d; melhor = [a, b]; }
        });
        return melhor;
    }

    function sombraHex(hex, f) {
        const h = String(hex).replace('#', '');
        if (h.length < 6) return hex;
        const c = (i) => Math.round(parseInt(h.slice(i, i + 2), 16) * f).toString(16).padStart(2, '0');
        return '#' + c(0) + c(2) + c(4);
    }

    // ═══════════════════════════ palco ═══════════════════════════

    const palco = $('[data-atl-palco]');
    const arte = $('[data-atl-arte]');
    let imgA = $('[data-atl-img-a]');
    let imgB = $('[data-atl-img-b]');
    const foco = $('[data-atl-foco]');
    const pendurado = $('[data-atl-pendurado]');
    const p3d = $('[data-atl-p3d]');
    const p3dObj = $('[data-atl-p3d-obj]');
    const legenda = $('[data-atl-legenda]');
    const selo = $('[data-atl-selo]');
    const btnVirar = $('[data-atl-virar]');
    const carregando = $('[data-atl-carregando]');

    // Pontos da coleira, em fração da foto quadrada (mesmo enquadramento nas 104).
    const PONTOS = {
        inteira: { x: 0.5, y: 0.5, s: 1 },
        resumo: { x: 0.5, y: 0.575, s: 1 },
        passador: { x: 0.47, y: 0.47, s: 2.1 },
        fivela: { x: 0.165, y: 0.47, s: 2.3 },
        argola: { x: 0.68, y: 0.5, s: 2.1 },
    };

    function larguraFoto() {
        const w = palco.getBoundingClientRect().width || 400;
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const alvo = w * dpr * 1.25;
        return [600, 900, 1200, 1600, 2000].find((x) => x >= alvo) || 2000;
    }
    function urlFoto(src, largura) {
        if (!src) return '';
        let u = String(src);
        if (u.startsWith('//')) u = 'https:' + u;
        u = u.replace(/([?&])width=\d+&?/, '$1').replace(/[?&]$/, '');
        return u + (u.includes('?') ? '&' : '?') + 'width=' + (largura || larguraFoto());
    }

    function enquadrar(ponto, instantaneo) {
        const p = PONTOS[ponto] || PONTOS.inteira;
        // Leva o ponto ao centro do palco: tela = T + s·p, em frações da
        // largura. O centro vertical depende da proporção do palco, que muda
        // entre celular e computador.
        const r = palco.getBoundingClientRect();
        const cy = r.width ? (r.height / r.width) / 2 : 0.3;
        const tx = 0.5 - p.s * p.x;
        const ty = cy - p.s * p.y;
        if (instantaneo) arte.classList.add('sem-transicao');
        arte.style.setProperty('--tx', (tx * 100).toFixed(3) + '%');
        arte.style.setProperty('--ty', (ty * 100).toFixed(3) + '%');
        arte.style.setProperty('--s', p.s);
        palco.dataset.ponto = ponto;
        if (instantaneo) {
            void arte.offsetWidth;
            arte.classList.remove('sem-transicao');
        }
    }

    function marcarFoco(ponto) {
        const p = PONTOS[ponto];
        if (!p || ponto === 'inteira') { foco.classList.remove('is-ativo'); return; }
        foco.style.left = p.x * 100 + '%';
        foco.style.top = p.y * 100 + '%';
        foco.classList.remove('is-ativo');
        void foco.offsetWidth;
        foco.classList.add('is-ativo');
    }

    // Se o palco muda de altura (teclado, rotação da tela), o mesmo ponto
    // precisa voltar ao centro; sem isto a coleira some do palco encolhido.
    if ('ResizeObserver' in window) {
        let alturaPalco = 0;
        new ResizeObserver(() => {
            const h = Math.round(palco.getBoundingClientRect().height);
            if (!h || h === alturaPalco) return;
            alturaPalco = h;
            enquadrar(palco.dataset.ponto || 'inteira', true);
        }).observe(palco);
    }

    let fotoAtual = '';
    let fotoPedida = '';
    let animFoto = null;

    /**
     * Troca a foto do palco com a "tinta": a foto nova entra por cima da velha,
     * varrendo da esquerda (couro) ou abrindo num círculo a partir do ponto
     * que mudou (passador, metal).
     */
    async function trocarFoto(src, efeito) {
        if (!src) return;
        const url = urlFoto(src);
        if (url === fotoAtual || url === fotoPedida) return;
        fotoPedida = url;
        let mostrouCarregando = false;
        const t = setTimeout(() => { carregando.hidden = false; mostrouCarregando = true; }, 220);
        const prox = imgB;
        prox.src = url;
        try { await Promise.race([prox.decode(), espera(4000)]); } catch (e) { /* segue mesmo assim */ }
        clearTimeout(t);
        if (mostrouCarregando) carregando.hidden = true;
        if (fotoPedida !== url) return; // outra troca passou na frente
        if (animFoto) { try { animFoto.finish(); } catch (e) { /* no-op */ } }

        prox.classList.add('is-entrando');
        let quadros;
        if (efeito && efeito.x != null) {
            const at = `at ${(efeito.x * 100).toFixed(1)}% ${(efeito.y * 100).toFixed(1)}%`;
            quadros = [{ clipPath: `circle(0% ${at})` }, { clipPath: `circle(150% ${at})` }];
        } else {
            quadros = [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }];
        }
        const varredura = palco.querySelector('.atl-palco__tinta') || (() => {
            const s = document.createElement('span');
            s.className = 'atl-palco__tinta';
            s.setAttribute('aria-hidden', 'true');
            arte.appendChild(s);
            return s;
        })();
        const dur = semMovimento ? 1 : (efeito && efeito.x != null ? 760 : 900);
        if (!(efeito && efeito.x != null) && !semMovimento) {
            // A faixa de luz acompanha a borda da tinta (de 0 a 100 % da foto).
            varredura.animate([
                { transform: 'translateX(-50%)', opacity: 0.95 },
                { transform: 'translateX(40%)', opacity: 0.95, offset: 0.8 },
                { transform: 'translateX(50%)', opacity: 0 },
            ], { duration: dur, easing: 'cubic-bezier(.22,1,.36,1)' });
        }
        try {
            animFoto = prox.animate(quadros, { duration: dur, easing: 'cubic-bezier(.22,1,.36,1)' });
            await animFoto.finished;
        } catch (e) { /* cancelada */ }
        animFoto = null;
        prox.classList.remove('is-entrando');
        prox.classList.add('is-front');
        imgA.classList.remove('is-front');
        [imgA, imgB] = [prox, imgA];
        fotoAtual = url;
        if (fotoPedida === url) fotoPedida = '';
    }

    function preCarregar(srcs) {
        srcs.filter(Boolean).forEach((s) => { const i = new Image(); i.decoding = 'async'; i.src = urlFoto(s); });
    }

    // ── Pingente pendurado na argola (resumo) ──
    function desenharPendurado() {
        const ativo = S.pTipo && S.pTipo !== 'nenhum' && S.pFormato && S.passo === E.resumo;
        palco.classList.toggle('tem-pingente', !!ativo);
        if (!ativo) { pendurado.innerHTML = ''; return; }
        const f = formaDe(S.pFormato);
        pendurado.innerHTML = `<div class="atl-pendurado__balanco" style="--furo-x:${(f.furo[0] + 8) / 1.16}%;--furo-y:${(f.furo[1] + 8) / 1.16}%;--ang:0deg">${svgPingente(opcoesPingente('frente', { argola: true }))}</div>`;
    }

    // ── Pingente em 3D (etapa Pingente) ──
    const giro = { ry: -18, rx: 6, alvoRy: -18, alvoRx: 6, arrastando: false, lado: 'frente', ultimoToque: 0, raf: 0 };

    function opcoesPingente(lado, extra) {
        const tipo = S.pTipo && S.pTipo !== 'nenhum' ? S.pTipo : 'metal';
        const formato = S.pFormato || 'Coração';
        const metal = S.metal || CFG.inicio.metal || 'Ouro';
        const corCouro = ultimaCor(S.cor || CFG.inicio.cor || '');
        return Object.assign({
            tipo, formato, metal, lado,
            couroHex: hexDe(corCouro),
            nome: S.pFrente,
            tutor: S.pTutor,
            tel: S.pTel,
        }, extra || {});
    }

    function desenhar3D() {
        const camadas = 7;
        let html = '';
        for (let i = 0; i < camadas; i++) {
            const z = -3 + (6 * i) / (camadas - 1);
            html += `<div class="atl-p3d__camada" style="transform: translateZ(${z.toFixed(2)}px)">${svgPingente(opcoesPingente('aresta'))}</div>`;
        }
        html += `<div class="atl-p3d__face atl-p3d__face--frente">${svgPingente(opcoesPingente('frente'))}</div>`;
        html += `<div class="atl-p3d__face atl-p3d__face--verso">${svgPingente(opcoesPingente('verso'))}</div>`;
        // A argola de verdade fica perpendicular à peça: de frente ela some
        // (o "I" desenhado nas faces faz esse papel) e, girando, vira "O".
        const op = opcoesPingente('frente');
        const f = formaDe(op.formato);
        const me = METAL_ESTILO[chaveMetal(op.metal)];
        const lado = ((2 * ARGOLA_RY + 2.6) / 116) * 100;
        const cxA = ((f.furo[0] + 8) / 116) * 100 - lado / 2;
        const cyA = ((f.furo[1] - ARGOLA_RY + 1.6 + 8) / 116) * 100 - lado / 2;
        html += `<div class="atl-p3d__argola" style="left:${cxA.toFixed(2)}%;top:${cyA.toFixed(2)}%;width:${lado.toFixed(2)}%;height:${lado.toFixed(2)}%"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.7" fill="none" stroke="${me.aresta}" stroke-width="2.4"/><circle cx="10" cy="10" r="8.7" fill="none" stroke="${me.g[1]}" stroke-width="1.3"/></svg></div>`;
        p3dObj.innerHTML = html;
        aplicarGiro();
    }

    function aplicarGiro() {
        p3dObj.style.transform = `rotateX(${giro.rx.toFixed(2)}deg) rotateY(${giro.ry.toFixed(2)}deg)`;
        // O reflexo desliza conforme o ângulo — é o que faz o metal parecer metal.
        const r = ((giro.ry % 360) + 540) % 360 - 180; // -180..180
        const rel = Math.abs(r) > 90 ? (r > 0 ? r - 180 : r + 180) : r;
        const x = (rel / 70) * 60;
        $$('[data-atl-brilho-grad]', p3dObj).forEach((g) => g.setAttribute('gradientTransform', `translate(${x.toFixed(1)} 0)`));
        const mostrandoVerso = Math.abs(r) > 90;
        if ((mostrandoVerso ? 'verso' : 'frente') !== giro.lado) {
            giro.lado = mostrandoVerso ? 'verso' : 'frente';
            $('[data-atl-virar-rotulo]').textContent = mostrandoVerso ? 'Ver a frente' : 'Ver o verso';
        }
    }

    function loopGiro(t) {
        giro.raf = 0;
        if (!palcoEm3D()) return;
        if (!giro.arrastando) {
            // Balanço suave enquanto ninguém mexe: parece pendurado no ar.
            const ocioso = t - giro.ultimoToque > 1400;
            const base = giro.lado === 'verso' ? 180 : 0;
            const balanco = ocioso && !semMovimento ? Math.sin(t / 1600) * 16 : 0;
            const alvoRy = (giro.alvoRy != null ? giro.alvoRy : base) + balanco;
            const alvoRx = 6 + (ocioso && !semMovimento ? Math.sin(t / 2300) * 4 : 0);
            giro.ry += (alvoRy - giro.ry) * 0.075;
            giro.rx += (alvoRx - giro.rx) * 0.075;
            aplicarGiro();
        }
        giro.raf = requestAnimationFrame(loopGiro);
    }
    function ligarGiro() { if (!giro.raf) giro.raf = requestAnimationFrame(loopGiro); }

    function virarPara(lado) {
        const volta = Math.round(giro.ry / 360) * 360;
        giro.alvoRy = volta + (lado === 'verso' ? 180 : 0);
        giro.lado = lado;
        giro.ultimoToque = performance.now();
        $('[data-atl-virar-rotulo]').textContent = lado === 'verso' ? 'Ver a frente' : 'Ver o verso';
        ligarGiro();
    }

    (function arrasto() {
        let x0 = 0, y0 = 0, ry0 = 0, rx0 = 0, id = null;
        p3d.addEventListener('pointerdown', (e) => {
            if (!palcoEm3D()) return;
            id = e.pointerId;
            x0 = e.clientX; y0 = e.clientY; ry0 = giro.ry; rx0 = giro.rx;
            giro.arrastando = true;
            p3d.setPointerCapture(id);
        });
        p3d.addEventListener('pointermove', (e) => {
            if (!giro.arrastando || e.pointerId !== id) return;
            giro.ry = ry0 + (e.clientX - x0) * 0.6;
            giro.rx = Math.max(-25, Math.min(25, rx0 - (e.clientY - y0) * 0.25));
            aplicarGiro();
        });
        const soltar = (e) => {
            if (!giro.arrastando || (e && e.pointerId !== id)) return;
            giro.arrastando = false;
            giro.ultimoToque = performance.now();
            // Assenta na face mais próxima.
            giro.alvoRy = Math.round(giro.ry / 180) * 180;
            giro.lado = (((giro.alvoRy % 360) + 360) % 360) === 180 ? 'verso' : 'frente';
            ligarGiro();
        };
        p3d.addEventListener('pointerup', soltar);
        p3d.addEventListener('pointercancel', soltar);
        // No computador, o pingente acompanha o mouse de leve.
        if (!ehToque) {
            palco.addEventListener('pointermove', (e) => {
                if (!palcoEm3D() || giro.arrastando) return;
                const r = palco.getBoundingClientRect();
                const nx = (e.clientX - r.left) / r.width - 0.5;
                const base = giro.lado === 'verso' ? 180 : 0;
                const volta = Math.round((giro.ry - base) / 360) * 360;
                giro.alvoRy = volta + base + nx * 40;
                giro.ultimoToque = performance.now();
            });
        }
    })();

    btnVirar.addEventListener('click', () => virarPara(giro.lado === 'verso' ? 'frente' : 'verso'));

    const palcoEm3D = () => palco.dataset.modo === 'p3d';

    function atualizarPalco(opcoes) {
        const o = opcoes || {};
        const passo = S.passo;
        // O pingente em 3D só aparece na etapa Pingente, e sai da frente
        // quando a cliente escolhe "Sem pingente".
        const modo = passo === E.pingente && S.pTipo !== 'nenhum' ? 'p3d' : 'colar';
        palco.dataset.modo = modo;
        btnVirar.hidden = modo !== 'p3d';

        if (modo === 'p3d') {
            enquadrar('argola');
            desenhar3D();
            ligarGiro();
        } else {
            const ponto = o.ponto || (passo === E.metal ? 'fivela' : passo === E.resumo ? 'resumo' : 'inteira');
            enquadrar(ponto);
        }
        desenharPendurado();

        // Foto da combinação atual (ou a inicial, antes da escolha).
        const cor = S.cor || CFG.inicio.cor;
        const metal = S.metal || CFG.inicio.metal;
        if (M && cor && metal) trocarFoto(M.foto(cor, metal), o.efeito);

        // Selo: tamanho no palco da etapa Tamanho.
        if (passo === E.tamanho && S.tamanho) {
            const md = medidaDe(S.tamanho);
            selo.innerHTML = `<strong>${esc(S.tamanho)}</strong>${md ? ` · pescoço ${esc(md)}` : ''}`;
            selo.hidden = false;
        } else {
            selo.hidden = true;
        }
        atualizarLegenda();
    }

    function atualizarLegenda() {
        const partes = [];
        if (S.passo === E.pingente && !S.pTipo) {
            partes.push('Escolha um pingente e veja o nome gravado');
        } else if (S.passo === E.pingente && S.pTipo && S.pTipo !== 'nenhum') {
            partes.push(rotuloTipo(S.pTipo) + (S.pFormato ? ' · ' + S.pFormato : ''));
            partes.push('arraste para girar');
        } else {
            if (S.couro) partes.push(S.cor ? descreverCor(S.cor) : S.couro);
            if (S.metal) partes.push('metal ' + S.metal);
            if (S.tamanho) partes.push('tamanho ' + S.tamanho);
            if (!partes.length) partes.push('Toque nas opções e veja na peça');
        }
        legenda.textContent = partes.join(' · ');
    }

    function descreverCor(cor) {
        const p = String(cor).split(/\s+com\s+/i);
        return p.length > 1 ? `${p[0]} com passador ${p.slice(1).join(' com ')}` : `${p[0]}, passador no mesmo tom`;
    }

    // ═══════════════════════════ painéis ═══════════════════════════

    const paineis = $$('[data-atl-painel]');
    const botoesPasso = $$('[data-atl-ir]');
    const btnContinuar = $('[data-atl-continuar]');
    const btnVoltar = $('[data-atl-voltar]');
    const barraValor = $('[data-atl-barra-valor]');
    const barraPix = $('[data-atl-barra-pix]');
    const aviso = $('[data-atl-aviso]');

    let avisoTimer = 0;
    function avisar(msg) {
        aviso.textContent = msg;
        aviso.hidden = false;
        aviso.classList.remove('is-visivel');
        void aviso.offsetWidth;
        aviso.classList.add('is-visivel');
        clearTimeout(avisoTimer);
        avisoTimer = setTimeout(() => {
            aviso.classList.remove('is-visivel');
            setTimeout(() => (aviso.hidden = true), 300);
        }, 3200);
    }

    function tremer(el) {
        if (!el) return;
        el.classList.remove('atl-tremer');
        void el.offsetWidth;
        el.classList.add('atl-tremer');
    }

    // O nome do pet é o da frente do pingente, e só aparece nos títulos
    // quando há um pingente escolhido (sem pingente, não há nome no pedido).
    function nomeDoPet() {
        return S.pTipo && S.pTipo !== 'nenhum' ? limpo(S.pFrente || '') : '';
    }

    function atualizarNomes() {
        const pet = nomeDoPet();
        $$('[data-atl-pet-titulo]').forEach((el) => (el.textContent = pet || 'seu pet'));
        const tp = $('[data-atl-titulo-pingente]');
        if (tp) tp.textContent = pet ? `O nome de ${pet}, gravado` : 'Um pingente com o nome do seu pet';
        const tr = $('[data-atl-titulo-resumo]');
        if (tr) tr.textContent = pet ? `A ${CFG.nomeCurto} de ${pet}` : `A sua ${CFG.nomeCurto}`;
    }

    function contar(inp) {
        const c = $(`[data-atl-contador="${inp.id}"]`);
        if (c) c.textContent = `${inp.value.length}/${inp.maxLength}`;
    }

    // ── Etapa 1: cores ──
    function renderCouros() {
        const box = $('[data-atl-couros]');
        box.innerHTML = M.couros.map((c) => {
            const hex = hexDe(c);
            const n = M.porCouro.get(c).length;
            return `<button type="button" class="atl-cor${S.couro === c ? ' is-ativo' : ''}" aria-pressed="${S.couro === c}" data-couro="${esc(c)}" style="--cor:${hex}" data-tom="${claroOuEscuro(hex)}">
                <span class="atl-cor__disco" aria-hidden="true"></span>
                <span class="atl-cor__nome">${esc(c)}</span>
                ${n > 1 ? `<span class="atl-cor__mais" aria-label="${n} opções de passador">${n}</span>` : ''}
            </button>`;
        }).join('');
    }

    function renderPassadores() {
        const bloco = $('[data-atl-passador-bloco]');
        const nota = $('[data-atl-passador-nota]');
        if (!S.couro) { bloco.hidden = true; return; }
        const ops = M.porCouro.get(S.couro) || [];
        bloco.hidden = false;
        $('[data-atl-passadores]').innerHTML = ops.map((o) => {
            const nome = o.passador || 'Mesmo tom';
            const hexP = hexDe(o.passador || S.couro);
            return `<button type="button" class="atl-passador__op${S.cor === o.cor ? ' is-ativo' : ''}" aria-pressed="${S.cor === o.cor}" data-cor="${esc(o.cor)}">
                <span class="atl-passador__amostra" aria-hidden="true" style="--a:${hexDe(S.couro)};--b:${hexP}"></span>
                <span>${esc(nome)}</span>
            </button>`;
        }).join('');
        if (ops.length === 1) {
            nota.hidden = false;
            nota.textContent = ops[0].passador
                ? `O ${S.couro} vem com passador ${ops[0].passador}.`
                : `O ${S.couro} vem com o passador no mesmo tom.`;
        } else {
            nota.hidden = true;
        }
    }

    root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-couro]');
        if (!b || !M) return;
        const couro = b.dataset.couro;
        const ops = M.porCouro.get(couro) || [];
        S.couro = couro;
        // Mantém o passador se a nova cor tiver o mesmo; senão o primeiro.
        const atualP = S.cor ? (String(S.cor).split(/\s+com\s+/i)[1] || null) : null;
        const mesmo = ops.find((o) => (o.passador || null) === atualP);
        S.cor = (mesmo || ops[0]).cor;
        renderCouros();
        renderPassadores();
        atualizarPalco();
        preCarregar(M.metais.map((m) => M.foto(S.cor, m)));
        atualizarTudo();
        publicar('cor', { cor: S.cor });
    });

    root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cor]');
        if (!b || !M) return;
        if (S.cor === b.dataset.cor) return;
        S.cor = b.dataset.cor;
        renderPassadores();
        atualizarPalco({ ponto: 'passador', efeito: PONTOS.passador });
        marcarFoco('passador');
        clearTimeout(renderPassadores._t);
        renderPassadores._t = setTimeout(() => { if (S.passo === E.cores) enquadrar('inteira'); }, 1900);
        atualizarTudo();
    });

    // ── Etapa 2: metal ──
    function renderMetais() {
        const box = $('[data-atl-metais]');
        box.innerHTML = M.metais.map((m) => {
            const info = METAL_INFO[chaveMetal(m)] || {};
            const combina = S.couro && info.combina && info.combina.has(norm(S.couro));
            return `<button type="button" class="atl-metal${S.metal === m ? ' is-ativo' : ''}" aria-pressed="${S.metal === m}" data-metal="${esc(m)}">
                <span class="atl-metal__disco" aria-hidden="true" style="background:${fundoMetal(m)}"></span>
                <span class="atl-metal__nome">${esc(m)}</span>
                ${info.desc ? `<span class="atl-metal__desc">${esc(info.desc)}</span>` : ''}
                ${combina ? `<span class="atl-metal__selo">Combina com ${esc(S.couro)}</span>` : ''}
            </button>`;
        }).join('');
    }

    root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-metal]');
        if (!b || !M) return;
        if (S.metal === b.dataset.metal) return;
        S.metal = b.dataset.metal;
        renderMetais();
        atualizarPalco({ ponto: 'fivela', efeito: PONTOS.fivela });
        marcarFoco('fivela');
        atualizarTudo();
        publicar('metal', { metal: S.metal });
    });

    // ── Etapa 3: tamanho ──
    function medidaDe(t) {
        if (!TM || !TM.medidas) return '';
        const m = TM.medidas.find((x) => x.tamanho === t);
        if (!m || m.pescoco_min == null) return '';
        const f = (v) => String(parseFloat(v)).replace('.', ',');
        return `${f(m.pescoco_min)} a ${f(m.pescoco_max)} cm`;
    }
    function larguraTiraDe(t) {
        if (!TM || !TM.medidas) return '';
        const m = TM.medidas.find((x) => x.tamanho === t);
        return (m && m.extras && (m.extras.largura_da_tira || m.extras.largura)) || '';
    }

    const campoRaca = () => (CFG.campos || []).find((c) => c.tag === 'customizacao_raca') || null;
    const camposExtras = () => (CFG.campos || []).filter((c) => c.tag !== 'customizacao_raca').sort((a, b) => (parseInt(a.ordem, 10) || 0) - (parseInt(b.ordem, 10) || 0));

    function renderPetInfo() {
        const box = $('[data-atl-pet-info]');
        box.innerHTML = `
          <div class="atl-campo atl-campo--raca">
            <input type="text" id="atl-raca" class="atl-campo__input" autocomplete="off" placeholder=" " value="${esc(S.raca)}" data-atl-raca role="combobox" aria-expanded="false" aria-controls="atl-racas" aria-autocomplete="list">
            <label for="atl-raca" class="atl-campo__rotulo">Raça</label>
            <ul class="atl-racas" id="atl-racas" role="listbox" data-atl-racas hidden></ul>
          </div>
          <div class="atl-linha">
            <div class="atl-campo atl-campo--idade">
              <input type="number" id="atl-idade" class="atl-campo__input" min="0" max="40" step="1" inputmode="numeric" placeholder=" " value="${esc(S.idade)}" data-atl-idade>
              <label for="atl-idade" class="atl-campo__rotulo">Idade</label>
              <div class="atl-alterna" role="group" aria-label="Unidade da idade">
                <button type="button" aria-pressed="${S.idadeUn === 'meses'}" data-atl-un="meses" class="${S.idadeUn === 'meses' ? 'is-ativo' : ''}">meses</button>
                <button type="button" aria-pressed="${S.idadeUn === 'anos'}" data-atl-un="anos" class="${S.idadeUn === 'anos' ? 'is-ativo' : ''}">anos</button>
              </div>
            </div>
            <div class="atl-campo atl-campo--peso">
              <input type="text" id="atl-peso" class="atl-campo__input" inputmode="decimal" placeholder=" " value="${esc(S.peso)}" data-atl-peso>
              <label for="atl-peso" class="atl-campo__rotulo">Peso (kg)</label>
            </div>
          </div>`;
        const extras = camposExtras();
        $('[data-atl-campos-extra]').innerHTML = extras.map((c, i) => `
          <div class="atl-campo">
            ${c.tipo === 'long_text'
                ? `<textarea id="atl-extra-${i}" class="atl-campo__input" rows="2" placeholder=" " data-atl-extra="${esc(c.nome)}">${esc(S.extras[c.nome] || '')}</textarea>`
                : `<input type="${c.tipo === 'phone' ? 'tel' : 'text'}" id="atl-extra-${i}" class="atl-campo__input" placeholder=" " ${c.limite ? `maxlength="${esc(c.limite)}"` : ''} value="${esc(S.extras[c.nome] || '')}" data-atl-extra="${esc(c.nome)}">`}
            <label for="atl-extra-${i}" class="atl-campo__rotulo">${esc(c.titulo || c.nome)}${c.obrigatorio ? ' *' : ''}</label>
          </div>`).join('');
    }

    function renderTamanhos() {
        const box = $('[data-atl-tamanhos]');
        const rec = recomendacao();
        box.innerHTML = M.tamanhos.map((t) => {
            const preco = M.precoTam.get(t);
            const md = medidaDe(t);
            const indicado = rec && rec.tamanho === t;
            return `<button type="button" class="atl-tam${S.tamanho === t ? ' is-ativo' : ''}${indicado ? ' is-indicado' : ''}" aria-pressed="${S.tamanho === t}" data-tam="${esc(t)}">
                ${indicado ? '<span class="atl-tam__selo">indicado</span>' : ''}
                <span class="atl-tam__nome">${esc(t)}</span>
                ${md ? `<span class="atl-tam__medida">${esc(md.replace(' a ', '–'))}</span>` : ''}
                ${preco != null ? `<span class="atl-tam__preco">${dinheiro(preco)}</span>` : ''}
            </button>`;
        }).join('');
        const nota = $('[data-atl-tamanho-nota]');
        if (S.tamanho) {
            const md = medidaDe(S.tamanho);
            const tira = larguraTiraDe(S.tamanho);
            nota.hidden = !(md || tira);
            nota.textContent = [md && `Pescoço de ${md}`, tira && `tira de ${tira} de largura`].filter(Boolean).join(' · ') + '.';
        } else {
            nota.hidden = true;
        }
        renderRecomendacao(rec);
    }

    function racaDoCatalogo(nome) {
        if (!TM || !TM.racas || !nome) return null;
        const n = compacto(nome);
        return TM.racas.find((r) => compacto(r.nome_raca) === n) || null;
    }

    function idadeEmMeses() {
        const v = parseFloat(String(S.idade).replace(',', '.'));
        if (!isFinite(v)) return null;
        return S.idadeUn === 'meses' ? v : v * 12;
    }
    function pesoNum() {
        const v = parseFloat(String(S.peso).replace(',', '.'));
        return isFinite(v) && v > 0 ? v : null;
    }

    // Mesma regra de public/widget-medidas.js (encontrarVariacao) no Waltz.
    function encontrarVariacao(variacoes, fase, peso) {
        const daFase = variacoes.filter((v) => norm(v.fase) === norm(fase) && v.tamanho_coleira);
        if (!daFase.length) return null;
        const temPeso = peso != null && !isNaN(peso);
        if (temPeso) {
            const porPeso = daFase.find((v) => {
                const mn = v.peso_min != null ? parseFloat(v.peso_min) : null;
                const mx = v.peso_max != null ? parseFloat(v.peso_max) : null;
                if (mn != null && mx != null) return peso >= mn && peso <= mx;
                if (mn != null) return peso >= mn;
                if (mx != null) return peso <= mx;
                return false;
            });
            if (porPeso) return porPeso;
        }
        const generica = daFase.find((v) => v.peso_min == null && v.peso_max == null);
        if (generica) return generica;
        if (daFase.length === 1) return daFase[0];
        return temPeso ? null : { precisaPeso: true };
    }

    function recomendacao() {
        const raca = racaDoCatalogo(S.raca);
        if (!raca) return null;
        const vars = (raca.variacoes || []).filter((v) => v.tamanho_coleira);
        if (!vars.length) return null;
        const fases = Array.from(new Set(vars.map((v) => v.fase)));
        const meses = idadeEmMeses();
        let fase = fases.find((f) => norm(f) === 'adulto') || fases[0];
        if (meses != null && meses < 12) fase = fases.find((f) => norm(f) === 'filhote') || fase;
        const v = encontrarVariacao(vars, fase, pesoNum());
        if (!v) return { semIndicacao: true, raca: raca.nome_raca, fase };
        if (v.precisaPeso) return { precisaPeso: true, raca: raca.nome_raca, fase };
        const tam = String(v.tamanho_coleira).split(/[\s/,]+|\bou\b/).map((s) => s.trim()).find((s) => M.tamanhos.includes(s));
        if (!tam) return null;
        return { tamanho: tam, raca: raca.nome_raca, fase, obs: v.observacao || '' };
    }

    function renderRecomendacao(rec) {
        const box = $('[data-atl-recomendacao]');
        if (!rec) { box.hidden = true; return; }
        box.hidden = false;
        const faseTxt = norm(rec.fase) === 'filhote' ? 'filhote' : 'adulto';
        if (rec.precisaPeso) {
            box.innerHTML = `<p>Para indicar o tamanho de um ${esc(rec.raca)}, precisamos do <strong>peso</strong>.</p>`;
            return;
        }
        if (rec.semIndicacao) {
            box.innerHTML = `<p>Não temos uma indicação de tamanho para ${esc(rec.raca)} ${faseTxt} com esse peso. Meça o pescoço para escolher com segurança.</p>`;
            return;
        }
        const md = medidaDe(rec.tamanho);
        box.innerHTML = `
          <span class="atl-recomendacao__icone" aria-hidden="true">✦</span>
          <p>Para ${esc(rec.raca)} ${faseTxt}, indicamos o <strong>${esc(rec.tamanho)}</strong>${md ? ` (pescoço de ${esc(md)})` : ''}.${rec.obs ? ` <span class="atl-recomendacao__obs">${esc(rec.obs)}</span>` : ''}</p>
          ${S.tamanho !== rec.tamanho ? `<button type="button" class="atl-link" data-tam="${esc(rec.tamanho)}">Usar o ${esc(rec.tamanho)}</button>` : ''}`;
    }

    function aplicarRecomendacao() {
        const rec = recomendacao();
        if (rec && rec.tamanho && !S.tamanhoManual && S.tamanho !== rec.tamanho) {
            S.tamanho = rec.tamanho;
        }
        renderTamanhos();
        atualizarPalco();
        atualizarTudo();
    }

    function sugerirRacas(termo) {
        const ul = $('[data-atl-racas]');
        const inp = $('[data-atl-raca]');
        const t = norm(termo), tc = compacto(termo);
        if (!TM || !TM.racas || t.length < 2) { ul.hidden = true; inp.setAttribute('aria-expanded', 'false'); return; }
        const pontuadas = TM.racas.map((r) => {
            const n = norm(r.nome_raca), nc = compacto(r.nome_raca);
            let p = 0;
            if (n === t) p = 5;
            else if (n.startsWith(t)) p = 4;
            else if (n.split(/[\s(-]+/).some((w) => w.startsWith(t))) p = 3;
            else if (nc.includes(tc)) p = 2;
            else if (n.includes(t)) p = 1;
            return { r, p };
        }).filter((x) => x.p > 0).sort((a, b) => b.p - a.p || (a.r.especie === 'cao' ? -1 : 1)).slice(0, 6);
        if (!pontuadas.length) { ul.hidden = true; inp.setAttribute('aria-expanded', 'false'); return; }
        ul.innerHTML = pontuadas.map(({ r }, i) => `<li role="option" id="atl-raca-op-${i}" data-atl-raca-op="${esc(r.nome_raca)}">${esc(r.nome_raca)}${r.especie === 'gato' ? ' <small>gato</small>' : ''}</li>`).join('');
        ul.hidden = false;
        inp.setAttribute('aria-expanded', 'true');
    }

    root.addEventListener('input', (e) => {
        const el = e.target;
        if (el.matches('[data-atl-raca]')) {
            S.raca = limpo(el.value);
            sugerirRacas(el.value);
            aplicarRecomendacao();
            salvar();
        } else if (el.matches('[data-atl-idade]')) {
            S.idade = el.value;
            aplicarRecomendacao();
            salvar();
        } else if (el.matches('[data-atl-peso]')) {
            el.value = el.value.replace(/[^\d,.]/g, '').slice(0, 5);
            S.peso = el.value;
            aplicarRecomendacao();
            salvar();
        } else if (el.matches('[data-atl-extra]')) {
            S.extras[el.dataset.atlExtra] = el.value;
            salvar();
            atualizarTudo();
        }
    });

    root.addEventListener('mousedown', (e) => {
        // Escolher na lista sem perder o foco antes do clique.
        if (e.target.closest('[data-atl-raca-op]')) e.preventDefault();
    });
    root.addEventListener('click', (e) => {
        const op = e.target.closest('[data-atl-raca-op]');
        if (op) {
            S.raca = op.dataset.atlRacaOp;
            const inp = $('[data-atl-raca]');
            inp.value = S.raca;
            $('[data-atl-racas]').hidden = true;
            inp.setAttribute('aria-expanded', 'false');
            aplicarRecomendacao();
            salvar();
            const idade = $('[data-atl-idade]');
            if (idade && !idade.value) idade.focus();
            return;
        }
        const un = e.target.closest('[data-atl-un]');
        if (un) {
            S.idadeUn = un.dataset.atlUn;
            $$('[data-atl-un]').forEach((b) => {
                const on = b === un;
                b.classList.toggle('is-ativo', on);
                b.setAttribute('aria-pressed', on);
            });
            aplicarRecomendacao();
            salvar();
            return;
        }
        const tam = e.target.closest('[data-tam]');
        if (tam && M) {
            S.tamanho = tam.dataset.tam;
            S.tamanhoManual = true;
            renderTamanhos();
            atualizarPalco();
            atualizarTudo();
            // Pingente depende do tamanho (P ou G).
            if (S.pTipo && S.pTipo !== 'nenhum') atualizarPingente();
            publicar('tamanho', { tamanho: S.tamanho });
        }
    });
    root.addEventListener('focusout', (e) => {
        if (e.target.matches('[data-atl-raca]')) setTimeout(() => { const ul = $('[data-atl-racas]'); if (ul) ul.hidden = true; }, 150);
    });

    // ── Folha "Como medir" ──
    const folha = $('[data-atl-folha]');
    function abrirFolha() {
        const box = $('[data-atl-folha-conteudo]');
        const video = TM && TM.video ? TM.video : '';
        box.innerHTML = `
          ${video ? `<video class="atl-folha__video" src="${esc(video)}" muted playsinline loop autoplay controls></video>` : ''}
          <p>${esc((TM && TM.observacao) || 'Passe a fita métrica ao redor do pescoço, bem justa e nivelada.')}</p>
          <p class="atl-folha__dica">Sem fita métrica? Use um barbante e meça na régua.</p>
          <div class="atl-campo atl-campo--medida">
            <input type="text" id="atl-medida" class="atl-campo__input" inputmode="decimal" placeholder=" " data-atl-medida>
            <label for="atl-medida" class="atl-campo__rotulo">Medida do pescoço (cm)</label>
          </div>
          <div class="atl-folha__resultado" data-atl-medida-resultado aria-live="polite"></div>
          <table class="atl-folha__tabela">
            <thead><tr><th>Tamanho</th><th>Pescoço</th><th>Tira</th></tr></thead>
            <tbody>${(M ? M.tamanhos : []).map((t) => `<tr><td>${esc(t)}</td><td>${esc(medidaDe(t) || '—')}</td><td>${esc(larguraTiraDe(t) || '—')}</td></tr>`).join('')}</tbody>
          </table>`;
        folha.hidden = false;
        document.documentElement.classList.add('atl-travado');
        requestAnimationFrame(() => folha.classList.add('is-aberta'));
        publicar('como_medir');
    }
    function fecharFolha() {
        folha.classList.remove('is-aberta');
        document.documentElement.classList.remove('atl-travado');
        setTimeout(() => { folha.hidden = true; $('[data-atl-folha-conteudo]').innerHTML = ''; }, 300);
    }
    $('[data-atl-medir-abrir]').addEventListener('click', abrirFolha);
    $$('[data-atl-folha-fechar]').forEach((b) => b.addEventListener('click', fecharFolha));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !folha.hidden) fecharFolha(); });
    folha.addEventListener('input', (e) => {
        if (!e.target.matches('[data-atl-medida]')) return;
        const cm = parseFloat(e.target.value.replace(',', '.'));
        const out = $('[data-atl-medida-resultado]');
        if (!isFinite(cm) || !TM) { out.innerHTML = ''; return; }
        const servem = (TM.medidas || []).filter((m) => m.pescoco_min != null && cm >= parseFloat(m.pescoco_min) && cm <= parseFloat(m.pescoco_max)).map((m) => m.tamanho).filter((t) => M.tamanhos.includes(t));
        out.innerHTML = servem.length
            ? `Com ${esc(String(cm).replace('.', ','))} cm, servem: ${servem.map((t) => `<button type="button" class="atl-chip" data-tam="${esc(t)}" data-atl-folha-fechar-apos>${esc(t)}</button>`).join(' ')}`
            : 'Essa medida fica fora da tabela. Fale com a gente pelo WhatsApp para uma peça sob medida.';
    });
    folha.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tam]');
        if (!b) return;
        S.tamanho = b.dataset.tam;
        S.tamanhoManual = true;
        renderTamanhos();
        atualizarPalco();
        atualizarTudo();
        fecharFolha();
    });

    // ── Etapa 4: pingente ──
    const TIPOS = [
        { id: 'nenhum', nome: 'Sem pingente', desc: 'Só a coleira' },
        { id: 'metal', nome: 'Metal', desc: 'Gravado no próprio metal' },
        { id: 'couro', nome: 'Couro', desc: 'Couro gravado' },
        { id: 'metal-couro', nome: 'Metal com couro', desc: 'Aro de metal, couro no centro' },
    ];
    const rotuloTipo = (id) => (TIPOS.find((t) => t.id === id) || {}).nome || '';
    let PP = {}; // tipo → { handle, produto }

    async function carregarPingentes() {
        if (!PG.ativo) return;
        const cor = S.cor || CFG.inicio.cor;
        const alvo = {};
        for (const t of ['metal', 'couro', 'metal-couro']) alvo[t] = handlePingente(t, cor);
        const prods = await Promise.all(Object.keys(alvo).map((t) => produtoPingente(alvo[t])));
        PP = {};
        Object.keys(alvo).forEach((t, i) => { PP[t] = { handle: alvo[t], produto: prods[i] }; });
    }

    function precoPingente(tipo) {
        const p = PP[tipo] && PP[tipo].produto;
        if (!p) return null;
        const v = variantePingente(p, S.pFormato || formatosDe(p)[0], S.metal, S.tamanho);
        return v ? v.price : p.price_min || p.price;
    }

    function renderTipos() {
        const box = $('[data-atl-tipos]');
        const corP = ultimaCor(S.cor || '');
        box.innerHTML = TIPOS.filter((t) => t.id === 'nenhum' || (PP[t.id] && PP[t.id].produto)).map((t) => {
            const preco = t.id === 'nenhum' ? null : precoPingente(t.id);
            const ativo = S.pTipo === t.id;
            let desc = t.desc;
            if (t.id === 'couro' || t.id === 'metal-couro') desc = `${t.id === 'couro' ? 'Couro' : 'Couro'} ${corP}${t.id === 'metal-couro' ? ' com aro de metal' : ''}`;
            const mini = t.id === 'nenhum'
                ? '<span class="atl-tipo__mini atl-tipo__mini--vazio" aria-hidden="true"></span>'
                : `<span class="atl-tipo__mini" aria-hidden="true">${svgPingente(Object.assign(opcoesPingente('frente'), { tipo: t.id, formato: S.pFormato || 'Coração', semTexto: true, argola: false }))}</span>`;
            return `<button type="button" class="atl-tipo${ativo ? ' is-ativo' : ''}" aria-pressed="${ativo}" data-ptipo="${t.id}">
                ${mini}
                <span class="atl-tipo__nome">${esc(t.nome)}</span>
                <span class="atl-tipo__desc">${esc(desc)}</span>
                ${preco != null ? `<span class="atl-tipo__preco">+ ${dinheiro(preco)}</span>` : ''}
            </button>`;
        }).join('');
        const detalhes = $('[data-atl-pingente-detalhes]');
        detalhes.hidden = !S.pTipo || S.pTipo === 'nenhum';
        if (!detalhes.hidden) renderFormatos();
    }

    function renderFormatos() {
        const prod = PP[S.pTipo] && PP[S.pTipo].produto;
        const box = $('[data-atl-formatos]');
        const formatos = formatosDe(prod);
        if (!S.pFormato || !formatos.includes(S.pFormato)) S.pFormato = formatos[0] || null;
        box.innerHTML = formatos.map((f) => {
            const ok = !!variantePingente(prod, f, S.metal, S.tamanho);
            const ativo = S.pFormato === f;
            return `<button type="button" class="atl-formato${ativo ? ' is-ativo' : ''}" aria-pressed="${ativo}" data-pformato="${esc(f)}" ${ok ? '' : 'disabled'}>
                <span class="atl-formato__mini" aria-hidden="true">${svgPingente(Object.assign(opcoesPingente('frente'), { formato: f, semTexto: true, argola: false }))}</span>
                <span>${esc(f)}</span>
            </button>`;
        }).join('');
        const nota = $('[data-atl-pingente-nota]');
        const mapa = S.tamanho ? (MAPA[S.tamanho] || MAPA_PADRAO[S.tamanho]) : null;
        nota.textContent = [
            S.metal ? `Metal ${S.metal}, igual à coleira` : '',
            mapa ? `tamanho ${mapa}, proporcional à coleira ${S.tamanho}` : '',
        ].filter(Boolean).join(' · ') + '.';
    }

    function atualizarPingente() {
        renderTipos();
        if (S.passo === E.pingente) { desenhar3D(); atualizarLegenda(); }
        atualizarTudo();
    }

    root.addEventListener('click', (e) => {
        const t = e.target.closest('[data-ptipo]');
        if (t) {
            S.pTipo = t.dataset.ptipo;
            atualizarPingente();
            atualizarNomes();
            preencherGravacao();
            if (S.pTipo !== 'nenhum') virarPara('frente');
            atualizarPalco();
            salvar();
            publicar('pingente_tipo', { tipo: S.pTipo });
            return;
        }
        const f = e.target.closest('[data-pformato]');
        if (f && !f.disabled) {
            S.pFormato = f.dataset.pformato;
            // renderTipos redesenha também os formatos: as miniaturas dos
            // tipos acompanham o formato escolhido.
            renderTipos();
            desenhar3D();
            atualizarLegenda();
            atualizarTudo();
            salvar();
        }
    });

    const inpFrente = $('[data-atl-p-frente]');
    const inpTutor = $('[data-atl-p-tutor]');
    const inpTel = $('[data-atl-p-tel]');

    function preencherGravacao() {
        inpFrente.value = S.pFrente || '';
        inpTutor.value = S.pTutor || '';
        inpTel.value = S.pTel || '';
        [inpFrente, inpTutor].forEach(contar);
    }

    function mascaraTel(v) {
        const d = String(v || '').replace(/\D/g, '').slice(0, 11);
        if (d.length <= 2) return d;
        if (d.length <= 6) return `${d.slice(0, 2)} ${d.slice(2)}`;
        if (d.length <= 10) return `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}`;
        return `${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`;
    }

    [inpFrente, inpTutor, inpTel].forEach((inp) => {
        inp.addEventListener('focus', () => virarPara(inp.dataset.lado === 'verso' ? 'verso' : 'frente'));
        inp.addEventListener('input', () => {
            if (inp === inpTel) inp.value = mascaraTel(inp.value);
            else {
                const v = semEmoji(inp.value);
                if (v !== inp.value) inp.value = v;
                contar(inp);
            }
            if (inp === inpFrente) { S.pFrente = limpo(inp.value); atualizarNomes(); }
            if (inp === inpTutor) S.pTutor = limpo(inp.value);
            if (inp === inpTel) S.pTel = inp.value.trim();
            inp.closest('.atl-campo').classList.remove('is-invalido');
            desenhar3D();
            atualizarTudo();
            salvar();
        });
    });

    // ── Etapa Resumo ──
    function linhaFicha(rotulo, valor, passo) {
        return `<div class="atl-ficha__linha">
            <dt>${esc(rotulo)}</dt>
            <dd>${valor}</dd>
            <button type="button" class="atl-link" data-atl-ir-editar="${passo}" aria-label="Alterar ${esc(rotulo.toLowerCase())}">Alterar</button>
        </div>`;
    }

    function renderResumo() {
        const ficha = $('[data-atl-ficha]');
        const md = S.tamanho ? medidaDe(S.tamanho) : '';
        const linhas = [];
        linhas.push(linhaFicha('Couro', esc(S.cor ? descreverCor(S.cor) : '—'), E.cores));
        linhas.push(linhaFicha('Metal', esc(S.metal || '—'), E.metal));
        linhas.push(linhaFicha('Tamanho', `${esc(S.tamanho || '—')}${md ? ` <small>pescoço de ${esc(md)}</small>` : ''}`, E.tamanho));
        if (campoRaca()) linhas.push(linhaFicha('Seu pet', esc(textoPet() || '—'), E.tamanho));
        if (PG.ativo) {
            if (S.pTipo && S.pTipo !== 'nenhum') {
                const verso = [S.pTutor, S.pTel].filter(Boolean).join(' · ');
                linhas.push(linhaFicha('Pingente', `${esc(rotuloTipo(S.pTipo))} · ${esc(S.pFormato || '')}<small>Frente: “${esc(S.pFrente)}”${verso ? `<br>Verso: ${esc(verso)}` : ''}</small>`, E.pingente));
            } else {
                linhas.push(linhaFicha('Pingente', 'Sem pingente', E.pingente));
            }
        }
        ficha.innerHTML = `
          <div class="atl-ficha__topo">
            <span class="atl-eyebrow atl-eyebrow--claro">Ficha da peça</span>
            <span class="atl-ficha__assinatura">${esc(CFG.nomeCurto)}${nomeDoPet() ? ` · ${esc(nomeDoPet())}` : ''}</span>
          </div>
          <dl>${linhas.join('')}</dl>`;

        const tot = totais();
        const box = $('[data-atl-total-resumo]');
        const parc = melhorParcela(tot.total);
        box.innerHTML = `
          <div class="atl-total__linha"><span>Coleira ${esc(S.tamanho || '')}</span><span>${dinheiro(tot.coleira)}</span></div>
          ${tot.pingente ? `<div class="atl-total__linha"><span>Pingente gravado</span><span>${dinheiro(tot.pingente)}</span></div>` : ''}
          <div class="atl-total__linha atl-total__linha--total"><span>Total</span><span>${dinheiro(tot.total)}</span></div>
          <p class="atl-total__pix">${dinheiro(tot.pix)} no Pix${parc ? ` · ou ${parc.n}x de ${dinheiro(parc.valor)} sem juros` : ''}</p>`;
    }

    root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-atl-ir-editar]');
        if (b) irPara(parseInt(b.dataset.atlIrEditar, 10));
    });

    // ═══════════════════════════ preço ═══════════════════════════

    function varianteColeira() {
        if (!M || !S.tamanho || !S.cor || !S.metal) return null;
        return M.variante(S.tamanho, S.cor, S.metal);
    }
    function variantePingenteAtual() {
        if (!S.pTipo || S.pTipo === 'nenhum') return null;
        const p = PP[S.pTipo] && PP[S.pTipo].produto;
        return variantePingente(p, S.pFormato, S.metal, S.tamanho);
    }
    function totais() {
        const vc = varianteColeira();
        const coleira = vc ? vc.price : (S.tamanho && M ? M.precoTam.get(S.tamanho) : null);
        const vp = variantePingenteAtual();
        const pingente = vp ? vp.price : 0;
        const total = (coleira || 0) + pingente;
        const pix = total - Math.floor((total * (parseFloat(CFG.pixPct) || 0)) / 100);
        return { coleira: coleira || 0, temColeira: coleira != null, pingente, total, pix };
    }
    function melhorParcela(total) {
        const P = CFG.parcelas || {};
        const max = Math.min(parseInt(P.semJuros, 10) || 1, parseInt(P.max, 10) || 1);
        const min = (parseFloat(P.minimo) || 0) * 100;
        for (let n = max; n >= 2; n--) {
            if (Math.floor(total / n) >= min) return { n, valor: Math.floor(total / n) };
        }
        return null;
    }

    function atualizarBarra() {
        const t = totais();
        const fTexto = $('[data-atl-flutuante-texto]');
        const fValor = $('[data-atl-flutuante-valor]');
        if (fTexto && S.maxPasso > 0) {
            fTexto.textContent = nomeDoPet() ? `Continuar a coleira de ${nomeDoPet()}` : 'Continuar a minha coleira';
            if (t.temColeira) fValor.textContent = dinheiro(t.total);
        }
        if (!t.temColeira) {
            const min = M ? Math.min.apply(null, Array.from(M.precoTam.values())) : null;
            barraValor.textContent = min != null ? `a partir de ${dinheiro(min + t.pingente).replace(/,00$/, '')}` : barraValor.textContent;
            barraPix.textContent = 'conforme o tamanho';
        } else {
            barraValor.textContent = dinheiro(t.total);
            barraPix.textContent = `${dinheiro(t.pix)} no Pix`;
        }
    }

    // ═══════════════════════════ navegação ═══════════════════════════

    function textoPet() {
        const partes = [];
        if (S.raca) partes.push(S.raca);
        if (String(S.idade).trim()) {
            const n = parseFloat(String(S.idade).replace(',', '.'));
            const un = S.idadeUn === 'meses' ? (n === 1 ? 'mês' : 'meses') : (n === 1 ? 'ano' : 'anos');
            partes.push(`${String(S.idade).trim()} ${un}`);
        }
        if (String(S.peso).trim()) partes.push(`${String(S.peso).trim().replace('.', ',')} kg`);
        return partes.join(', ');
    }

    /** Devolve null se a etapa está completa, ou { msg, el } do que falta. */
    function problemaDoPasso(n) {
        switch (n) {
            case E.cores:
                if (!S.couro) return { msg: 'Escolha a cor do couro.', el: $('[data-atl-couros]') };
                if (!S.cor) return { msg: 'Escolha o passador.', el: $('[data-atl-passadores]') };
                return null;
            case E.metal:
                if (!S.metal) return { msg: 'Escolha o banho do metal.', el: $('[data-atl-metais]') };
                return null;
            case E.tamanho: {
                const cr = campoRaca();
                if (cr && cr.obrigatorio) {
                    if (!S.raca) return { msg: 'Conte a raça do seu pet (ou escreva "SRD").', el: $('[data-atl-raca]') };
                    if (!String(S.idade).trim()) return { msg: 'Informe a idade do seu pet.', el: $('[data-atl-idade]') };
                    if (!pesoNum()) return { msg: 'Informe o peso do seu pet.', el: $('[data-atl-peso]') };
                }
                if (!S.tamanho) return { msg: 'Escolha o tamanho.', el: $('[data-atl-tamanhos]') };
                for (const c of camposExtras()) {
                    if (c.obrigatorio && !String(S.extras[c.nome] || '').trim()) return { msg: `Preencha: ${c.titulo || c.nome}.`, el: $(`[data-atl-extra="${CSS.escape(c.nome)}"]`) };
                }
                if (M && !varianteColeira()) return { msg: 'Essa combinação não está disponível agora. Tente outro metal ou cor.', el: $('[data-atl-tamanhos]') };
                return null;
            }
            case E.pingente: {
                if (!PG.ativo) return null;
                if (!S.pTipo) return { msg: 'Quer o pingente com o nome? Escolha uma opção.', el: $('[data-atl-tipos]') };
                if (S.pTipo === 'nenhum') return null;
                if (!S.pFormato) return { msg: 'Escolha o formato do pingente.', el: $('[data-atl-formatos]') };
                if (!S.pFrente) return { msg: 'Escreva o nome que vai na frente do pingente.', el: inpFrente };
                const tel = String(S.pTel || '').replace(/\D/g, '');
                if (tel && tel.length < 10) return { msg: 'Telefone incompleto: DDD e 8 ou 9 dígitos.', el: inpTel };
                if (!variantePingenteAtual()) return { msg: 'Esse pingente não está disponível nessa combinação. Tente outro formato.', el: $('[data-atl-formatos]') };
                return null;
            }
            default: return null;
        }
    }

    function primeiroProblemaAte(n) {
        for (let i = 0; i < n; i++) {
            const p = problemaDoPasso(i);
            if (p) return { passo: i, p };
        }
        return null;
    }

    function mostrarProblema(p) {
        avisar(p.msg);
        if (!p.el) return;
        const campo = p.el.closest('.atl-campo');
        if (campo) campo.classList.add('is-invalido');
        tremer(campo || p.el);
        const topo = alturaTopo();
        const y = p.el.getBoundingClientRect().top + window.scrollY - topo - palcoAltura() - 24;
        if (p.el.getBoundingClientRect().top < topo + palcoAltura() || p.el.getBoundingClientRect().bottom > window.innerHeight - 90) {
            window.scrollTo({ top: Math.max(0, y), behavior: semMovimento ? 'auto' : 'smooth' });
        }
        if (p.el.matches('input, textarea')) setTimeout(() => p.el.focus({ preventScroll: true }), 300);
    }

    function irPara(n, opcoes) {
        const o = opcoes || {};
        if (!M && n > 0) return;
        n = Math.max(0, Math.min(PASSOS.length - 1, n));
        if (n > S.passo) {
            const prob = primeiroProblemaAte(n);
            if (prob) {
                if (prob.passo !== S.passo) irPara(prob.passo, { semHistorico: o.semHistorico });
                mostrarProblema(prob.p);
                return;
            }
        }
        const anterior = S.passo;
        S.passo = n;
        S.maxPasso = Math.max(S.maxPasso, n);
        paineis.forEach((p) => {
            const ativo = parseInt(p.dataset.atlPainel, 10) === n;
            p.hidden = !ativo;
            if (ativo) {
                p.classList.remove('is-entrando');
                void p.offsetWidth;
                p.classList.add('is-entrando');
            }
        });
        renderPasso(n);
        atualizarPalco();
        atualizarTudo();
        if (!o.semHistorico && anterior !== n) {
            try { history.pushState({ atl: n }, ''); } catch (e) { /* no-op */ }
        }
        if (!o.semRolagem) rolarParaAtelie();
        if (!o.semFoco) {
            const t = paineis[n].querySelector('.atl-painel__titulo');
            if (t) setTimeout(() => t.focus({ preventScroll: true }), 50);
        }
        salvar();
        publicar('etapa', { etapa: PASSOS[n], numero: n + 1 });
    }

    function renderPasso(n) {
        if (!M) return;
        if (n === E.cores) { renderCouros(); renderPassadores(); }
        if (n === E.metal) renderMetais();
        if (n === E.tamanho) {
            renderPetInfo();
            renderTamanhos();
            if (!TM) carregarTM().then(() => { if (S.passo === E.tamanho) { renderTamanhos(); } });
        }
        if (n === E.pingente) {
            const pronto = carregarPingentes().then(() => {
                if (S.passo !== E.pingente) return;
                renderTipos();
                preencherGravacao();
                desenhar3D();
            });
            renderTipos();
            preencherGravacao();
            return pronto;
        }
        if (n === E.resumo) {
            carregarPingentes().then(() => { if (S.passo === E.resumo) { renderResumo(); desenharPendurado(); atualizarTudo(); } });
            renderResumo();
        }
    }

    function avancar() {
        if (S.passo === PASSOS.length - 1) return finalizar('checkout');
        const p = problemaDoPasso(S.passo);
        if (p) { mostrarProblema(p); return; }
        irPara(S.passo + 1);
    }

    btnContinuar.addEventListener('click', avancar);
    btnVoltar.addEventListener('click', () => irPara(S.passo - 1));
    botoesPasso.forEach((b) => b.addEventListener('click', () => irPara(parseInt(b.dataset.atlIr, 10))));

    window.addEventListener('popstate', (e) => {
        const st = e.state;
        if (st && typeof st.atl === 'number') irPara(st.atl, { semHistorico: true });
    });

    function atualizarTudo() {
        botoesPasso.forEach((b) => {
            const i = parseInt(b.dataset.atlIr, 10);
            b.disabled = i > S.maxPasso || !M;
            b.classList.toggle('is-atual', i === S.passo);
            b.classList.toggle('is-feito', i < S.passo || (i <= S.maxPasso && !problemaDoPasso(i) && i !== S.passo));
            if (i === S.passo) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
        });
        const linha = $('[data-atl-passos-linha]');
        if (linha) linha.style.transform = `scaleX(${(S.passo / (PASSOS.length - 1)).toFixed(3)})`;
        btnVoltar.hidden = S.passo === 0;
        const rotulo = $('[data-atl-continuar-rotulo]');
        if (rotulo && !finalizando) {
            rotulo.textContent = S.passo === PASSOS.length - 1
                ? 'Finalizar pedido'
                : S.passo === E.pingente ? 'Ver resumo' : 'Continuar';
        }
        btnContinuar.setAttribute('aria-label', S.passo < PASSOS.length - 1 ? `Continuar para ${PASSOS[S.passo + 1]}` : 'Finalizar pedido');
        btnContinuar.classList.toggle('is-pronto', !problemaDoPasso(S.passo));
        atualizarBarra();
        if (S.passo === E.resumo) renderResumo();
        // Toda escolha passa por aqui: guardar aqui cobre cor, metal e tamanho
        // escolhidos sem avançar de etapa (a cliente sai e volta).
        salvar();
    }

    // ═══════════════════════════ carrinho ═══════════════════════════

    let finalizando = false;
    async function finalizar(destino) {
        if (finalizando) return;
        const prob = primeiroProblemaAte(PASSOS.length - 1);
        if (prob) { irPara(prob.passo); mostrarProblema(prob.p); return; }
        const vc = varianteColeira();
        if (!vc) { avisar('Não encontramos essa combinação. Recarregue a página e tente de novo.'); return; }
        const vp = variantePingenteAtual();
        const botoes = [btnContinuar, $('[data-atl-sacola]')];
        const alvo = destino === 'sacola' ? $('[data-atl-sacola]') : btnContinuar;
        const textoOriginal = alvo.innerHTML;
        finalizando = true;
        botoes.forEach((b) => { b.disabled = true; });
        alvo.setAttribute('aria-busy', 'true');
        alvo.innerHTML = '<span class="atl-giro" aria-hidden="true"></span><span>Preparando a sua peça…</span>';

        const chave = 'k' + Math.random().toString(36).slice(2, 6);
        const propsColeira = {};
        const cr = campoRaca();
        const pet = textoPet();
        if (cr && pet) propsColeira[cr.nome] = pet;
        camposExtras().forEach((c) => {
            const v = limpo(S.extras[c.nome] || '');
            if (v) propsColeira[c.nome] = v;
        });
        if (vp) propsColeira._kit = chave;
        propsColeira._origem = 'atelier';
        const itens = [{ id: vc.id, quantity: 1, properties: propsColeira }];

        if (vp) {
            // Igual ao snippet pingente-customization: UMA property com linhas,
            // porque o conector Shopify→Tiny junta properties numa linha só.
            const opcoes = [['Tamanho', S.tamanho], ['Cor', S.cor], ['Cor do Metal', S.metal]]
                .map(([k, v]) => `${k}: ${v}`).join(', ');
            const linhas = [`anexo a: ${CFG.titulo} — ${opcoes}`];
            if (S.pFrente) linhas.push(`Nome do pet: ${limpo(S.pFrente)}`);
            if (S.pTutor) linhas.push(`Nome do tutor: ${limpo(S.pTutor)}`);
            if (S.pTel) linhas.push(`Telefone do tutor: ${S.pTel.trim()}`);
            itens.push({ id: vp.id, quantity: 1, properties: { 'Personalização': linhas.join('\n'), _kit: chave, _origem: 'atelier' } });
        }

        try {
            await xhr('POST', '/cart/add.js', { items: itens });
            const carrinho = await xhr('GET', '/cart.js');
            if (window.AmeCart && typeof window.AmeCart.refresh === 'function') window.AmeCart.refresh(carrinho);
            publicar('adicionado', { destino, total: totais().total / 100, pingente: !!vp });
            if (destino === 'sacola') {
                alvo.innerHTML = '<span>Na sacola ✓</span>';
                if (window.AmeCart && typeof window.AmeCart.open === 'function') window.AmeCart.open();
                setTimeout(() => {
                    alvo.innerHTML = textoOriginal;
                    botoes.forEach((b) => { b.disabled = false; });
                    alvo.removeAttribute('aria-busy');
                    finalizando = false;
                }, 1600);
            } else {
                alvo.innerHTML = '<span>Indo para o pagamento…</span>';
                // O tratador do layout (Yampi ou /checkout) escuta este link.
                const link = $('[data-atl-checkout]');
                if (link) link.click(); else window.location.href = '/checkout';
                setTimeout(() => {
                    alvo.innerHTML = textoOriginal;
                    botoes.forEach((b) => { b.disabled = false; });
                    alvo.removeAttribute('aria-busy');
                    finalizando = false;
                }, 14000);
            }
        } catch (err) {
            console.error('[ateliê] carrinho', err, err && err.corpo);
            const desc = err && err.corpo && (err.corpo.description || err.corpo.message);
            avisar(desc ? `Não deu para adicionar: ${desc}` : 'Não deu para adicionar agora. Tente de novo.');
            alvo.innerHTML = textoOriginal;
            botoes.forEach((b) => { b.disabled = false; });
            alvo.removeAttribute('aria-busy');
            finalizando = false;
        }
    }

    $('[data-atl-sacola]').addEventListener('click', () => finalizar('sacola'));

    // Volta do checkout pelo botão voltar (bfcache): destrava os botões.
    window.addEventListener('pageshow', (e) => {
        if (!e.persisted) return;
        finalizando = false;
        [btnContinuar, $('[data-atl-sacola]')].forEach((b) => { b.disabled = false; b.removeAttribute('aria-busy'); });
        btnContinuar.innerHTML = '<span data-atl-continuar-rotulo>Finalizar pedido</span>';
        $('[data-atl-sacola]').textContent = 'Adicionar à sacola e continuar comprando';
        atualizarTudo();
    });

    // ═══════════════════════════ layout ═══════════════════════════

    const studio = $('[data-atl-studio]');
    const palcoWrap = $('[data-atl-palco-wrap]');

    function alturaTopo() {
        const h = document.querySelector('[data-header-group], .ame-header-group');
        if (!h) return 0;
        const r = h.getBoundingClientRect();
        const pos = getComputedStyle(h).position;
        return pos === 'fixed' || pos === 'sticky' ? Math.max(0, r.bottom) : 0;
    }
    function palcoAltura() {
        return window.matchMedia('(min-width: 990px)').matches ? 0 : palcoWrap.getBoundingClientRect().height;
    }
    function medirTopo() {
        root.style.setProperty('--atl-topo', alturaTopo() + 'px');
    }
    medirTopo();
    window.addEventListener('resize', medirTopo, { passive: true });
    let rolTimer = 0;
    window.addEventListener('scroll', () => {
        if (rolTimer) return;
        rolTimer = requestAnimationFrame(() => { rolTimer = 0; medirTopo(); });
    }, { passive: true });

    function rolarParaAtelie() {
        const alvo = $('[data-atl-passos]');
        const y = alvo.getBoundingClientRect().top + window.scrollY - alturaTopo() - 8;
        if (Math.abs(window.scrollY - y) < 24) return;
        window.scrollTo({ top: y, behavior: semMovimento ? 'auto' : 'smooth' });
    }

    // Com o TECLADO aberto (celular de verdade), o palco encolhe para o campo
    // e a gravação caberem na tela. A barra com "Continuar" nunca some: antes
    // ela sumia com qualquer campo em foco e, depois de digitar o peso (que já
    // escolhe o tamanho), a cliente ficava sem botão até tocar fora.
    function tecladoAberto() {
        const vv = window.visualViewport;
        return !!vv && window.innerHeight - vv.height > 140;
    }
    function atualizarDigitando() {
        const foco = root.querySelector('.atl-paineis input:focus, .atl-paineis textarea:focus');
        root.classList.toggle('atl--digitando', !!foco && tecladoAberto());
    }
    root.addEventListener('focusin', () => setTimeout(atualizarDigitando, 350));
    root.addEventListener('focusout', () => setTimeout(atualizarDigitando, 150));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', atualizarDigitando);

    // Chamadas para o ateliê
    $$('[data-atl-comecar]').forEach((a) => a.addEventListener('click', (e) => {
        e.preventDefault();
        rolarParaAtelie();
        publicar('comecar');
    }));

    // A barra do ateliê empurra os botões flutuantes (WhatsApp, cashback, cor).
    const flutuante = $('[data-atl-flutuante]');
    const hero = $('[data-atl-hero]');
    let studioVisivel = false, heroVisivel = true, finalVisivel = false;
    function atualizarFlutuantes() {
        document.body.classList.toggle('atl-com-barra', studioVisivel);
        const mostrar = !studioVisivel && !heroVisivel && !finalVisivel;
        flutuante.classList.toggle('is-visivel', mostrar);
        document.body.classList.toggle('atl-com-flutuante', mostrar);
    }
    if ('IntersectionObserver' in window) {
        new IntersectionObserver((ents) => { ents.forEach((en) => { studioVisivel = en.isIntersecting; }); atualizarFlutuantes(); }, { rootMargin: '-35% 0px -35% 0px' }).observe(studio);
        new IntersectionObserver((ents) => { ents.forEach((en) => { heroVisivel = en.isIntersecting; }); atualizarFlutuantes(); }, { threshold: 0.15 }).observe($('.atl-hero__acoes'));
        const fim = $('.atl-final');
        if (fim) new IntersectionObserver((ents) => { ents.forEach((en) => { finalVisivel = en.isIntersecting; }); atualizarFlutuantes(); }).observe(fim);
    }

    // ═══════════════════════════ topo animado ═══════════════════════════

    (function topo() {
        const lista = (CFG.hero || []).filter((h) => h && h.img);
        const imgs = [$('[data-atl-hero-img]'), $('[data-atl-hero-img-b]')].filter(Boolean);
        const nome = $('[data-atl-hero-nome]');
        const pontos = $('[data-atl-hero-dots]');
        const palcoHero = $('[data-atl-hero-stage]');
        const palavra = $('[data-atl-hero-word]');
        // Cada bolinha é um botão com área de toque de 36 px: escolher uma
        // mostra a cor e segura o carrossel por alguns segundos.
        if (pontos) pontos.innerHTML = lista.map((h, i) => `<button type="button" class="atl-hero__dot${i === 0 ? ' is-ativo' : ''}" data-i="${i}" aria-pressed="${i === 0}" aria-label="${esc(h.cor)}, metal ${esc(h.metal)}" style="--cor:${hexDe(String(h.cor).split(/\s+com\s+/i)[0])}"><span></span></button>`).join('');

        // Paralaxe: a palavra anda mais devagar que a coleira, e a coleira
        // inclina de leve conforme a página rola.
        let raf = 0;
        function paralaxe() {
            raf = 0;
            const r = palcoHero.getBoundingClientRect();
            const p = Math.max(-1, Math.min(1, (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight));
            palcoHero.style.setProperty('--p', p.toFixed(3));
        }
        if (!semMovimento) {
            window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(paralaxe); }, { passive: true });
            paralaxe();
            if (!ehToque) {
                palcoHero.addEventListener('pointermove', (e) => {
                    const r = palcoHero.getBoundingClientRect();
                    palcoHero.style.setProperty('--mx', (((e.clientX - r.left) / r.width) - 0.5).toFixed(3));
                    palcoHero.style.setProperty('--my', (((e.clientY - r.top) / r.height) - 0.5).toFixed(3));
                });
                palcoHero.addEventListener('pointerleave', () => { palcoHero.style.setProperty('--mx', 0); palcoHero.style.setProperty('--my', 0); });
            }
        }
        if (palavra) requestAnimationFrame(() => palavra.classList.add('is-visivel'));

        if (lista.length < 2 || imgs.length < 2) return;
        let i = 0, frente = 0, visivel = true, timer = 0, ocupado = false, pedido = null;
        const w = window.innerWidth < 990 ? 900 : 1400;
        new IntersectionObserver((ents) => { visivel = ents[0].isIntersecting; agendar(); }).observe(palcoHero);
        document.addEventListener('visibilitychange', () => agendar());
        function agendar(ms) {
            clearTimeout(timer);
            if (semMovimento || !visivel || document.hidden) return;
            timer = setTimeout(() => mostrar((i + 1) % lista.length), ms || 3200);
        }
        async function mostrar(alvo, manual) {
            if (alvo === i) { if (manual) agendar(9000); return; }
            if (ocupado) { pedido = { alvo, manual }; return; }
            ocupado = true;
            clearTimeout(timer);
            i = alvo;
            const atual = imgs[frente], prox = imgs[1 - frente];
            prox.removeAttribute('srcset');
            prox.src = urlFoto(lista[i].img, w);
            try { await Promise.race([prox.decode(), espera(3000)]); } catch (e) { /* segue */ }
            prox.classList.add('is-entrando');
            const dur = semMovimento ? 1 : (manual ? 800 : 1100);
            const a = prox.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration: dur, easing: 'cubic-bezier(.22,1,.36,1)' });
            const brilho = $('.atl-hero__sheen');
            if (brilho && !semMovimento) brilho.animate([{ transform: 'translateX(-60%)', opacity: 0 }, { opacity: 0.9, offset: 0.4 }, { transform: 'translateX(60%)', opacity: 0 }], { duration: dur, easing: 'ease-out' });
            nome.classList.add('is-trocando');
            setTimeout(() => {
                nome.textContent = `${lista[i].cor} · ${lista[i].metal}`;
                nome.classList.remove('is-trocando');
            }, semMovimento ? 0 : 320);
            $$('[data-i]', pontos).forEach((b, k) => {
                b.classList.toggle('is-ativo', k === i);
                b.setAttribute('aria-pressed', k === i);
            });
            try { await a.finished; } catch (e) { /* no-op */ }
            prox.classList.remove('is-entrando');
            prox.classList.add('is-front');
            atual.classList.remove('is-front');
            frente = 1 - frente;
            ocupado = false;
            if (pedido) { const p = pedido; pedido = null; mostrar(p.alvo, p.manual); return; }
            agendar(manual ? 9000 : 3200);
        }
        if (pontos) pontos.addEventListener('click', (e) => {
            const b = e.target.closest('[data-i]');
            if (b) mostrar(parseInt(b.dataset.i, 10), true);
        });
        // Começa a girar só depois que a página assentou.
        window.addEventListener('load', () => setTimeout(() => agendar(), 1200), { once: true });
        if (document.readyState === 'complete') setTimeout(() => agendar(), 1200);
    })();

    // ═══════════════════════════ história ═══════════════════════════

    (function historia() {
        const revelar = $$('.atl-revela');
        if ('IntersectionObserver' in window && !semMovimento) {
            const io = new IntersectionObserver((ents) => {
                ents.forEach((en) => {
                    if (en.isIntersecting) { en.target.classList.add('is-visivel'); io.unobserve(en.target); }
                });
            }, { rootMargin: '0px 0px -12% 0px' });
            revelar.forEach((el) => io.observe(el));
        } else {
            revelar.forEach((el) => el.classList.add('is-visivel'));
        }

        // Trilho do processo cresce com a rolagem.
        const trilho = $('[data-atl-trilho]');
        const lista = $('.atl-processo__lista');
        if (trilho && lista) {
            let raf = 0;
            const medir = () => {
                raf = 0;
                const r = lista.getBoundingClientRect();
                const p = Math.max(0, Math.min(1, (window.innerHeight * 0.7 - r.top) / r.height));
                trilho.style.transform = `scaleY(${p.toFixed(3)})`;
            };
            window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(medir); }, { passive: true });
            medir();
        }

        // Vídeos: carregam e tocam mudos quando aparecem.
        const videos = $$('[data-atl-video]');
        if (videos.length && 'IntersectionObserver' in window) {
            const io = new IntersectionObserver((ents) => {
                ents.forEach((en) => {
                    const v = en.target;
                    if (en.isIntersecting) {
                        if (!v.src && v.dataset.src) v.src = v.dataset.src;
                        const p = v.play();
                        if (p && p.catch) p.catch(() => { /* autoplay bloqueado */ });
                    } else if (!v.paused) {
                        v.pause();
                    }
                });
            }, { threshold: 0.6 });
            videos.forEach((v) => io.observe(v));
        }
        root.addEventListener('click', (e) => {
            const b = e.target.closest('[data-atl-video-som]');
            if (!b) return;
            const v = b.parentElement.querySelector('video');
            const ligar = v.muted;
            videos.forEach((o) => { o.muted = true; o.parentElement.classList.remove('com-som'); });
            v.muted = !ligar;
            if (ligar) { v.parentElement.classList.add('com-som'); v.play().catch(() => {}); }
            b.setAttribute('aria-label', ligar ? 'Desativar som' : 'Ativar som');
        });
    })();

    // ═══════════════════════════ dados ═══════════════════════════

    let tmPromessa = null;
    function carregarTM() {
        if (!tmPromessa) {
            tmPromessa = xhr('GET', `${CFG.waltz}/api/tm/widget?produto_id=${encodeURIComponent(CFG.produtoId)}`)
                .then((r) => {
                    const t = r && r.tabela;
                    if (!t) return null;
                    TM = {
                        medidas: t.medidas || [],
                        racas: t.racas || [],
                        observacao: t.observacao || '',
                        video: (r.config && (r.config.video_url_coleira || r.config.video_url)) || '',
                    };
                    return TM;
                })
                .catch((e) => { console.warn('[ateliê] tabela de medidas', e.message); tmPromessa = null; return null; });
        }
        return tmPromessa;
    }

    async function carregar() {
        const esqueleto = $('[data-atl-esqueleto]');
        const erro = $('[data-atl-erro]');
        erro.hidden = true;
        esqueleto.hidden = false;
        try {
            let prod = null, ultimoErro = null;
            for (let tentativa = 0; tentativa < 2 && !prod; tentativa++) {
                try {
                    prod = await xhr('GET', `${CFG.waltz}/api/public/produto/${encodeURIComponent(CFG.handle)}`, null, 15000);
                } catch (e) {
                    ultimoErro = e;
                    if (tentativa === 0) await espera(900);
                }
            }
            if (!prod) throw ultimoErro || new Error('produto vazio');
            M = montarModelo(prod);
        } catch (e) {
            console.error('[ateliê] catálogo', e);
            esqueleto.hidden = true;
            erro.hidden = false;
            return;
        }
        esqueleto.hidden = true;
        carregarTM().then(() => { if (S.passo === E.tamanho) renderTamanhos(); atualizarTudo(); });

        restaurar();
        atualizarNomes();
        try { history.replaceState(Object.assign({}, history.state || {}, { atl: S.passo }), ''); } catch (e) { /* no-op */ }
        irPara(S.passo, { semHistorico: true, semRolagem: true, semFoco: true });

        // Ociosidade: adianta as fotos da cor inicial e o pingente de metal.
        const ocioso = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
        ocioso(() => {
            if (CFG.inicio.cor) preCarregar(M.metais.map((m) => M.foto(CFG.inicio.cor, m)));
            if (PG.ativo) carregarPingentes();
        });
    }

    function restaurar() {
        const g = guarda.ler();
        if (!g || !g.salvoEm || Date.now() - g.salvoEm > 14 * 86400000) return;
        CAMPOS_SALVOS.forEach((k) => { if (g[k] !== undefined) S[k] = g[k]; });
        // Descarta o que não existe mais no catálogo.
        if (S.couro && !M.porCouro.has(S.couro)) { S.couro = null; S.cor = null; }
        if (S.cor && !(M.porCouro.get(S.couro) || []).some((o) => o.cor === S.cor)) S.cor = null;
        if (S.metal && !M.metais.includes(S.metal)) S.metal = null;
        if (S.tamanho && !M.tamanhos.includes(S.tamanho)) S.tamanho = null;
        if (!S.extras || typeof S.extras !== 'object') S.extras = {};
        const teveAlgo = S.couro || S.metal || S.tamanho;
        if (!teveAlgo) return;
        // Volta para a primeira etapa incompleta, nunca além do que ela viu.
        const prob = primeiroProblemaAte(PASSOS.length - 1);
        S.passo = Math.min(prob ? prob.passo : PASSOS.length - 1, S.maxPasso || 0);
        $('[data-atl-restaurado]').hidden = false;
    }

    $('[data-atl-recomecar]').addEventListener('click', () => {
        guarda.apagar();
        Object.assign(S, {
            passo: 0, maxPasso: 0, couro: null, cor: null, metal: null, tamanho: null, tamanhoManual: false,
            raca: '', idade: '', idadeUn: 'anos', peso: '', extras: {}, pTipo: null, pFormato: null,
            pFrente: '', pTutor: '', pTel: '',
        });
        $('[data-atl-restaurado]').hidden = true;
        atualizarNomes();
        irPara(0, { semRolagem: true });
        publicar('recomecar');
    });

    $('[data-atl-tentar]').addEventListener('click', carregar);

    // A foto inicial da coleira já veio no HTML; o resto chega com o catálogo.
    palco.dataset.modo = 'colar';
    btnVirar.hidden = true;
    atualizarLegenda();
    carregar();
})();
