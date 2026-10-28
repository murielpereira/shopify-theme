/**
 * Ateliê — a coleira montada em etapas (sections/atelier-coleira.liquid).
 *
 * Etapas: Cores · Metal · Tamanho · Pingente · Resumo (índices em `E`).
 * O nome do pet só é pedido dentro do Pingente, depois de escolher um tipo.
 *
 * O palco mostra a FOTO REAL da combinação escolhida. As 104 fotos (26 cores ×
 * 4 metais) têm o mesmo enquadramento (refeitas em 16/10/2026 e medidas de
 * novo: a coleira ocupa x 5–95 %, y 35,2–63 % em todas), então trocar a foto parece a cor sendo
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

        const nomeDe = (i) => String(typeof opcoes[i] === 'string' ? opcoes[i] : opcoes[i].name);
        return {
            iTam, iCor, iMetal,
            // Nomes reais das opções: o Compre Junto casa por nome.
            nomes: { tamanho: nomeDe(iTam), cor: nomeDe(iCor), metal: nomeDe(iMetal) },
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
    // As bolinhas (couro, passador, topo da página e pingente liso) usam a cor das
    // imagens de couro dos pingentes (assets/couro-<cor>.jpg), medida na região
    // central de cada uma em 15/10/2026, e não o swatch cadastrado no tema. Cor
    // sem imagem cai no swatch. Se uma imagem de couro mudar, refazer a medição.
    const HEX_COURO = {
        allure: '#98aec0', azulbebe: '#b5c8c3', borgonha: '#782932', branco: '#cbc8c5', cafe: '#524033',
        camel: '#9d5a35', chiclete: '#fb88a3', lilascandy: '#bfb7bc', marinho: '#2f3d4f', militar: '#55574c',
        nude: '#c2a28c', offwhite: '#c6c7bd', preto: '#242424', rosabebe: '#e2b5a6', rosaseco: '#db9396', sepia: '#a6b3a5',
    };
    const hexDe = (nome) => HEX_COURO[compacto(nome)] || SWATCH[norm(nome)] || '#cdbfb2';
    // Miniatura (96 px, recorte do centro) da imagem de couro da cor, para as
    // bolinhas: elas mostram o couro de verdade, não só o tom. Vazia sem imagem.
    // (ARQUIVO_COURO, mais abaixo, traduz o nome da cor para a chave do arquivo.)
    const miniDe = (nome) => {
        const k = ARQUIVO_COURO[compacto(nome)];
        return (k && CFG.couros_mini && CFG.couros_mini[k]) || '';
    };
    const luzDe = (hex) => {
        const h = String(hex || '').replace('#', '');
        if (h.length < 6) return 0.5;
        return (parseInt(h.slice(0, 2), 16) * 0.299 + parseInt(h.slice(2, 4), 16) * 0.587 + parseInt(h.slice(4, 6), 16) * 0.114) / 255;
    };

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
    // O pingente usa um metal MAIS CLARO que o dos botões de escolha: o ouro e o
    // rosé das fotos das coleiras são pálidos (a fivela chega a #fff6cc nas luzes e
    // tem o meio-tom em #d2be8c), e o degradê escuro dos botões deixava o pingente
    // bem diferente da coleira (14/10/2026). Prata e grafite ficam como estão.
    const METAL_PINGENTE = {
        ouro: { g: ['#fffbe6', '#f7e6ad', '#e6c978', '#cfab5a', '#a98838'], aresta: '#b8934a' },
        rose: { g: ['#fff6ec', '#f7e0c8', '#e8c1a3', '#d09f86', '#a97f68'], aresta: '#b58a70' },
    };
    const estiloPingente = (metal) => {
        const k = chaveMetal(metal);
        return Object.assign({}, METAL_ESTILO[k], METAL_PINGENTE[k] || {});
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

    // As 12 formas (4 formatos × 3 tipos) saem dos SVGs do Corel do Muriel
    // (14/10/2026), no tamanho P — todas as fotos da Atena são do P, então o
    // ateliê usa só ele. Em unidades do pingente: viewBox 0..100, 2,25 unidades
    // por milímetro, cada forma centrada na vertical. A mesma peça física muda de
    // contorno conforme o tipo, por isso a forma depende de formato E tipo:
    //
    //   couro        d = contorno; furo vazado, sem ilhós.
    //   metal        d = contorno COM a orelha; furo Ø 2,2 mm dentro dela.
    //   metal-couro  d = contorno externo (aro de 1,9 mm + orelha) e di = o couro
    //                por dentro. O externo foi desenhado a partir do couro + aro
    //                + orelha e conferido contra o scan (flor 29,6 × 35,2 mm
    //                contra 29,7 × 35,0 medidos).
    //
    // `furo` = [x, y, raio]; `texto` e `verso`: centro (x, y), largura e altura
    // úteis, corpo máximo da letra e linhas. O nome é medido e encolhe até caber
    // nos dois sentidos, então nunca sai da peça.
    const ARGOLA_RY = 8.5; // a argola, vista de frente, é um aro estreito na vertical ("I")
    // Centro vertical da argola: a ponta de baixo do aro fica DENTRO do furo
    // (raio `rf`), a 0,6 do vão de baixo, para a argola atravessar o furo em vez
    // de passar por cima da chapa (16/10/2026). 1,3 = meia espessura do aro.
    const ayArgola = (fy, rf) => fy + rf - 0.6 - 1.3 - ARGOLA_RY;
    const FORMAS = {circulo:{couro:{d:"M21.87 52.96C21.87 39.45 31.4 28.16 44.11 25.46C44.09 25.25 44.08 25.05 44.08 24.84C44.08 21.57 46.73 18.91 50 18.91C53.27 18.91 55.92 21.57 55.92 24.84C55.92 25.05 55.91 25.25 55.89 25.46C68.6 28.17 78.13 39.45 78.13 52.96C78.13 68.49 65.53 81.09 50 81.09C34.47 81.09 21.87 68.49 21.87 52.96Z",furo:[50,24.84,1.98],texto:{x:50,y:52.27,w:39.65,h:27.36,max:18.65,linhas:2},verso:{x:50,y:52.77,w:38.06,h:23.53,max:10.82,linhas:2}},metal:{d:"M55.62 27.62C68.77 30.24 78.69 41.84 78.69 55.76C78.69 71.6 65.84 84.45 50 84.45C34.16 84.45 21.31 71.6 21.31 55.76C21.31 41.84 31.23 30.24 44.38 27.62L44.38 21.18C44.38 18.08 46.91 15.55 50 15.55C53.09 15.55 55.63 18.08 55.63 21.18L55.63 27.62Z",furo:[50,21.18,2.48],texto:{x:50,y:54.28,w:38.32,h:30.31,max:20.67,linhas:2},verso:{x:50,y:54.78,w:36.79,h:26.07,max:11.99,linhas:2}},"metal-couro":{d:"M49.78 16.75C50.21 16.74 50.66 16.79 51.08 16.89C51.5 16.99 51.95 17.16 52.31 17.33C52.67 17.5 52.92 17.66 53.23 17.91C53.53 18.17 53.89 18.54 54.14 18.85C54.38 19.16 54.55 19.45 54.71 19.78C54.86 20.1 54.97 20.45 55.06 20.8C55.15 21.15 55.23 21.41 55.24 21.88C55.25 22.35 55.13 23.26 55.13 23.61C55.13 23.97 55.18 23.91 55.25 24.03C55.31 24.16 55.37 24.27 55.51 24.37C55.65 24.48 55.53 24.51 56.08 24.68C56.63 24.86 57.92 25.14 58.82 25.42C59.72 25.71 60.64 26.05 61.48 26.4C62.31 26.74 63.16 27.17 63.84 27.52C64.52 27.87 64.92 28.12 65.54 28.5C66.15 28.89 66.83 29.31 67.53 29.84C68.23 30.36 69.04 31.03 69.72 31.63C70.4 32.24 71.04 32.88 71.59 33.46C72.13 34.04 72.5 34.45 73.01 35.11C73.53 35.77 74.21 36.71 74.68 37.4C75.14 38.09 75.43 38.56 75.81 39.27C76.19 39.97 76.63 40.85 76.98 41.61C77.32 42.37 77.59 43.04 77.86 43.83C78.14 44.62 78.41 45.49 78.63 46.33C78.85 47.18 79.02 48.11 79.16 48.9C79.29 49.68 79.38 50.26 79.45 51.06C79.52 51.85 79.59 52.72 79.58 53.67C79.58 54.61 79.5 55.74 79.4 56.71C79.29 57.69 79.12 58.62 78.94 59.51C78.76 60.4 78.6 61.11 78.31 62.05C78.03 62.98 77.6 64.19 77.21 65.12C76.82 66.06 76.43 66.85 75.98 67.68C75.54 68.51 75.02 69.35 74.52 70.11C74.02 70.86 73.54 71.51 72.96 72.21C72.39 72.91 71.71 73.67 71.08 74.32C70.44 74.97 69.92 75.48 69.17 76.11C68.42 76.74 67.45 77.51 66.58 78.1C65.71 78.7 64.79 79.22 63.96 79.67C63.13 80.12 62.44 80.45 61.61 80.81C60.77 81.16 59.89 81.5 58.95 81.8C58.02 82.09 57 82.37 56 82.58C55.01 82.79 53.97 82.96 52.99 83.07C52.02 83.18 51.07 83.24 50.17 83.25C49.26 83.26 48.53 83.22 47.55 83.12C46.58 83.03 45.35 82.86 44.32 82.66C43.28 82.45 42.3 82.2 41.36 81.91C40.42 81.63 39.59 81.34 38.69 80.96C37.79 80.59 36.77 80.1 35.93 79.65C35.1 79.21 34.45 78.81 33.69 78.31C32.94 77.8 32.14 77.23 31.4 76.64C30.67 76.04 29.99 75.43 29.29 74.75C28.6 74.06 27.87 73.29 27.22 72.51C26.57 71.73 25.93 70.84 25.4 70.06C24.87 69.28 24.49 68.66 24.04 67.83C23.59 67 23.11 66.02 22.72 65.08C22.32 64.14 21.96 63.15 21.68 62.21C21.39 61.27 21.18 60.42 20.99 59.46C20.8 58.5 20.63 57.42 20.52 56.45C20.42 55.47 20.36 54.52 20.36 53.62C20.36 52.71 20.43 51.77 20.5 51.01C20.57 50.25 20.61 49.88 20.76 49.06C20.91 48.24 21.18 46.92 21.39 46.08C21.6 45.23 21.78 44.71 22.03 43.99C22.28 43.27 22.56 42.52 22.9 41.76C23.23 41 23.64 40.18 24.05 39.41C24.47 38.65 24.94 37.87 25.4 37.17C25.87 36.48 26.35 35.84 26.83 35.24C27.3 34.64 27.67 34.19 28.24 33.58C28.81 32.98 29.61 32.18 30.26 31.59C30.9 31.01 31.44 30.57 32.11 30.07C32.78 29.57 33.49 29.06 34.26 28.58C35.03 28.1 36.02 27.56 36.73 27.2C37.44 26.83 37.84 26.65 38.51 26.38C39.18 26.1 39.86 25.83 40.76 25.54C41.66 25.26 43.29 24.86 43.91 24.66C44.53 24.46 44.33 24.45 44.47 24.33C44.6 24.22 44.66 24.11 44.72 23.98C44.77 23.85 44.82 23.88 44.82 23.56C44.81 23.23 44.7 22.47 44.7 22.04C44.71 21.6 44.76 21.31 44.84 20.96C44.92 20.61 45.03 20.25 45.17 19.92C45.32 19.59 45.47 19.29 45.71 18.97C45.94 18.66 46.3 18.28 46.59 18.02C46.89 17.76 47.17 17.57 47.49 17.4C47.81 17.23 48.12 17.1 48.5 16.99C48.88 16.89 49.35 16.77 49.78 16.75Z",di:"M75.31 53.66C75.31 67.64 63.98 78.97 50 78.97C36.02 78.97 24.69 67.64 24.69 53.66C24.69 39.68 36.02 28.35 50 28.35C63.98 28.35 75.31 39.68 75.31 53.66Z",furo:[50,22.05,2.48],aro:4.27,texto:{x:50,y:53.66,w:37.27,h:22.28,max:15.19,linhas:2},verso:{x:50,y:54.16,w:35.78,h:19.16,max:8.81,linhas:2}}},coracao:{couro:{d:"M50 78.35L51.03 77.23C61.58 65.59 78.4 59.63 81.42 44.88C84.69 28.91 70.15 17.4 58.18 23.96C57.31 24.44 56.44 25.08 55.61 25.79C54.87 23.39 52.64 21.65 50.01 21.65C47.37 21.65 45.13 23.4 44.4 25.8C41.02 22.76 36.14 20.45 29.2 23.23C20.67 26.65 16.79 35.49 18.53 44.57C20.2 53.28 27.2 59.57 32.32 63.3C38.27 67.64 44.54 72.32 49.37 77.67C50.11 78.49 49.37 77.79 50.01 78.35Z",furo:[50,27.27,1.98],texto:{x:50,y:45.05,w:39.85,h:24.95,max:17.01,linhas:2},verso:{x:50,y:45.55,w:38.26,h:21.46,max:9.87,linhas:2}},metal:{d:"M50 80.38C50.83 80.33 51.21 80.19 51.92 79.66C52.67 79.11 53.4 78.42 54.1 77.79C55.32 76.69 56.56 75.61 57.83 74.56C61.91 71.2 66.12 68.06 70.16 64.64C74.88 60.63 79.57 56.18 81.86 50.28C84.06 44.6 84.18 37.1 81.11 31.73C78.4 26.98 72.84 23.59 67.52 22.71C63.67 22.08 60.56 22.93 57.02 24.34L55.88 24.8L55.5 23.62C54.72 21.24 52.5 19.62 50 19.62C47.5 19.62 45.28 21.24 44.5 23.62L44.12 24.8L42.98 24.34C39.44 22.93 36.33 22.08 32.48 22.71C27.16 23.59 21.6 26.98 18.89 31.73C15.82 37.1 15.94 44.6 18.14 50.28C20.43 56.18 25.12 60.63 29.84 64.64C33.88 68.06 38.09 71.2 42.17 74.56C43.44 75.61 44.68 76.69 45.9 77.79C46.6 78.42 47.33 79.11 48.08 79.66C48.79 80.19 49.17 80.33 50 80.38Z",furo:[50,24.35,2.48],texto:{x:50,y:46.46,w:41.64,h:26.73,max:18.23,linhas:2},verso:{x:50,y:46.96,w:39.98,h:22.99,max:10.57,linhas:2}},"metal-couro":{d:"M49.76 20.84C50.21 20.82 50.67 20.88 51.1 20.98C51.53 21.08 51.97 21.24 52.36 21.45C52.76 21.65 53.11 21.89 53.47 22.21C53.84 22.53 54.27 23.11 54.55 23.35C54.83 23.6 54.94 23.61 55.15 23.66C55.36 23.7 55.21 23.8 55.81 23.62C56.42 23.43 57.88 22.82 58.77 22.55C59.67 22.27 60.41 22.13 61.18 21.98C61.96 21.83 62.66 21.73 63.41 21.65C64.16 21.58 64.83 21.52 65.66 21.54C66.48 21.55 67.46 21.62 68.35 21.73C69.24 21.85 70.2 22.03 71 22.23C71.8 22.43 72.41 22.64 73.14 22.94C73.87 23.23 74.68 23.62 75.37 24C76.05 24.39 76.6 24.73 77.25 25.24C77.9 25.75 78.66 26.42 79.26 27.04C79.86 27.65 80.34 28.24 80.85 28.93C81.36 29.63 81.89 30.46 82.31 31.21C82.72 31.96 83.05 32.68 83.36 33.45C83.67 34.21 83.92 34.96 84.14 35.79C84.35 36.63 84.53 37.59 84.65 38.45C84.77 39.3 84.84 40.09 84.84 40.91C84.84 41.74 84.76 42.56 84.65 43.38C84.54 44.2 84.38 45.05 84.2 45.81C84.01 46.58 83.81 47.26 83.56 47.97C83.32 48.68 83.08 49.32 82.74 50.07C82.4 50.82 81.93 51.72 81.51 52.47C81.09 53.22 80.69 53.86 80.2 54.57C79.71 55.28 79.09 56.09 78.58 56.73C78.07 57.38 77.92 57.6 77.12 58.44C76.32 59.29 75.05 60.62 73.79 61.79C72.53 62.97 72.8 62.9 69.54 65.48C66.28 68.07 57.11 75.1 54.2 77.29C51.3 79.48 52.66 78.36 52.13 78.64C51.61 78.93 51.44 78.92 51.07 79.01C50.71 79.09 50.3 79.15 49.96 79.16C49.63 79.17 49.4 79.13 49.07 79.05C48.74 78.98 48.34 78.87 47.99 78.72C47.65 78.58 47.35 78.41 47 78.2C46.65 77.98 48.73 79.58 45.9 77.41C43.08 75.24 33.36 67.81 30.04 65.18C26.72 62.55 27.18 62.75 25.97 61.62C24.77 60.5 23.63 59.3 22.81 58.43C21.99 57.55 21.58 57.01 21.07 56.36C20.55 55.72 20.18 55.2 19.73 54.55C19.29 53.9 18.84 53.2 18.41 52.45C17.99 51.7 17.54 50.79 17.2 50.04C16.86 49.29 16.62 48.66 16.38 47.95C16.13 47.24 15.92 46.56 15.74 45.79C15.56 45.03 15.39 44.18 15.29 43.36C15.18 42.54 15.11 41.71 15.11 40.89C15.11 40.07 15.17 39.31 15.3 38.42C15.42 37.54 15.65 36.39 15.87 35.56C16.08 34.72 16.29 34.15 16.59 33.43C16.89 32.7 17.21 31.97 17.65 31.19C18.09 30.41 18.71 29.46 19.24 28.74C19.78 28.02 20.28 27.45 20.86 26.86C21.43 26.27 22.09 25.7 22.71 25.23C23.33 24.75 23.94 24.36 24.59 23.99C25.24 23.62 25.89 23.3 26.62 23.01C27.34 22.72 28.13 22.45 28.96 22.23C29.8 22.02 30.73 21.84 31.62 21.73C32.51 21.61 33.49 21.55 34.31 21.54C35.13 21.53 35.81 21.58 36.56 21.65C37.3 21.73 38.01 21.83 38.78 21.98C39.55 22.14 40.29 22.29 41.19 22.56C42.08 22.84 43.55 23.44 44.15 23.62C44.76 23.8 44.61 23.7 44.82 23.65C45.03 23.6 45.13 23.58 45.41 23.33C45.69 23.09 46.16 22.49 46.49 22.19C46.82 21.89 47.08 21.73 47.41 21.54C47.73 21.36 48.04 21.21 48.44 21.09C48.83 20.97 49.32 20.86 49.76 20.84Z",di:"M50 33.33C50.58 33.33 51.17 33.33 51.7 32.91C52.24 32.5 52.73 31.66 53.86 30.43C54.98 29.19 56.74 27.57 60.17 26.6C63.59 25.64 68.68 25.34 72.72 27.4C76.76 29.45 79.75 33.85 80.43 38.76C81.1 43.67 79.46 49.09 75.04 54.42C70.62 59.74 63.41 64.97 58.86 68.38C54.3 71.78 52.41 73.37 51.37 74.16C50.34 74.95 50.17 74.94 50 74.94C49.83 74.94 49.66 74.95 48.63 74.16C47.59 73.37 45.7 71.78 41.14 68.38C36.59 64.97 29.38 59.74 24.96 54.42C20.54 49.09 18.9 43.67 19.57 38.76C20.25 33.85 23.24 29.45 27.28 27.4C31.32 25.34 36.41 25.64 39.83 26.6C43.26 27.57 45.02 29.19 46.14 30.43C47.27 31.66 47.76 32.5 48.3 32.91C48.83 33.33 49.42 33.33 50 33.33Z",furo:[50,26.13,2.48],aro:4.27,texto:{x:50,y:46.47,w:36.77,h:21.6,max:14.72,linhas:2},verso:{x:50,y:46.97,w:35.3,h:18.57,max:8.54,linhas:2}}},flor:{couro:{d:"M39.18 30.55C39.01 28.31 39.5 26 40.74 23.94C43.91 18.64 50.78 16.92 56.07 20.09C59.94 22.41 61.9 26.69 61.44 30.9C64.93 28.51 69.64 28.22 73.51 30.53C78.8 33.71 80.52 40.57 77.35 45.87C76.11 47.94 74.31 49.46 72.26 50.36C72.57 50.51 72.88 50.67 73.18 50.86C78.48 54.03 80.2 60.89 77.03 66.19C73.85 71.49 66.99 73.21 61.69 70.03C61.39 69.85 61.1 69.66 60.82 69.45C60.99 71.69 60.5 74 59.26 76.06C56.09 81.36 49.22 83.08 43.93 79.91C40.06 77.59 38.1 73.31 38.56 69.1C35.07 71.49 30.36 71.78 26.49 69.47C21.2 66.29 19.48 59.43 22.65 54.13C23.89 52.06 25.69 50.54 27.74 49.64C27.43 49.49 27.12 49.33 26.82 49.15C21.52 45.97 19.8 39.11 22.97 33.81C26.15 28.52 33.01 26.79 38.31 29.97C38.61 30.15 38.9 30.34 39.18 30.55Z",furo:[50.52,26.57,1.98],texto:{x:50,y:50,w:37.72,h:27.72,max:18.9,linhas:2},verso:{x:50,y:50.5,w:36.21,h:23.84,max:10.96,linhas:2}},metal:{d:"M21.1 55.09C18.9 57.75 17.71 61.06 17.71 64.51C17.71 72.68 24.33 79.29 32.49 79.29C33.3 79.29 34.12 79.23 34.92 79.09L35.84 78.94L36.17 79.81C38.33 85.56 43.84 89.38 50 89.38C56.15 89.38 61.66 85.56 63.83 79.81L64.16 78.94L65.08 79.09C65.88 79.23 66.69 79.29 67.5 79.29C75.66 79.29 82.28 72.68 82.28 64.51C82.28 61.06 81.09 57.75 78.89 55.09L78.28 54.36L78.9 53.63C81.18 50.95 82.41 47.58 82.41 44.06C82.41 35.9 75.8 29.29 67.64 29.29C66.8 29.29 65.96 29.36 65.14 29.5L64.21 29.65L63.88 28.77C62.55 25.13 59.82 22.15 56.33 20.49L55.68 20.19L55.68 16.31C55.68 13.18 53.12 10.62 50 10.62C46.88 10.62 44.32 13.18 44.32 16.31L44.32 20.19L43.67 20.49C40.18 22.15 37.45 25.13 36.12 28.77L35.79 29.65L34.86 29.5C34.04 29.36 33.2 29.29 32.36 29.29C24.2 29.29 17.59 35.9 17.59 44.06C17.59 47.58 18.82 50.95 21.1 53.63L21.72 54.36L21.11 55.09Z",furo:[50,16.47,2.48],texto:{x:50,y:53.28,w:47.87,h:34.65,max:23.63,linhas:2},verso:{x:50,y:53.78,w:45.96,h:29.8,max:13.7,linhas:2}},"metal-couro":{d:"M49.77 10.43C50.16 10.4 50.48 10.44 50.83 10.5C51.18 10.56 51.49 10.64 51.85 10.8C52.22 10.95 52.69 11.2 53.02 11.43C53.35 11.65 53.56 11.83 53.82 12.13C54.08 12.43 54.38 12.83 54.59 13.22C54.79 13.6 54.96 14.03 55.06 14.46C55.17 14.88 55.23 15.25 55.22 15.78C55.21 16.3 55.01 17.2 55.02 17.63C55.03 18.06 55.13 18.17 55.28 18.37C55.43 18.58 55.29 18.51 55.9 18.86C56.51 19.21 58.06 19.91 58.95 20.49C59.84 21.07 60.53 21.66 61.22 22.34C61.91 23.02 62.49 23.72 63.08 24.6C63.67 25.48 64.42 27.05 64.75 27.63C65.09 28.2 64.92 27.92 65.09 28.03C65.27 28.15 65.3 28.28 65.82 28.33C66.34 28.37 67.51 28.27 68.22 28.3C68.93 28.32 69.29 28.32 70.07 28.48C70.85 28.63 72.15 28.96 72.91 29.2C73.67 29.44 74.11 29.67 74.63 29.92C75.15 30.17 75.54 30.38 76.03 30.69C76.51 31 77.09 31.42 77.54 31.78C77.99 32.14 78.23 32.29 78.74 32.84C79.24 33.39 80.05 34.29 80.6 35.1C81.14 35.9 81.6 36.73 82 37.67C82.39 38.61 82.75 39.9 82.95 40.72C83.16 41.53 83.18 42.03 83.23 42.56C83.29 43.09 83.32 43.27 83.29 43.89C83.26 44.51 83.2 45.45 83.05 46.27C82.9 47.1 82.64 48.1 82.4 48.85C82.15 49.61 81.95 50.07 81.56 50.81C81.16 51.55 80.33 52.77 80.03 53.31C79.73 53.85 79.78 53.8 79.75 54.05C79.73 54.31 79.64 54.32 79.89 54.83C80.13 55.34 80.84 56.38 81.22 57.14C81.59 57.89 81.89 58.59 82.14 59.35C82.39 60.1 82.59 60.89 82.72 61.67C82.86 62.45 82.97 63.21 82.97 64.05C82.97 64.89 82.87 65.87 82.73 66.7C82.59 67.53 82.4 68.27 82.15 69.03C81.89 69.78 81.58 70.53 81.22 71.23C80.85 71.94 80.4 72.66 79.97 73.28C79.53 73.89 79.06 74.43 78.6 74.91C78.14 75.39 77.74 75.75 77.22 76.17C76.7 76.58 76.09 77.03 75.48 77.39C74.87 77.76 74.24 78.09 73.58 78.36C72.93 78.64 72.26 78.87 71.57 79.06C70.89 79.25 70.14 79.4 69.49 79.5C68.83 79.6 68.34 79.65 67.63 79.66C66.92 79.67 65.77 79.54 65.24 79.55C64.71 79.56 64.69 79.6 64.46 79.72C64.24 79.83 64.22 79.74 63.88 80.25C63.54 80.76 62.91 82.05 62.42 82.79C61.93 83.52 61.51 84.05 60.93 84.66C60.35 85.27 59.61 85.93 58.94 86.44C58.27 86.94 57.54 87.38 56.92 87.72C56.3 88.06 55.8 88.27 55.22 88.49C54.65 88.71 54.09 88.9 53.45 89.06C52.8 89.22 52.01 89.37 51.35 89.46C50.7 89.54 50.16 89.59 49.5 89.57C48.83 89.56 48.16 89.52 47.37 89.38C46.59 89.25 45.55 88.99 44.79 88.76C44.03 88.52 43.48 88.3 42.81 87.96C42.14 87.62 41.37 87.16 40.75 86.73C40.13 86.3 39.62 85.88 39.1 85.39C38.58 84.91 38.09 84.39 37.64 83.84C37.2 83.29 36.83 82.78 36.42 82.09C36.01 81.41 35.48 80.22 35.18 79.74C34.87 79.25 34.83 79.31 34.61 79.19C34.38 79.08 34.44 79.07 33.83 79.05C33.21 79.02 31.87 79.14 30.9 79.05C29.93 78.96 28.75 78.69 28.02 78.51C27.29 78.34 27 78.2 26.51 78C26.01 77.81 25.71 77.71 25.05 77.34C24.4 76.97 23.23 76.23 22.59 75.76C21.95 75.29 21.6 74.93 21.19 74.53C20.78 74.12 20.49 73.78 20.13 73.33C19.77 72.88 19.36 72.3 19.04 71.82C18.73 71.33 18.52 70.94 18.27 70.42C18.02 69.9 17.76 69.28 17.56 68.7C17.35 68.11 17.18 67.51 17.04 66.91C16.91 66.3 16.81 65.64 16.74 65.07C16.67 64.49 16.61 64.18 16.64 63.47C16.68 62.76 16.79 61.65 16.94 60.83C17.09 60 17.31 59.22 17.55 58.51C17.8 57.8 17.99 57.29 18.39 56.55C18.79 55.81 19.63 54.6 19.93 54.06C20.23 53.52 20.18 53.57 20.2 53.32C20.22 53.06 20.31 53.05 20.06 52.54C19.81 52.03 19.09 51 18.71 50.24C18.33 49.49 18.03 48.74 17.79 48.03C17.55 47.32 17.4 46.71 17.27 45.97C17.13 45.23 17.01 44.34 16.98 43.59C16.95 42.84 17 42.21 17.1 41.46C17.2 40.72 17.36 39.88 17.57 39.11C17.79 38.35 18.08 37.55 18.38 36.86C18.68 36.17 19.01 35.58 19.39 34.98C19.77 34.38 20.15 33.83 20.64 33.26C21.13 32.69 21.76 32.05 22.32 31.55C22.88 31.05 23.43 30.65 24.02 30.27C24.62 29.88 25.24 29.53 25.88 29.23C26.52 28.93 27.19 28.67 27.87 28.46C28.54 28.25 29.2 28.08 29.94 27.96C30.68 27.83 31.48 27.73 32.32 27.71C33.16 27.69 34.41 27.86 34.98 27.83C35.54 27.8 35.53 27.65 35.71 27.53C35.89 27.42 35.74 27.67 36.06 27.14C36.39 26.62 37.12 25.18 37.67 24.38C38.23 23.58 38.77 22.98 39.4 22.36C40.02 21.73 40.63 21.19 41.43 20.64C42.23 20.09 43.64 19.41 44.2 19.05C44.77 18.7 44.66 18.74 44.79 18.53C44.93 18.31 45 18.2 44.99 17.77C44.98 17.33 44.77 16.4 44.74 15.92C44.71 15.44 44.73 15.25 44.81 14.86C44.88 14.47 45.01 13.99 45.18 13.58C45.36 13.18 45.62 12.76 45.86 12.44C46.09 12.12 46.33 11.9 46.6 11.67C46.87 11.45 47.17 11.25 47.48 11.08C47.79 10.92 48.08 10.79 48.46 10.68C48.85 10.57 49.37 10.46 49.77 10.43Z",di:"M56.1 23.7C59.29 25.62 61.19 28.86 61.5 32.3C61.52 32.49 61.53 32.68 61.54 32.87C61.64 33.19 61.87 33.46 62.19 33.61C62.43 33.73 62.7 33.75 62.95 33.7C63.11 33.63 63.28 33.55 63.44 33.48C66.63 32.13 70.39 32.27 73.59 34.18C78.9 37.37 80.63 44.26 77.45 49.57C76.65 50.92 75.6 52.03 74.41 52.89C74.18 53.06 73.94 53.22 73.69 53.37C73.55 53.57 73.47 53.82 73.47 54.08C73.47 54.41 73.59 54.71 73.8 54.93C73.93 55.01 74.06 55.1 74.18 55.19C78.77 58.59 80.11 64.97 77.12 69.97C74.14 74.95 67.91 76.78 62.76 74.37C62.75 74.37 62.73 74.36 62.72 74.36C62.63 74.31 62.54 74.27 62.45 74.22C62.33 74.16 62.22 74.1 62.11 74.04C61.87 74.01 61.63 74.04 61.41 74.16C61.16 74.29 60.97 74.5 60.88 74.74C60.86 74.97 60.84 75.2 60.82 75.44C60.63 76.96 60.14 78.48 59.3 79.88C56.11 85.19 49.22 86.92 43.91 83.74C40.73 81.83 38.83 78.6 38.5 75.18C38.48 74.96 38.47 74.73 38.46 74.51C38.35 74.21 38.13 73.96 37.83 73.81C37.59 73.7 37.34 73.68 37.1 73.72C36.92 73.81 36.73 73.89 36.55 73.97C33.36 75.31 29.6 75.17 26.41 73.26C21.1 70.07 19.37 63.18 22.55 57.87C23.35 56.53 24.39 55.42 25.59 54.55C25.82 54.38 26.06 54.22 26.31 54.07C26.45 53.87 26.53 53.62 26.53 53.36C26.53 53.03 26.4 52.74 26.19 52.52C26.07 52.43 25.94 52.34 25.82 52.25C21.23 48.86 19.89 42.47 22.88 37.47C25.84 32.52 32.02 30.68 37.15 33.03C37.36 33.12 37.56 33.22 37.76 33.33C38.07 33.39 38.4 33.32 38.68 33.13C38.9 32.97 39.06 32.75 39.14 32.51C39.15 32.33 39.17 32.16 39.19 31.98C39.37 30.46 39.87 28.96 40.71 27.56C43.89 22.25 50.78 20.52 56.1 23.7Z",furo:[50,15.7,2.48],aro:4.27,texto:{x:50,y:53.72,w:38.57,h:27.82,max:18.97,linhas:2},verso:{x:50,y:54.22,w:37.03,h:23.92,max:11,linhas:2}}},osso:{couro:{d:"M39.54 69.68C37.4 71.05 35.15 72.3 32.8 73.28C29.64 74.6 26.3 75.44 22.85 75.44C15.17 75.44 8.52 69.48 8.52 61.66C8.52 57.75 9.75 54.59 12.66 51.98C13.04 51.59 14.02 50.59 14.2 50.14C14.02 49.68 13.04 48.68 12.66 48.3C9.75 45.68 8.52 42.53 8.52 38.61C8.52 30.79 15.17 24.83 22.85 24.83C26.29 24.83 29.63 25.67 32.8 26.99C35.15 27.98 37.4 29.22 39.54 30.59C40.29 30.92 41.05 31.22 41.83 31.45C41.99 31.5 42.16 31.55 42.32 31.59C42.66 27.65 45.97 24.56 50 24.56C54.03 24.56 57.34 27.65 57.68 31.59C57.84 31.55 58.01 31.5 58.17 31.45C58.95 31.22 59.71 30.92 60.46 30.59C62.6 29.22 64.85 27.98 67.2 26.99C70.36 25.67 73.7 24.83 77.15 24.83C84.83 24.83 91.48 30.79 91.48 38.61C91.48 42.53 90.25 45.68 87.34 48.3C86.96 48.68 85.98 49.68 85.8 50.14C85.98 50.6 86.96 51.59 87.34 51.98C90.25 54.59 91.48 57.75 91.48 61.66C91.48 69.48 84.83 75.44 77.15 75.44C73.71 75.44 70.37 74.6 67.2 73.28C64.85 72.3 62.6 71.05 60.46 69.68C59.71 69.35 58.95 69.06 58.17 68.82C55.49 68.01 52.77 68.01 50 68.01C47.23 68.01 44.51 68.01 41.83 68.82C41.05 69.06 40.29 69.35 39.54 69.68Z",furo:[50,29.73,1.98],texto:{x:50,y:49.6,w:59.28,h:23.41,max:20.35,linhas:1},verso:{x:50,y:50.1,w:56.91,h:20.13,max:11.81,linhas:2}},metal:{d:"M62.87 27.95C65.07 26.76 67.39 25.77 69.64 25.09C71.79 24.44 73.87 24.07 75.34 23.87C76.21 23.71 77.11 23.63 78.02 23.63C86.1 23.63 92.64 30.18 92.64 38.25C92.64 43.03 90.35 47.27 86.81 49.94C90.41 52.61 92.75 56.89 92.75 61.71C92.75 69.79 86.2 76.34 78.12 76.34C78.11 76.34 78.1 76.34 78.09 76.34C75.89 76.4 73.68 76.43 71.29 75.98C68.77 75.51 66.04 74.5 63.64 73.34C61.24 72.18 59.17 70.86 57.32 70.04C55.48 69.23 53.86 68.91 52.68 68.75C51.5 68.59 50.75 68.58 50 68.57C49.25 68.58 48.5 68.59 47.32 68.75C46.14 68.91 44.52 69.23 42.68 70.04C40.83 70.86 38.76 72.18 36.36 73.34C33.96 74.5 31.23 75.51 28.71 75.98C26.32 76.43 24.11 76.4 21.91 76.34C21.9 76.34 21.89 76.34 21.88 76.34C13.8 76.34 7.25 69.79 7.25 61.71C7.25 56.89 9.59 52.61 13.19 49.94C9.65 47.27 7.36 43.03 7.36 38.25C7.36 30.18 13.91 23.63 21.98 23.63C22.9 23.63 23.79 23.71 24.66 23.87C26.13 24.07 28.21 24.44 30.36 25.09C32.61 25.77 34.93 26.76 37.13 27.95C39.05 28.98 40.88 30.16 42.69 31.35C42.8 27.41 46.03 24.25 50 24.25C53.97 24.25 57.2 27.41 57.31 31.35C59.13 30.16 60.95 28.98 62.87 27.95Z",furo:[50,29.03,2.48],texto:{x:50,y:49.76,w:60.75,h:24.26,max:21.1,linhas:1},verso:{x:50,y:50.26,w:58.32,h:20.86,max:12.24,linhas:2}},"metal-couro":{d:"M77.06 23.41C77.85 23.34 77.76 23.42 78.25 23.48C78.75 23.55 79.3 23.63 80.02 23.81C80.75 23.98 81.81 24.26 82.61 24.54C83.4 24.83 84.05 25.11 84.79 25.53C85.53 25.94 86.34 26.45 87.04 27.01C87.74 27.57 88.43 28.24 88.98 28.87C89.54 29.5 89.98 30.12 90.39 30.81C90.79 31.49 91.13 32.17 91.42 32.96C91.72 33.75 92 34.82 92.15 35.55C92.3 36.28 92.31 36.79 92.34 37.34C92.36 37.88 92.35 38.24 92.28 38.83C92.21 39.43 92.07 40.27 91.93 40.9C91.78 41.53 91.71 41.88 91.4 42.61C91.08 43.34 90.45 44.6 90.05 45.28C89.65 45.97 89.47 46.15 88.99 46.73C88.5 47.3 87.52 48.24 87.17 48.71C86.81 49.18 86.87 49.3 86.83 49.53C86.8 49.76 86.87 49.93 86.94 50.11C87.01 50.3 86.7 49.98 87.24 50.62C87.79 51.27 89.57 53.23 90.2 54C90.83 54.77 90.78 54.82 91.03 55.24C91.29 55.67 91.51 56.07 91.72 56.57C91.94 57.08 92.16 57.69 92.31 58.27C92.47 58.84 92.59 59.49 92.65 60.03C92.72 60.57 92.73 61.03 92.71 61.52C92.7 62.02 92.72 62.23 92.56 63.01C92.39 63.79 92.07 65.21 91.72 66.19C91.36 67.17 90.94 68.04 90.43 68.89C89.91 69.73 89.1 70.7 88.61 71.27C88.13 71.83 87.91 71.97 87.53 72.3C87.15 72.62 86.98 72.82 86.35 73.21C85.71 73.6 84.69 74.25 83.73 74.65C82.76 75.05 81.65 75.38 80.58 75.61C79.51 75.84 78.41 76 77.32 76.04C76.23 76.08 75.12 75.99 74.03 75.86C72.95 75.72 71.77 75.46 70.81 75.21C69.84 74.96 69.23 74.74 68.25 74.35C67.28 73.96 66.45 73.62 64.97 72.89C63.5 72.15 60.81 70.62 59.42 69.94C58.03 69.26 57.65 69.11 56.65 68.81C55.65 68.51 54.62 68.27 53.43 68.14C52.25 68.01 50.69 68 49.54 68.05C48.4 68.1 47.64 68.2 46.58 68.43C45.51 68.67 44.16 69.08 43.13 69.45C42.1 69.81 42.05 69.84 40.38 70.63C38.71 71.42 34.89 73.38 33.12 74.19C31.35 74.99 30.96 75.1 29.77 75.46C28.58 75.83 26.91 76.17 25.98 76.36C25.05 76.54 24.74 76.53 24.2 76.57C23.65 76.61 23.3 76.63 22.7 76.59C22.11 76.56 21.26 76.45 20.62 76.34C19.99 76.22 19.45 76.09 18.88 75.92C18.3 75.75 17.78 75.57 17.18 75.32C16.59 75.07 15.91 74.75 15.3 74.42C14.69 74.08 14.05 73.67 13.53 73.3C13 72.92 12.57 72.57 12.13 72.17C11.68 71.77 11.29 71.38 10.86 70.89C10.44 70.4 9.99 69.86 9.58 69.24C9.18 68.61 8.75 67.87 8.43 67.14C8.11 66.41 7.85 65.65 7.66 64.88C7.48 64.1 7.36 63.3 7.33 62.51C7.3 61.71 7.37 60.86 7.48 60.12C7.59 59.39 7.75 58.8 7.99 58.09C8.24 57.39 8.54 56.64 8.94 55.89C9.34 55.15 9.77 54.47 10.4 53.63C11.02 52.79 12.27 51.42 12.7 50.87C13.12 50.32 12.9 50.52 12.96 50.34C13.01 50.15 13.04 49.94 13.03 49.74C13.02 49.55 12.96 49.35 12.89 49.17C12.82 48.98 13.13 49.31 12.6 48.64C12.07 47.98 10.43 46.16 9.72 45.2C9.01 44.24 8.64 43.46 8.33 42.89C8.03 42.32 8.02 42.21 7.88 41.78C7.74 41.36 7.6 40.83 7.5 40.34C7.39 39.85 7.31 39.36 7.27 38.86C7.22 38.37 7.21 37.91 7.25 37.37C7.29 36.82 7.39 36.18 7.5 35.59C7.6 35 7.74 34.41 7.9 33.84C8.07 33.27 8.3 32.65 8.51 32.15C8.71 31.64 8.92 31.23 9.16 30.8C9.4 30.36 9.66 29.94 9.96 29.54C10.25 29.13 10.57 28.75 10.91 28.38C11.25 28.02 11.61 27.66 11.98 27.34C12.36 27.01 12.76 26.71 13.18 26.44C13.59 26.16 14.03 25.91 14.47 25.68C14.91 25.46 15.13 25.31 15.84 25.08C16.55 24.85 17.75 24.47 18.72 24.29C19.7 24.11 20.66 24 21.7 24C22.74 24 23.89 24.12 24.97 24.3C26.05 24.49 26.98 24.72 28.17 25.09C29.36 25.46 30.91 26.03 32.11 26.51C33.32 26.99 33.78 27.19 35.4 27.97C37.01 28.75 40.55 30.59 41.81 31.21C43.06 31.83 42.63 31.57 42.91 31.67C43.2 31.76 43.31 31.78 43.5 31.77C43.7 31.77 43.92 31.74 44.08 31.65C44.24 31.55 44.32 31.72 44.48 31.22C44.65 30.71 44.82 29.29 45.06 28.59C45.3 27.9 45.57 27.49 45.94 27.04C46.31 26.58 46.83 26.15 47.28 25.86C47.74 25.57 48.23 25.41 48.66 25.28C49.09 25.16 49.49 25.12 49.84 25.1C50.19 25.08 50.39 25.1 50.73 25.17C51.07 25.23 51.52 25.33 51.89 25.48C52.25 25.63 52.62 25.82 52.94 26.04C53.27 26.27 53.59 26.59 53.83 26.84C54.07 27.09 54.09 26.98 54.38 27.55C54.66 28.13 55.27 29.77 55.55 30.29C55.82 30.8 55.85 30.56 56.03 30.63C56.21 30.7 56.33 30.74 56.62 30.68C56.91 30.63 56.26 31.01 57.76 30.32C59.25 29.64 63.68 27.43 65.58 26.56C67.48 25.68 68.2 25.45 69.18 25.08C70.16 24.71 70.74 24.56 71.46 24.35C72.18 24.15 72.57 24.02 73.5 23.86C74.43 23.7 76.27 23.47 77.06 23.41Z",di:"M77.45 27.69C87.96 28.83 90.99 38.6 85.23 44.64C83.81 46.13 79.57 48.81 83.89 53.33C86.47 56.04 89.77 58.58 87.96 64.23C85.42 72.13 76.75 73.02 70.28 70.62C63.51 68.1 60.16 63.78 51.06 63.74C39.15 63.7 33.38 71.77 23.82 72.35C16.58 72.79 6.71 64.43 14.39 55.51C16.41 53.17 18.22 52.04 17.16 48.14C16.08 44.17 9.5 42.54 12.14 34.58C14.25 28.25 21.03 27.3 26.85 29.13C40.62 33.48 43.11 41.16 58.27 34.79C64.52 32.16 70.51 27.93 77.45 27.69Z",furo:[50,30.37,2.48],aro:4.27,texto:{x:50,y:50.15,w:52.96,h:20.55,max:17.87,linhas:1},verso:{x:50,y:50.65,w:50.84,h:17.68,max:10.37,linhas:2}}}};
    const circuloD = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
    function formaDe(formato, tipo) {
        const f = FORMAS[compacto(formato)] || FORMAS.coracao;
        const s = f[tipo] || f.metal;
        // contorno + furo (preenchido com fill-rule evenodd: o furo é vazado de verdade)
        if (!s.dh) s.dh = s.d + circuloD(s.furo[0], s.furo[1], s.furo[2]);
        return s;
    }

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
        const tipo = op.tipo === 'couro' || op.tipo === 'metal-couro' ? op.tipo : 'metal';
        const f = formaDe(op.formato, tipo);
        const me = estiloPingente(op.metal);
        const couroHex = op.couroHex || '#d3cec3';
        const verso = op.lado === 'verso';
        const mc = tipo === 'metal-couro';
        const tudoCouro = tipo === 'couro';
        const [fx, fy, rf] = f.furo;

        if (op.lado === 'aresta') {
            const cor = tudoCouro ? sombraHex(couroHex, 0.62) : me.aresta;
            return `<svg viewBox="-8 -8 116 116" aria-hidden="true"><path d="${f.dh}" fill="${cor}" fill-rule="evenodd"/></svg>`;
        }

        // Couro do pingente = imagem pronta da cor (imagemDoCouro), exibida como é:
        // nada de filtro, mistura ou tingimento por cima. Sem imagem, cor lisa.
        const tex = imagemDoCouro();
        const camadaTex = (d, evenodd) => (tex ? `<path d="${d}"${evenodd ? ' fill-rule="evenodd"' : ''} fill="url(#${id}t)"/>` : '');
        const filtroCouro = '';
        const g = me.g;
        const defs = `
          <defs>
            <linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="${g[0]}"/><stop offset=".3" stop-color="${g[1]}"/>
              <stop offset=".58" stop-color="${g[2]}"/><stop offset=".8" stop-color="${g[3]}"/><stop offset="1" stop-color="${g[4]}"/>
            </linearGradient>
            <linearGradient id="${id}b" gradientUnits="userSpaceOnUse" x1="-40" y1="0" x2="60" y2="100" gradientTransform="translate(${op.brilhoX || 0} 0)" data-atl-brilho-grad>
              <stop offset=".35" stop-color="#fff" stop-opacity="0"/>
              <stop offset=".5" stop-color="${me.luz}" stop-opacity="${tudoCouro ? 0.08 : 0.26}"/>
              <stop offset=".65" stop-color="#fff" stop-opacity="0"/>
            </linearGradient>
            ${tex ? `<pattern id="${id}t" patternUnits="userSpaceOnUse" x="${50 - LADO_IMAGEM_COURO / 2}" y="${50 - LADO_IMAGEM_COURO / 2}" width="${LADO_IMAGEM_COURO}" height="${LADO_IMAGEM_COURO}"><image href="${tex}" width="${LADO_IMAGEM_COURO}" height="${LADO_IMAGEM_COURO}" preserveAspectRatio="xMidYMid slice"/></pattern>` : ''}
            <clipPath id="${id}c"><path d="${f.dh}" clip-rule="evenodd"/></clipPath>
            ${mc ? `<clipPath id="${id}i"><path d="${f.di}"/></clipPath>` : ''}
            <filter id="${id}g" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
              <feTurbulence type="turbulence" baseFrequency=".21" numOctaves="2" seed="11" result="n"/>
              <feDiffuseLighting in="n" surfaceScale="1.1" lighting-color="#fff" result="l"><feDistantLight azimuth="235" elevation="58"/></feDiffuseLighting>
              <feComponentTransfer in="l" result="l2"><feFuncR type="linear" slope=".38" intercept=".66"/><feFuncG type="linear" slope=".38" intercept=".66"/><feFuncB type="linear" slope=".38" intercept=".66"/></feComponentTransfer>
              <feComposite in="l2" in2="SourceAlpha" operator="in" result="lc"/>
              <feBlend in="SourceGraphic" in2="lc" mode="multiply"/>
            </filter>
          </defs>`;

        let corpo = '';
        if (tudoCouro) {
            corpo += `<path d="${f.dh}" fill-rule="evenodd" fill="${couroHex}"${filtroCouro}/>` + camadaTex(f.dh, true);
        } else if (mc) {
            // Metal com couro: moldura de metal (aro + orelha, com o furo vazado)
            // e o couro por dentro, um pouco rebaixado.
            corpo += `<path d="${f.dh}" fill-rule="evenodd" fill="url(#${id}m)"/>`;
            corpo += `<path d="${f.di}" fill="${couroHex}"${filtroCouro}/>` + camadaTex(f.di, false);
            // Sem a sombra do degrau entre o aro e o couro (retirada em 15/10/2026,
            // a pedido, para ver como fica). Eram duas faixas (sombra e luz)
            // recortadas pelo couro e um fio escuro no contorno dele.
        } else {
            corpo += `<path d="${f.dh}" fill-rule="evenodd" fill="url(#${id}m)"/>`;
        }
        // Bisel: luz em cima, sombra embaixo, sempre dentro da forma.
        corpo += `<g clip-path="url(#${id}c)">
            <path d="${f.dh}" fill="none" stroke="rgba(255,255,255,${tudoCouro ? 0.1 : 0.3})" stroke-width="2.2" transform="translate(.6 .9)"/>
            <path d="${f.dh}" fill="none" stroke="rgba(0,0,0,${tudoCouro ? 0.2 : 0.28})" stroke-width="2.2" transform="translate(-.6 -.9)"/>
          </g>`;

        // Furo: vazado de verdade (se vê o fundo). O couro tem o corte cru; o
        // metal, um fio de luz na borda. Não há ilhós: o couro das peças reais
        // é só furado.
        corpo += `<circle cx="${fx}" cy="${fy}" r="${rf}" fill="none" stroke="${tudoCouro ? 'rgba(40,28,20,.35)' : 'rgba(255,255,255,.55)'}" stroke-width=".6"/>`;
        // A argola atravessa o furo de lado: de frente ela é um aro estreito
        // na vertical, como um "I" (no 3D, um aro perpendicular vira "O" ao girar).
        let argola = '';
        if (op.argola !== false) {
            // De frente o aro é visto de borda: uma barra reta "|" com pontas
            // arredondadas, que desce até dentro do furo.
            const ay = ayArgola(fy, rf);
            const barra = `M${fx},${ay - ARGOLA_RY} L${fx},${ay + ARGOLA_RY}`;
            argola = `<g fill="none" class="atl-argola-i" stroke-linecap="round">
                <path d="${barra}" stroke="${me.aresta}" stroke-width="2.6"/>
                <path d="${barra}" stroke="url(#${id}m)" stroke-width="1.5"/>
                <path d="M${fx - 0.4},${ay - ARGOLA_RY + 0.8} L${fx - 0.4},${ay + ARGOLA_RY - 0.8}" stroke="rgba(255,255,255,.55)" stroke-width=".4"/>
              </g>`;
        }

        if (op.semTexto) {
            const brilhoMini = `<rect x="-10" y="-10" width="120" height="120" fill="url(#${id}b)" clip-path="url(#${id}c)" style="mix-blend-mode:screen"/>`;
            return `<svg viewBox="-8 -8 116 116" aria-hidden="true" style="isolation:isolate">${defs}${corpo}${brilhoMini}${argola}</svg>`;
        }

        // Gravação: sempre PRETA, porque é queimada a laser (metal ou couro). Os
        // tons que aparecem no scan são desgaste da peça (resposta do Muriel).
        // O corpo da letra é o maior que cabe na largura E na altura da área.
        const area = verso ? f.verso : f.texto;
        const linhas = (verso ? [op.tutor, op.tel] : quebrarNome(op.nome, area.linhas)).filter((l) => l && String(l).trim());
        const vazio = !linhas.length;
        const marcador = verso ? ['Nome do tutor', '11 99999-9999'] : (area.linhas > 1 ? ['nome do', 'seu pet'] : ['nome do pet']);
        const usar = vazio ? marcador : linhas;
        const maior = usar.reduce((m, l) => Math.max(m, larguraPorCorpo(l)), 0.01);
        const lhFator = 1.12;
        // A frente leva 88 % do corpo que cabe: o nome ocupava a peça quase de ponta a ponta (pedido do Muriel, 14/10/2026). O verso não muda.
        const fs = Math.max(3.6, Math.min(area.max, area.w / maior, area.h / (usar.length * lhFator)) * (verso ? 1 : 0.88));
        const lh = fs * lhFator;
        const y0 = area.y - ((usar.length - 1) * lh) / 2 + fs * 0.36;
        const tspans = usar.map((l, i) => `<tspan x="${area.x}" y="${(y0 + i * lh).toFixed(2)}">${esc(l)}</tspan>`).join('');
        const gravura = `<text text-anchor="middle" font-family="${FONTE_GRAVACAO}" font-weight="500" font-size="${fs.toFixed(2)}" fill="#1b1714" opacity="${vazio ? 0.3 : 0.9}">${tspans}</text>`;

        const brilho = `<rect x="-10" y="-10" width="120" height="120" fill="url(#${id}b)" clip-path="url(#${id}c)" style="mix-blend-mode:screen"/>`;

        return `<svg viewBox="-8 -8 116 116" role="img" style="isolation:isolate" aria-label="${esc(verso ? 'Verso do pingente' : 'Frente do pingente')}">${defs}${corpo}${gravura}${brilho}${argola}</svg>`;
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
        // Centro do passador nas fotos de 16/10/2026: x 0,469 y 0,518 (a faixa
        // clara vai de y 0,41 a 0,63).
        passador: { x: 0.469, y: 0.518, s: 2.1 },
        // Centro da fivela medido nas fotos de 16/10/2026: x 0,177 y 0,50 (a
        // coleira ficou um pouco mais baixa e mais larga). Zoom 2,0 (era 2,3).
        fivela: { x: 0.177, y: 0.5, s: 2.0 },
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

    // ── Troca de foto ──
    // A foto nova entra por cima da velha com a "tinta": varre da esquerda
    // (couro) ou abre num círculo a partir do ponto que mudou (passador,
    // metal). Durante a troca as duas ficam em PRETO E BRANCO (classe
    // is-trocando na arte, 13/10/2026): no "multiply" a nova se mistura com a
    // velha por baixo, e em cores a coleira aparecia num terceiro tom, que não
    // existe. Clientes ficavam em dúvida sobre a cor real. A cor volta só
    // quando a foto certa está sozinha no palco.
    //
    // As trocas rodam UMA DE CADA VEZ, sempre para a última cor escolhida.
    // Antes, uma troca pedida durante a varredura da anterior reaproveitava a
    // foto que ainda estava entrando; no fim as duas referências apontavam
    // para o mesmo <img> e o palco ficava VAZIO até recarregar a página.
    let fotoAtual = imgA.getAttribute('src') || '';
    let fotoAlvo = '';
    let efeitoAlvo = null;
    let trocando = false;

    // A mesma foto chega com endereços diferentes (o Liquid usa o CDN da loja,
    // o Waltz o da Shopify, e a largura muda): compara pelo nome do arquivo.
    const arquivoDa = (u) => String(u || '').split('?')[0].split('/').pop();
    const mesmaFoto = (a, b) => !!arquivoDa(a) && arquivoDa(a) === arquivoDa(b);

    /** Baixa e decodifica fora do palco: o <img> do palco só recebe a foto pronta. */
    function decodificar(url) {
        const i = new Image();
        i.decoding = 'async';
        i.src = url;
        return Promise.race([i.decode(), espera(4000)]).catch(() => { /* segue mesmo assim */ });
    }

    function trocarFoto(src, efeito) {
        if (!src) return;
        fotoAlvo = urlFoto(src);
        efeitoAlvo = efeito;
        if (!trocando) rodarTrocas();
    }

    async function rodarTrocas() {
        trocando = true;
        try {
            while (fotoAlvo && !mesmaFoto(fotoAlvo, fotoAtual)) {
                const url = fotoAlvo;
                const efeito = efeitoAlvo;
                // A foto perde a cor já no clique: enquanto a nova carrega, a
                // velha não pode passar por cor certa (a legenda já mostra o
                // nome da nova).
                arte.classList.add('is-trocando');
                const t = setTimeout(() => { carregando.hidden = false; }, 220);
                await decodificar(url);
                clearTimeout(t);
                carregando.hidden = true;
                if (url !== fotoAlvo) continue; // escolheu outra enquanto carregava
                await animarEntrada(url, efeito);
            }
            // Mesma foto em outra largura (a do Liquid tem 1000 px): troca
            // calada, sem tinta e sem tirar a cor.
            if (fotoAlvo && fotoAlvo !== fotoAtual) {
                const url = fotoAlvo;
                await decodificar(url);
                if (url === fotoAlvo && mesmaFoto(url, fotoAtual)) {
                    imgA.src = url;
                    fotoAtual = url;
                }
            }
        } finally {
            trocando = false;
            arte.classList.remove('is-trocando');
        }
        // Pedido que chegou durante a troca calada.
        if (fotoAlvo && fotoAlvo !== fotoAtual && !mesmaFoto(fotoAlvo, fotoAtual)) rodarTrocas();
    }

    async function animarEntrada(url, efeito) {
        const prox = imgB;
        const velha = imgA;
        prox.src = url;
        try { await Promise.race([prox.decode(), espera(1500)]); } catch (e) { /* já veio decodificada */ }
        const circulo = !!(efeito && efeito.x != null);
        let quadros;
        if (circulo) {
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
        const curva = { duration: semMovimento ? 1 : (circulo ? 760 : 900), easing: 'cubic-bezier(.22,1,.36,1)' };
        let saida = null;
        if (!circulo) {
            if (!semMovimento) {
                // A faixa de luz acompanha a borda da tinta (de 0 a 100 % da foto).
                varredura.animate([
                    { transform: 'translateX(-50%)', opacity: 0.95 },
                    { transform: 'translateX(40%)', opacity: 0.95, offset: 0.8 },
                    { transform: 'translateX(50%)', opacity: 0 },
                ], curva);
            }
            // Na varredura a foto velha sai na mesma medida em que a nova
            // entra, então as duas nunca se sobrepõem.
            saida = velha.animate([{ clipPath: 'inset(0 0 0 0%)' }, { clipPath: 'inset(0 0 0 100%)' }], Object.assign({ fill: 'forwards' }, curva));
        } else {
            // No círculo não dá para recortar a foto velha "por fora": uma tampa
            // da cor do estúdio abre junto com a nova e esconde a velha por
            // baixo dela. Sem isso, em cinza sobre cinza, o couro escurecia.
            const tampa = arte.querySelector('.atl-palco__tampa') || (() => {
                const s = document.createElement('span');
                s.className = 'atl-palco__tampa';
                s.setAttribute('aria-hidden', 'true');
                arte.appendChild(s);
                return s;
            })();
            saida = tampa.animate(quadros.map((q) => Object.assign({ opacity: 1 }, q)), Object.assign({ fill: 'forwards' }, curva));
        }
        prox.classList.add('is-entrando');
        try { await prox.animate(quadros, curva).finished; } catch (e) { /* cancelada */ }
        prox.classList.remove('is-entrando');
        prox.classList.add('is-front');
        velha.classList.remove('is-front');
        if (saida) saida.cancel();
        [imgA, imgB] = [prox, velha];
        fotoAtual = url;
    }

    // ── Couro do pingente: imagens prontas do Muriel (assets/couro-<cor>.jpg) ──
    // O pingente é sempre na cor do detalhe da coleira (última cor do nome). Cada
    // cor tem uma imagem quadrada de couro real, que entra como está: sem filtro,
    // mistura nem tingimento. Cor sem imagem fica na cor lisa do tema.
    // Antes eu recortava a foto da coleira (e medi a cor dela): a textura não
    // ficou boa e o passador de coleira com detalhe diferente é pequeno demais.
    const ARQUIVO_COURO = {
        allure: 'allure', azulbebe: 'azulbb', borgonha: 'borgonha', branco: 'branco', cafe: 'cafe',
        camel: 'camel', chiclete: 'chiclete', lilascandy: 'lilascandy', marinho: 'marinho',
        militar: 'militar', nude: 'nude', offwhite: 'off', preto: 'preto', rosabebe: 'rosabb',
        rosaseco: 'rosaseco', sepia: 'sepia',
    };
    // Tamanho, em mm do pingente, em que a imagem de couro (40 × 40 mm no arquivo)
    // é exibida. O pingente usa 2,25 unidades por mm. 40 = escala real; 60 = grão
    // 50 % maior (pedido do Muriel, 14/10/2026: em 40 o grão ficou pequeno). Acima
    // de ~38 a imagem passa do pingente, então não repete.
    const MM_DA_IMAGEM = 60;
    const LADO_IMAGEM_COURO = MM_DA_IMAGEM * 2.25;
    function imagemDoCouro() {
        const chave = ARQUIVO_COURO[compacto(ultimaCor(S.cor || CFG.inicio.cor || ''))];
        return (chave && CFG.couros && CFG.couros[chave]) || '';
    }

    function preCarregar(srcs) {
        srcs.filter(Boolean).forEach((s) => { const i = new Image(); i.decoding = 'async'; i.src = urlFoto(s); });
    }

    // ── Pingente pendurado na argola (resumo) ──
    function desenharPendurado() {
        const ativo = S.pTipo && S.pTipo !== 'nenhum' && S.pFormato && S.passo === E.resumo;
        palco.classList.toggle('tem-pingente', !!ativo);
        if (!ativo) { pendurado.innerHTML = ''; return; }
        const f = formaDe(S.pFormato, S.pTipo);
        pendurado.innerHTML = `<div class="atl-pendurado__balanco" style="--furo-x:${(f.furo[0] + 8) / 1.16}%;--furo-y:${(f.furo[1] + 8) / 1.16}%;--ang:0deg">${svgPingente(opcoesPingente('frente', { argola: true }))}</div>`;
    }

    // ── Pingente em 3D (etapa Pingente) ──
    const giro = { ry: -10, rx: 3, alvoRy: -10, alvoRx: 3, arrastando: false, lado: 'frente', ultimoToque: 0, raf: 0 };

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
        // A argola é UMA só, mas tem duas representações: o "I" desenhado nas
        // faces (de frente, o aro visto de borda) e o aro perpendicular em 3D
        // (de lado, vira "O"). Antes as duas ficavam sempre ligadas e, girando,
        // aparecia uma argola em cada orientação. Agora aplicarGiro troca uma
        // pela outra conforme o ângulo, no ponto em que as larguras coincidem.
        html += `<div class="atl-p3d__face atl-p3d__face--frente">${svgPingente(opcoesPingente('frente'))}</div>`;
        html += `<div class="atl-p3d__face atl-p3d__face--verso">${svgPingente(opcoesPingente('verso'))}</div>`;
        // O aro 3D tem espessura: camadas do mesmo aro empilhadas de lado a
        // lado, a mesma ideia das camadas da aresta do pingente.
        const op = opcoesPingente('frente');
        const f = formaDe(op.formato, op.tipo);
        const me = estiloPingente(op.metal);
        const lado = ((2 * ARGOLA_RY + 2.6) / 116) * 100;
        const cxA = ((f.furo[0] + 8) / 116) * 100 - lado / 2;
        const cyA = ((ayArgola(f.furo[1], f.furo[2]) + 8) / 116) * 100 - lado / 2;
        const FIOS = 7;
        for (let i = 0; i < FIOS; i++) {
            const t = (i / (FIOS - 1)) * 2 - 1;                  // -1 .. 1 ao longo da espessura
            const z = (t * 3.4).toFixed(2);
            const miolo = Math.abs(t) < 0.45;                    // o centro pega a luz, as bordas escurecem
            const cor = miolo ? me.g[1] : (Math.abs(t) < 0.8 ? me.g[2] : me.aresta);
            html += `<div class="atl-p3d__argola" style="left:${cxA.toFixed(2)}%;top:${cyA.toFixed(2)}%;width:${lado.toFixed(2)}%;height:${lado.toFixed(2)}%;transform:rotateY(90deg) translateZ(${z}px)"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.7" fill="none" stroke="${cor}" stroke-width="1.5"/></svg></div>`;
        }
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
        // "I" das faces de frente; aro 3D de lado. Mesma largura em ~17°.
        const t = Math.max(0, Math.min(1, (Math.abs(rel) - 13) / 8));
        p3dObj.style.setProperty('--ring-i', (1 - t).toFixed(3));
        p3dObj.style.setProperty('--ring-o', t.toFixed(3));
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
            const balanco = ocioso && !semMovimento ? Math.sin(t / 1600) * 10 : 0;
            const alvoRy = (giro.alvoRy != null ? giro.alvoRy : base) + balanco;
            const alvoRx = 3 + (ocioso && !semMovimento ? Math.sin(t / 2300) * 2 : 0);
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
                giro.alvoRy = volta + base + nx * 24;
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
    // Cores mais vendidas (lista do editor do tema; casa pelo nome sem acento).
    const MAIS_VENDIDAS = new Set((CFG.maisVendidas || []).map((n) => compacto(n)).filter(Boolean));
    function renderCouros() {
        const box = $('[data-atl-couros]');
        const leg = $('[data-atl-cores-legenda]');
        if (leg) leg.hidden = !M.couros.some((c) => MAIS_VENDIDAS.has(compacto(c)));
        box.innerHTML = M.couros.map((c) => {
            const hex = hexDe(c);
            const n = M.porCouro.get(c).length;
            return `<button type="button" class="atl-cor${S.couro === c ? ' is-ativo' : ''}" aria-pressed="${S.couro === c}" data-couro="${esc(c)}" style="--cor:${hex}${miniDe(c) ? `;--img:url('${miniDe(c)}');--atl-grao:none` : ''}" data-tom="${claroOuEscuro(hex)}">
                <span class="atl-cor__disco" aria-hidden="true"></span>
                <span class="atl-cor__nome">${esc(c)}</span>
                ${MAIS_VENDIDAS.has(compacto(c)) ? '<span class="atl-cor__top" title="Mais vendida" aria-label="Mais vendida">★</span>' : ''}
                ${n > 1 ? `<span class="atl-cor__mais" aria-label="${n} opções de passador">${n}</span>` : ''}
            </button>`;
        }).join('');
    }

    // O passador mora embaixo da foto fixa: só na etapa Cores, e só quando o
    // couro tem mais de uma opção (com uma só, a legenda já diz qual é).
    // No computador (≥ 990 px) o seletor vai para baixo da grade de cores, na
    // coluna das opções; no celular continua colado na foto. É o mesmo nó
    // movido de lugar (os cliques são delegados na raiz), então nada é refeito.
    const mqDesktop = window.matchMedia('(min-width: 990px)');
    function posicionarPassador() {
        const bloco = $('[data-atl-passador-bloco]');
        const alvo = $('[data-atl-couros]');
        const foto = $('[data-atl-legenda]');
        if (!bloco || !alvo || !foto) return;
        if (mqDesktop.matches) alvo.insertAdjacentElement('afterend', bloco);
        else foto.insertAdjacentElement('afterend', bloco);
    }
    posicionarPassador();
    if (mqDesktop.addEventListener) mqDesktop.addEventListener('change', posicionarPassador);

    let passadorTemOpcoes = false;
    function mostrarPassadores() {
        const bloco = $('[data-atl-passador-bloco]');
        if (bloco) bloco.hidden = !(passadorTemOpcoes && S.passo === E.cores);
    }

    function renderPassadores() {
        if (!S.couro) { passadorTemOpcoes = false; mostrarPassadores(); return; }
        const ops = M.porCouro.get(S.couro) || [];
        passadorTemOpcoes = ops.length > 1;
        $('[data-atl-passadores]').innerHTML = ops.map((o) => {
            const nome = o.passador || 'Mesmo tom';
            const hexP = hexDe(o.passador || S.couro);
            return `<button type="button" class="atl-passador__op${S.cor === o.cor ? ' is-ativo' : ''}" aria-pressed="${S.cor === o.cor}" data-cor="${esc(o.cor)}">
                <span class="atl-passador__amostra${miniDe(S.couro) && miniDe(o.passador || S.couro) ? ' atl-passador__amostra--img' : ''}" aria-hidden="true" style="--a:${hexDe(S.couro)};--b:${hexP}${miniDe(S.couro) && miniDe(o.passador || S.couro) ? `;--ai:url('${miniDe(S.couro)}');--bi:url('${miniDe(o.passador || S.couro)}')` : ''}"></span>
                <span>${esc(nome)}</span>
            </button>`;
        }).join('');
        mostrarPassadores();
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
    // Versão de teste (?view=atelier-raca): só a raça, opcional, sem idade e peso.
    const SO_RACA = CFG.camposPet === 'so_raca';
    const ORIGEM = SO_RACA ? 'atelier_raca' : 'atelier';
    const camposExtras = () => (CFG.campos || []).filter((c) => c.tag !== 'customizacao_raca').sort((a, b) => (parseInt(a.ordem, 10) || 0) - (parseInt(b.ordem, 10) || 0));

    function renderPetInfo() {
        const box = $('[data-atl-pet-info]');
        box.innerHTML = `
          <div class="atl-campo atl-campo--raca">
            <input type="text" id="atl-raca" class="atl-campo__input" autocomplete="off" placeholder=" " value="${esc(S.raca)}" data-atl-raca role="combobox" aria-expanded="false" aria-controls="atl-racas" aria-autocomplete="list">
            <label for="atl-raca" class="atl-campo__rotulo">${SO_RACA ? 'Raça (opcional)' : 'Raça'}</label>
            <ul class="atl-racas" id="atl-racas" role="listbox" data-atl-racas hidden></ul>
          </div>
          <div class="atl-linha"${SO_RACA ? ' hidden' : ''}>
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
            box.innerHTML = SO_RACA
                ? `<p>Só pela raça não conseguimos indicar o tamanho de um ${esc(rec.raca)}. Meça o pescoço para escolher com segurança.</p>`
                : `<p>Para indicar o tamanho de um ${esc(rec.raca)}, precisamos do <strong>peso</strong>.</p>`;
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

    // ── Stories: vídeos em círculos no topo, tocados em tela cheia ──
    // Os vídeos do produto já vêm no HTML (data-atl-story); o "Como medir" vem
    // do Waltz (TM.video) e entra no INÍCIO da fileira por storyMedir().
    const faixaStories = $('[data-atl-stories]');
    const hist = $('[data-atl-hist]');
    const histVideo = $('[data-atl-hist-video]');
    const hs = { i: 0, som: true };
    function storyMedir() {
        if (!faixaStories || !TM || !TM.video || faixaStories.querySelector('[data-atl-story-medir]')) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'atl-story atl-story--medir';
        b.setAttribute('data-atl-story', '');
        b.setAttribute('data-atl-story-medir', '');
        b.dataset.src = TM.video;
        b.dataset.rotulo = 'Como medir';
        b.setAttribute('aria-label', 'Ver vídeo: como medir o pescoço');
        // O círculo mostra o primeiro quadro do próprio vídeo (não há imagem de capa).
        b.innerHTML = `<span class="atl-story__anel"><video src="${esc(TM.video)}#t=0.6" muted playsinline preload="metadata" tabindex="-1" aria-hidden="true"></video></span><span class="atl-story__nome">Como medir</span>`;
        faixaStories.prepend(b);
        faixaStories.hidden = false;
    }
    const listaStories = () => $$('[data-atl-story]', faixaStories || root);
    function tocarStory(i) {
        const itens = listaStories();
        if (!itens.length) return;
        hs.i = (i + itens.length) % itens.length;
        const it = itens[hs.i];
        $('[data-atl-hist-titulo]').textContent = it.dataset.rotulo || '';
        $('[data-atl-hist-barras]').innerHTML = itens.map((_, k) => `<span class="${k < hs.i ? 'is-feita' : ''}${k === hs.i ? ' is-atual' : ''}"><i></i></span>`).join('');
        histVideo.muted = !hs.som;
        histVideo.src = it.dataset.src;
        const p = histVideo.play();
        if (p && p.catch) p.catch(() => { histVideo.muted = true; histVideo.play().catch(() => {}); });
        mostrarSomHist();
    }
    function mostrarSomHist() {
        const m = $('[data-atl-hist-mudo]');
        if (m) m.style.display = histVideo.muted ? '' : 'none';
        $('[data-atl-hist-som]').setAttribute('aria-label', histVideo.muted ? 'Ativar som' : 'Desativar som');
    }
    function abrirStories(i) {
        hist.hidden = false;
        document.documentElement.classList.add('atl-travado');
        requestAnimationFrame(() => hist.classList.add('is-aberta'));
        tocarStory(i);
        const aberto = listaStories()[i];
        publicar('story', { story: aberto ? aberto.dataset.rotulo : '' });
    }
    function fecharStories() {
        if (hist.hidden) return;
        hist.classList.remove('is-aberta');
        document.documentElement.classList.remove('atl-travado');
        histVideo.pause();
        setTimeout(() => { hist.hidden = true; histVideo.removeAttribute('src'); histVideo.load(); }, 250);
    }
    if (faixaStories && hist) {
        faixaStories.addEventListener('click', (e) => {
            const b = e.target.closest('[data-atl-story]');
            if (b) abrirStories(listaStories().indexOf(b));
        });
        $$('[data-atl-hist-fechar]').forEach((b) => b.addEventListener('click', fecharStories));
        $('[data-atl-hist-ant]').addEventListener('click', () => tocarStory(hs.i - 1));
        $('[data-atl-hist-prox]').addEventListener('click', () => tocarStory(hs.i + 1));
        $('[data-atl-hist-som]').addEventListener('click', () => { hs.som = histVideo.muted; histVideo.muted = !hs.som; mostrarSomHist(); });
        histVideo.addEventListener('ended', () => {
            if (hs.i < listaStories().length - 1) tocarStory(hs.i + 1); else fecharStories();
        });
        histVideo.addEventListener('timeupdate', () => {
            const atual = $('[data-atl-hist-barras] .is-atual i');
            if (atual && histVideo.duration) atual.style.transform = `scaleX(${(histVideo.currentTime / histVideo.duration).toFixed(3)})`;
        });
        document.addEventListener('keydown', (e) => {
            if (hist.hidden) return;
            if (e.key === 'Escape') fecharStories();
            else if (e.key === 'ArrowRight') tocarStory(hs.i + 1);
            else if (e.key === 'ArrowLeft') tocarStory(hs.i - 1);
        });
        storyMedir();
    }

    // ── Folha "Como medir" ──
    const folha = $('[data-atl-folha]');
    function abrirFolha() {
        const box = $('[data-atl-folha-conteudo]');
        // O vídeo de como medir agora é um dos stories do topo (storyMedir).
        box.innerHTML = `
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
          ${tot.junto.map((l) => `<div class="atl-total__linha"><span>${esc(l.title)}</span><span>${dinheiro(l.price)}</span></div>`).join('')}
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
        const junto = linhasJunto();
        const total = (coleira || 0) + pingente + junto.reduce((s, l) => s + l.price, 0);
        const pix = total - Math.floor((total * (parseFloat(CFG.pixPct) || 0)) / 100);
        return { coleira: coleira || 0, temColeira: coleira != null, pingente, junto, total, pix };
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
                if (cr && cr.obrigatorio && !SO_RACA) {
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
        if (S.passo === PASSOS.length - 1) return finalizar();
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
            // O botão diz o que vem a seguir (curto, para caber ao lado do preço).
            const PROXIMO = { [E.cores]: 'Escolher o metal', [E.metal]: 'Escolher o tamanho', [E.tamanho]: 'Escolher o pingente', [E.pingente]: 'Ver resumo' };
            rotulo.textContent = S.passo === PASSOS.length - 1
                ? 'Adicionar ao carrinho'
                : PROXIMO[S.passo] || 'Continuar';
        }
        btnContinuar.setAttribute('aria-label', S.passo < PASSOS.length - 1 ? `Continuar para ${PASSOS[S.passo + 1]}` : 'Adicionar ao carrinho');
        btnContinuar.classList.toggle('is-pronto', !problemaDoPasso(S.passo));
        atualizarBarra();
        if (S.passo === E.resumo) renderResumo();
        // Toda escolha passa por aqui: guardar aqui cobre cor, metal e tamanho
        // escolhidos sem avançar de etapa (a cliente sai e volta).
        salvar();
        avisarSelecao();
        mostrarPassadores();
    }

    // ═══════════════════════════ Compre Junto ═══════════════════════════
    // O widget da página padrão (snippets/pdp-bundle.liquid, no resumo, com
    // is_kit: true) casa a guia e o peitoral com a coleira pela seleção
    // {opção: valor} de window.AmeKit. No kit quem fornece é o ame-kit.js;
    // aqui é o ateliê (esta página não carrega o kit). A cada troca de
    // tamanho, cor ou metal o widget refaz o casamento pelo mesmo evento que
    // o kit dispara, `ame:kit-rendered`.
    function selecaoAtual() {
        const n = (M && M.nomes) || { tamanho: 'Tamanho', cor: 'Cor', metal: 'Cor do Metal' };
        const sel = {};
        if (S.tamanho) sel[n.tamanho] = S.tamanho;
        if (S.cor) sel[n.cor] = S.cor;
        if (S.metal) sel[n.metal] = S.metal;
        return sel;
    }
    if (!window.AmeKit) window.AmeKit = { getSelection: selecaoAtual };

    function avisarSelecao() {
        const chave = [S.tamanho, S.cor, S.metal].join('|');
        if (chave === avisarSelecao.ultima) return;
        avisarSelecao.ultima = chave;
        document.dispatchEvent(new CustomEvent('ame:kit-rendered'));
    }

    /** Itens marcados no Compre Junto: [{ title, variant, price }], preço em centavos. */
    function linhasJunto() {
        const api = window.AmePdpBundle;
        return api && typeof api.getSelectedLines === 'function' ? api.getSelectedLines() : [];
    }

    // Marcou, desmarcou ou a variante casada mudou: o total muda junto.
    document.addEventListener('ame:bundle-changed', () => {
        atualizarBarra();
        if (S.passo === E.resumo) renderResumo();
    });

    // ═══════════════════════════ carrinho ═══════════════════════════

    // Um botão só, o "Adicionar ao carrinho" da página padrão: a gaveta abre
    // e a cliente finaliza por lá. Ir direto ao checkout pulava o brinde por
    // faixa, que só entra no carrinho depois de uma avaliação assíncrona da
    // gaveta, e deixava o teste A/B com caminhos diferentes depois do clique.
    let finalizando = false;
    async function finalizar() {
        if (finalizando) return;
        const prob = primeiroProblemaAte(PASSOS.length - 1);
        if (prob) { irPara(prob.passo); mostrarProblema(prob.p); return; }
        const vc = varianteColeira();
        if (!vc) { avisar('Não encontramos essa combinação. Recarregue a página e tente de novo.'); return; }
        // Compre Junto: item marcado com campo obrigatório em branco (ex.:
        // comprimento da guia) barra o add, igual à página padrão.
        const bundle = window.AmePdpBundle;
        const bv = bundle && typeof bundle.validate === 'function' ? bundle.validate() : { ok: true };
        if (!bv.ok) {
            avisar(bv.msg);
            const cj = $('[data-pdp-bundle]');
            if (cj) cj.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        const vp = variantePingenteAtual();
        const alvo = btnContinuar;
        const textoOriginal = alvo.innerHTML;
        finalizando = true;
        alvo.disabled = true;
        alvo.setAttribute('aria-busy', 'true');
        alvo.innerHTML = '<span class="atl-giro" aria-hidden="true"></span><span>Adicionando…</span>';

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
        propsColeira._origem = ORIGEM;
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
            itens.push({ id: vp.id, quantity: 1, properties: { 'Personalização': linhas.join('\n'), _kit: chave, _origem: ORIGEM } });
        }

        // Guia e peitoral marcados no Compre Junto vão no MESMO POST, com a
        // marca `_origem = compre-junto` que o próprio widget põe (igual à PDP).
        const junto = bundle && typeof bundle.getSelectedItems === 'function' ? bundle.getSelectedItems() : [];
        if (junto.length) itens.push(...junto);

        const destravar = () => {
            alvo.innerHTML = textoOriginal;
            alvo.disabled = false;
            alvo.removeAttribute('aria-busy');
            finalizando = false;
            atualizarTudo();
        };
        try {
            await xhr('POST', '/cart/add.js', { items: itens });
            const carrinho = await xhr('GET', '/cart.js');
            if (window.AmeCart && typeof window.AmeCart.refresh === 'function') window.AmeCart.refresh(carrinho);
            publicar('adicionado', { total: totais().total / 100, pingente: !!vp, compre_junto: junto.length });
            alvo.innerHTML = '<span>Adicionado ✓</span>';
            if (window.AmeCart && typeof window.AmeCart.open === 'function') window.AmeCart.open();
            setTimeout(destravar, 1600);
        } catch (err) {
            console.error('[ateliê] carrinho', err, err && err.corpo);
            const desc = err && err.corpo && (err.corpo.description || err.corpo.message);
            avisar(desc ? `Não deu para adicionar: ${desc}` : 'Não deu para adicionar agora. Tente de novo.');
            destravar();
        }
    }

    // Volta pelo botão voltar (bfcache) depois de ir ao checkout pela gaveta:
    // a página volta como saiu, então destrava o botão.
    window.addEventListener('pageshow', (e) => {
        if (!e.persisted) return;
        finalizando = false;
        btnContinuar.disabled = false;
        btnContinuar.removeAttribute('aria-busy');
        btnContinuar.innerHTML = '<span data-atl-continuar-rotulo></span>';
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
        // A foto que o Liquid já pôs na tela é a primeira da lista original; as
        // bolinhas vão do tom mais claro ao mais escuro (luminosidade da cor-base)
        // e o carrossel começa nessa foto, onde ela cair na ordem nova.
        const fotoInicial = lista[0];
        const baseDe = (h) => String(h.cor).split(/\s+com\s+/i)[0];
        lista.sort((a, b) => luzDe(hexDe(baseDe(b))) - luzDe(hexDe(baseDe(a))));
        const iniDot = Math.max(0, lista.indexOf(fotoInicial));
        const imgs = [$('[data-atl-hero-img]'), $('[data-atl-hero-img-b]')].filter(Boolean);
        const nome = $('[data-atl-hero-nome]');
        const pontos = $('[data-atl-hero-dots]');
        const palcoHero = $('[data-atl-hero-stage]');
        const palavra = $('[data-atl-hero-word]');
        // Cada bolinha é um botão com área de toque de 36 px: escolher uma
        // mostra a cor e segura o carrossel por alguns segundos.
        if (pontos) pontos.innerHTML = lista.map((h, i) => `<button type="button" class="atl-hero__dot${i === iniDot ? ' is-ativo' : ''}" data-i="${i}" aria-pressed="${i === iniDot}" aria-label="${esc(h.cor)}, metal ${esc(h.metal)}" style="--cor:${hexDe(baseDe(h))}${miniDe(baseDe(h)) ? `;--img:url('${miniDe(baseDe(h))}')` : ''}"><span></span></button>`).join('');

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
        let i = iniDot, frente = 0, visivel = true, timer = 0, ocupado = false, pedido = null;
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
            const curva = { duration: dur, easing: 'cubic-bezier(.22,1,.36,1)' };
            const a = prox.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], curva);
            // A foto velha sai na mesma medida em que a nova entra. No
            // "multiply" as duas se misturavam na faixa já varrida, e a coleira
            // aparecia num tom que não existe (13/10/2026).
            const saida = atual.animate([{ clipPath: 'inset(0 0 0 0%)' }, { clipPath: 'inset(0 0 0 100%)' }], Object.assign({ fill: 'forwards' }, curva));
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
            saida.cancel();
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
                    storyMedir();
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
