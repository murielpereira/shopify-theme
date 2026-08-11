/**
 * ame-afiliado.js — captura da atribuição do Programa de Afiliados.
 *
 * O que faz, em uma linha: quem chega por `?ref=<codigo>` fica marcado por 15
 * dias, e essa marca viaja com o carrinho até virar `note_attributes` do pedido.
 *
 * Fluxo:
 *   1. lê ?ref= (ou ?utm_source=afiliado&utm_content=<codigo> como sinônimo)
 *   2. sem ref, mas com marca válida → só renova a validade e segue
 *   3. registra o clique no Waltz (fire-and-forget) e guarda o clique_id
 *   4. grava cookie + localStorage
 *   5. injeta { ame_ref, ame_clique } nos atributos do carrinho
 *
 * REGRA INEGOCIÁVEL: este script NUNCA pode quebrar a loja. Todo caminho está
 * em try/catch e qualquer falha — rede, storage bloqueado, módulo desligado —
 * resulta em "não faz nada". Ele também não bloqueia renderização: roda depois
 * do load e não tem dependência externa.
 *
 * Limitação conhecida e aceita (docs/afiliados/08-adrs.md#adr-010): o Safari,
 * sob ITP, corta cookie escrito por JavaScript em 7 dias. Por isso a marca é
 * espelhada em localStorage e REESCRITA a cada visita — quem volta ao site
 * mantém a atribuição viva. Quem clica no iPhone e só compra três semanas
 * depois, sem voltar, não é atribuído pelo link; para esse caso existe o cupom.
 *
 * Inclusão: layout/theme.liquid
 *   {{ 'ame-afiliado.js' | asset_url | script_tag }}
 */
(function () {
    'use strict';

    var API = 'https://waltz.up.railway.app';
    var COOKIE = 'ame_ref';
    var LS_MARCA = 'ame_ref_marca';
    var LS_VISITANTE = 'ame_visitante';
    var JANELA_PADRAO = 15;

    // ── Transporte: XHR, NUNCA fetch ─────────────────────────────────────────
    //
    // Regra da casa, aprendida na marra: apps de terceiro instalados nesta loja
    // (Microsoft Clarity, adsagent, Easify) **sobrescrevem `window.fetch`** e
    // engolem a requisição em silêncio. Está documentado em cinco arquivos do
    // tema — sections/product.liquid, ame-gifts.js, ame-page-lock.js,
    // ame-pdp-bundle.js e ame-konfidency-card-rating.js — e foi o que fazia o
    // drawer abrir com o carrinho vazio.
    //
    // Para este módulo o estrago seria pior e invisível: o POST do
    // /cart/update.js sumiria, o pedido chegaria sem `ame_ref`, e o parceiro
    // simplesmente não receberia a comissão de uma venda que ele trouxe — sem
    // erro em lugar nenhum, porque tudo aqui falha em silêncio por desenho.
    //
    // Helper copiado de assets/ame-gifts.js, que já roda em produção.
    function xhrJson(url, method, body) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open(method || 'GET', url, true);
            xhr.setRequestHeader('Accept', 'application/json');
            if (body) xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            xhr.timeout = 10000;
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { resolve(JSON.parse(xhr.responseText || '{}')); }
                    catch (e) { reject(e); }
                } else { reject(new Error('HTTP ' + xhr.status)); }
            };
            xhr.onerror = function () { reject(new Error('Network')); };
            xhr.ontimeout = function () { reject(new Error('Timeout')); };
            xhr.send(body ? JSON.stringify(body) : null);
        });
    }

    // ── Utilitários tolerantes a falha ───────────────────────────────────────

    function lerLS(chave) {
        try { return window.localStorage.getItem(chave); } catch (e) { return null; }
    }

    function gravarLS(chave, valor) {
        try { window.localStorage.setItem(chave, valor); } catch (e) { /* modo privado */ }
    }

    function lerCookie(nome) {
        try {
            var m = document.cookie.match('(^|;)\\s*' + nome + '\\s*=\\s*([^;]+)');
            return m ? decodeURIComponent(m[2]) : null;
        } catch (e) { return null; }
    }

    function gravarCookie(nome, valor, dias) {
        try {
            var exp = new Date(Date.now() + dias * 864e5).toUTCString();
            document.cookie = nome + '=' + encodeURIComponent(valor) +
                '; expires=' + exp + '; path=/; SameSite=Lax';
        } catch (e) { /* cookies bloqueados */ }
    }

    // Mesma normalização do servidor (services/afiliados-service.js): minúsculas
    // e só [a-z0-9_-]. Divergir aqui produziria clique registrado com um código
    // e pedido gravado com outro.
    function normalizar(v) {
        return String(v || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
    }

    function uuid() {
        try {
            if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
        } catch (e) { /* segue pro fallback */ }
        return 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    // ── Marca de atribuição ──────────────────────────────────────────────────
    // Formato: codigo|clique_id|timestamp — pequeno o bastante para caber no
    // cookie sem folclore de serialização.

    // Teto máximo que a marca pode viver no localStorage, independentemente da
    // janela configurada. O cookie expira sozinho; o localStorage não expira
    // NUNCA — sem isto, uma marca de um ano atrás continuaria voltando à vida
    // toda vez que o cookie sumisse.
    var TETO_DIAS = 60;

    function lerMarca() {
        var bruto = lerCookie(COOKIE) || lerLS(LS_MARCA);
        if (!bruto) return null;
        var p = String(bruto).split('|');
        var codigo = normalizar(p[0]);
        if (!codigo) return null;

        var ts = parseInt(p[2], 10) || 0;
        if (!ts || (Date.now() - ts) > TETO_DIAS * 864e5) {
            // Vencida de vez: apaga em vez de devolver, senão ela ressuscita a
            // cada leitura. A checagem fina continua sendo `dentroDaJanela`,
            // com a janela vinda do servidor.
            try { apagarMarca(); } catch (e) { }
            return null;
        }

        return {
            codigo: codigo,
            // Mesmo teto do servidor (services/afiliados-service.js): o valor
            // vem do cookie, que o cliente controla.
            clique: (function () {
                var n = parseInt(String(p[1] || '').replace(/\D/g, '').slice(0, 18), 10);
                return (n > 0 && n <= Number.MAX_SAFE_INTEGER) ? n : null;
            })(),
            ts: ts
        };
    }

    function apagarMarca() {
        gravarCookie(COOKIE, '', -1);
        try { window.localStorage.removeItem(LS_MARCA); } catch (e) { }
    }

    function gravarMarca(marca, janelaDias) {
        var valor = marca.codigo + '|' + (marca.clique || '') + '|' + marca.ts;
        gravarCookie(COOKIE, valor, janelaDias);
        gravarLS(LS_MARCA, valor);
    }

    function dentroDaJanela(marca, janelaDias) {
        if (!marca || !marca.ts) return false;
        return (Date.now() - marca.ts) < janelaDias * 864e5;
    }

    // ── Leitura da URL ───────────────────────────────────────────────────────

    function codigoDaUrl() {
        try {
            var q = new URLSearchParams(window.location.search);
            var ref = normalizar(q.get('ref'));
            if (ref) return ref;
            // Sinônimo: link antigo ou colado de outra ferramenta.
            if (String(q.get('utm_source') || '').toLowerCase() === 'afiliado') {
                return normalizar(q.get('utm_content'));
            }
        } catch (e) { /* URLSearchParams indisponível */ }
        return '';
    }

    function utmsDaUrl() {
        var out = {};
        try {
            var q = new URLSearchParams(window.location.search);
            ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
                var v = q.get(k);
                if (v) out[k] = String(v).slice(0, 100);
            });
        } catch (e) { /* ignora */ }
        return out;
    }

    // ── Waltz ────────────────────────────────────────────────────────────────

    function status() {
        return xhrJson(API + '/api/publico/afiliados/status')
            .catch(function () { return { ativo: false }; });
    }

    function registrarClique(codigo, visitante) {
        return xhrJson(API + '/api/publico/afiliados/clique', 'POST', {
            codigo: codigo,
            visitante_id: visitante,
            url: String(window.location.href).slice(0, 500),
            referrer: String(document.referrer || '').slice(0, 500),
            utm: utmsDaUrl()
        })
            .then(function (j) { return (j && j.clique_id) || null; })
            // Endpoint fora do ar não impede a atribuição: a marca é gravada
            // mesmo assim e o cupom continua funcionando. Perde-se só a métrica
            // de clique (UC-03, alternativo 3a).
            .catch(function () { return null; });
    }

    // ── Carrinho ─────────────────────────────────────────────────────────────
    // Os atributos do carrinho são a ÚNICA forma de levar um valor nosso até o
    // pedido. `landing_site` da Shopify é de sessão e não serve (ADR-008).
    //
    // Enviamos SÓ as nossas duas chaves: o /cart/update.js faz merge dos
    // atributos (o que não é enviado fica como está), então mandar o objeto
    // inteiro só criaria risco de sobrescrever algo gravado entre a leitura e a
    // escrita. Verificado em 10/08/2026: nenhum outro módulo do tema escreve
    // `attributes` — o ame-gifts.js usa line item properties. Se um dia outro
    // módulo passar a escrever aqui, esta premissa precisa ser reconferida.

    function sincronizarCarrinho(marca) {
        return xhrJson('/cart.js')
            .then(function (cart) {
                if (!cart) return;
                var attrs = cart.attributes || {};
                // Carrinho vazio não guarda atributo — e reescrever a cada página
                // seria requisição à toa.
                if (!cart.item_count) return;
                if (attrs.ame_ref === marca.codigo &&
                    String(attrs.ame_clique || '') === String(marca.clique || '')) return;

                return xhrJson('/cart/update.js', 'POST', {
                    attributes: {
                        ame_ref: marca.codigo,
                        ame_clique: marca.clique ? String(marca.clique) : ''
                    }
                });
            })
            .catch(function () { /* nunca atrapalha a compra */ });
    }

    // ── Orquestração ─────────────────────────────────────────────────────────

    // Janela vigente, guardada quando o /status responde. O listener do carrinho
    // precisa dela para não ressuscitar marca vencida (RN-10).
    var _janela = 0;

    function iniciar() {
        // Saída antecipada, ANTES de qualquer rede. A maioria esmagadora das
        // visitas não tem nada a ver com o programa: sem `?ref=` na URL e sem
        // marca guardada, não há o que capturar. Sem este atalho, toda pageview
        // da loja bateria no Waltz para ouvir "não faça nada".
        if (!codigoDaUrl() && !lerMarca()) return;

        status().then(function (cfg) {
            if (!cfg || !cfg.ativo) return;   // módulo desligado: não faz nada

            _janela = parseInt(cfg.janela_dias, 10) || JANELA_PADRAO;
            var daUrl = codigoDaUrl();
            var marca = lerMarca();

            if (!daUrl) {
                // Sem ref novo: renova a marca válida (é o que mantém a
                // atribuição viva no Safari) e sincroniza o carrinho.
                if (dentroDaJanela(marca, _janela)) {
                    gravarMarca(marca, _janela);
                    sincronizarCarrinho(marca);
                }
                return;
            }

            // Último clique vence (RN-11): ref novo sobrescreve o anterior.
            var visitante = lerLS(LS_VISITANTE);
            if (!visitante) { visitante = uuid(); gravarLS(LS_VISITANTE, visitante); }

            // A marca é gravada AGORA, sem esperar o registro do clique.
            // Se ela dependesse da resposta, quem chega pelo link e navega
            // rápido (ou tem rede ruim) ficaria sem atribuição nenhuma — a
            // venda existiria e o parceiro não receberia. O clique é métrica;
            // a marca é dinheiro. O `clique_id` entra depois, quando chegar.
            var nova = { codigo: daUrl, clique: null, ts: Date.now() };
            gravarMarca(nova, _janela);
            sincronizarCarrinho(nova);

            registrarClique(daUrl, visitante).then(function (cliqueId) {
                if (!cliqueId) return;
                // Só completa se a marca ainda for a mesma: outra aba pode ter
                // gravado um ref mais novo enquanto esta requisição voltava.
                var atual = lerMarca();
                if (!atual || atual.codigo !== nova.codigo) return;
                var completa = { codigo: nova.codigo, clique: cliqueId, ts: nova.ts };
                gravarMarca(completa, _janela);
                sincronizarCarrinho(completa);
            });
        }).catch(function () { /* nada acontece */ });
    }

    try {
        // Depois do load: a captura não disputa recurso com a renderização.
        if (document.readyState === 'complete') iniciar();
        else window.addEventListener('load', iniciar, { once: true });

        // O carrinho muda sem recarregar a página (drawer, ajax add). O tema
        // anuncia `ame:cart-refreshed` justamente para módulos externos — é o
        // mesmo gancho que o ame-gifts.js usa. Limitado a uma vez por segundo
        // porque o drawer dispara em sequência (qty +/-, remover).
        // Debounce de cauda (600 ms), não throttle de borda.
        //
        // Dois motivos. (1) O `ame-gifts.js` reage ao mesmo evento e também
        // mexe no carrinho — escrever no mesmo tick são duas mutações
        // simultâneas no mesmo cart da Shopify, e uma pode sobrescrever a
        // outra. (2) O throttle anterior descartava o ÚLTIMO evento de uma
        // rajada, que é justamente o que carrega o estado final do carrinho.
        var timer = null;
        document.addEventListener('ame:cart-refreshed', function () {
            clearTimeout(timer);
            timer = setTimeout(function () {
                // `_janela` só é preenchida depois de o /status confirmar que o
                // módulo está ligado. Sem essa checagem, o listener reinjetaria
                // marca VENCIDA (ou com o módulo desligado) no carrinho,
                // atribuindo venda fora da janela — o que a RN-10 proíbe.
                if (!_janela) return;
                var m = lerMarca();
                if (m && dentroDaJanela(m, _janela)) sincronizarCarrinho(m);
            }, 600);
        });
    } catch (e) { /* nunca quebra a loja */ }
})();
