/* Âme — Trava de página por senha (produto / coleção).
 *
 * Lê as regras no Waltz (/api/public/paginas-bloqueadas) e, se a página atual
 * (produto ou coleção) estiver bloqueada, mostra uma tela de senha por cima do
 * conteúdo. Ao acertar, libera e lembra num cookie por 7 dias.
 *
 * TRAVA LEVE (client-side): segura o público casual, mas não é blindagem — o
 * conteúdo ainda existe na página. A senha NÃO trafega em texto: o Waltz manda
 * só o hash SHA-256 e a checagem é local (crypto.subtle). Config no Waltz →
 * aba "Páginas com senha". Usa XHR porque o Clarity sobrescreve window.fetch.
 */
(function () {
    'use strict';
    if (window.__amePageLockLoaded) return;
    window.__amePageLockLoaded = true;

    var WALTZ_BASE = 'https://waltz.up.railway.app';
    var COOKIE_DIAS = 7;

    // Tipo + handle da página atual, pela URL (ignora prefixo de idioma e ?variant=).
    function paginaAtual() {
        var path = location.pathname;
        var mp = path.match(/\/products\/([^/?#]+)/i);
        if (mp) return { tipo: 'produto', handle: decodeURIComponent(mp[1]).toLowerCase() };
        var mc = path.match(/\/collections\/([^/?#]+)/i);
        if (mc && mc[1].toLowerCase() !== 'all') return { tipo: 'colecao', handle: decodeURIComponent(mc[1]).toLowerCase() };
        return null;
    }

    function xhrJson(url) {
        return new Promise(function (resolve, reject) {
            var x = new XMLHttpRequest();
            x.open('GET', url, true);
            x.setRequestHeader('Accept', 'application/json');
            x.timeout = 8000;
            x.onload = function () {
                if (x.status >= 200 && x.status < 300) { try { resolve(JSON.parse(x.responseText || '{}')); } catch (e) { reject(e); } }
                else reject(new Error('HTTP ' + x.status));
            };
            x.onerror = function () { reject(new Error('net')); };
            x.ontimeout = function () { reject(new Error('timeout')); };
            x.send();
        });
    }

    async function sha256hex(s) {
        var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function cookieNome(p) { return 'ame_unlock_' + p.tipo + '_' + p.handle.replace(/[^a-z0-9]+/gi, '_'); }
    function jaLiberado(p) {
        var nome = cookieNome(p) + '=1';
        return document.cookie.split(';').some(function (c) { return c.trim().indexOf(nome) === 0; });
    }
    function liberar(p) {
        var d = new Date(); d.setTime(d.getTime() + COOKIE_DIAS * 864e5);
        document.cookie = cookieNome(p) + '=1; expires=' + d.toUTCString() + '; path=/; SameSite=Lax';
    }

    function montarOverlay(regra, p) {
        var titulo = regra.titulo || 'Conteúdo exclusivo';
        document.documentElement.style.overflow = 'hidden';
        var ov = document.createElement('div');
        ov.id = 'ame-page-lock';
        ov.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:#f4efe9;display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,\'Segoe UI\',Arial,sans-serif;');
        ov.innerHTML =
            '<div style="max-width:380px;width:100%;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.15);padding:28px 24px;text-align:center;">' +
            '<div style="font-size:34px;line-height:1;margin-bottom:10px;">🔒</div>' +
            '<h2 style="font-size:19px;margin:0 0 6px;color:#3f3a33;">' + escapeHtml(titulo) + '</h2>' +
            '<p style="font-size:14px;color:#7a736a;margin:0 0 18px;">Digite a senha de acesso para ver esta página.</p>' +
            '<input id="ame-lock-input" type="password" inputmode="text" autocomplete="off" placeholder="Senha" style="width:100%;padding:12px 14px;border:1px solid #e2ddd5;border-radius:10px;font-size:15px;margin-bottom:10px;box-sizing:border-box;">' +
            '<button id="ame-lock-btn" type="button" style="width:100%;padding:12px;border:none;border-radius:10px;background:#5a7461;color:#fff;font-size:15px;font-weight:600;cursor:pointer;">Entrar</button>' +
            '<p id="ame-lock-erro" style="font-size:13px;color:#c0392b;margin:10px 0 0;min-height:16px;"></p>' +
            '</div>';
        document.body.appendChild(ov);

        var input = ov.querySelector('#ame-lock-input');
        var btn = ov.querySelector('#ame-lock-btn');
        var erro = ov.querySelector('#ame-lock-erro');
        setTimeout(function () { try { input.focus(); } catch (e) { } }, 50);

        async function tentar() {
            var val = input.value || '';
            if (!val) return;
            btn.disabled = true; erro.textContent = '';
            try {
                var h = await sha256hex(val);
                if (h === regra.senha_hash) {
                    liberar(p);
                    document.documentElement.style.overflow = '';
                    ov.remove();
                } else {
                    erro.textContent = 'Senha incorreta.';
                    btn.disabled = false; input.value = ''; input.focus();
                }
            } catch (e) {
                erro.textContent = 'Erro ao verificar. Tente de novo.';
                btn.disabled = false;
            }
        }
        btn.addEventListener('click', tentar);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); tentar(); } });
    }

    async function init() {
        var p = paginaAtual();
        if (!p || jaLiberado(p)) return;
        var data;
        try { data = await xhrJson(WALTZ_BASE + '/api/public/paginas-bloqueadas'); }
        catch (e) { return; } // Waltz fora do ar → não trava (não bloqueia a loja por engano)
        var regra = (data.paginas || []).find(function (r) {
            return r.tipo === p.tipo && String(r.handle).toLowerCase() === p.handle;
        });
        if (!regra || !regra.senha_hash) return;
        if (jaLiberado(p)) return;
        montarOverlay(regra, p);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
