/* Stories/spotlight de vídeo (snippets/video-stories.liquid).
   Era script inline repetido a cada render do snippet (a home renderiza 2x,
   ~23 KB cada). Agora é arquivo com defer: o navegador baixa uma vez e
   executa uma vez por tag. Continua idempotente — o 2º run não redefine
   window.AmeVideoStories e pula templates já marcados com data-vs-claimed. */

(() => {
  // escapeHTML fica FORA do `if (!window.AmeVideoStories)` porque
  // `initSpotlight` (definida abaixo, fora do if) usa essa função. Se o
  // snippet renderizar mais de uma vez na página, o if é falso na 2ª
  // execução e escapeHTML ficaria undefined no novo escopo do IIFE,
  // quebrando o spotlight com "escapeHTML is not a function".
  function escapeHTML(str) {
    return String(str ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }[c])
    );
  }

  if (!window.AmeVideoStories) {
    const STORY_DURATION = 30000;

    const state = {
      videos: [],
      idx: 0,
      progressFrame: null,
      progressStart: 0,
    };

    function ensureModal() {
      let modal = document.getElementById('ame-vs-modal');
      if (modal) return modal;
      modal = document.createElement('div');
      modal.id = 'ame-vs-modal';
      modal.className = 'ame-vs-modal';
      modal.hidden = true;
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', 'Reprodutor de vídeo');
      modal.innerHTML = `
        <div class="ame-vs-modal__box">
          <div class="ame-vs-modal__header">
            <div class="ame-vs-modal__bars" data-vs-modal-bars></div>
            <div class="ame-vs-modal__top-row">
              <button type="button" class="ame-vs-modal__close" data-vs-modal-close aria-label="Fechar" title="Fechar">
                <span class="material-symbols-outlined" aria-hidden="true">close</span>
              </button>
            </div>
          </div>
          <div class="ame-vs-modal__player" data-vs-modal-player></div>
          <button type="button" class="ame-vs-modal__zone ame-vs-modal__zone--prev" data-vs-modal-prev aria-label="Anterior" title="Anterior"></button>
          <button type="button" class="ame-vs-modal__zone ame-vs-modal__zone--next" data-vs-modal-next aria-label="Próximo" title="Próximo"></button>
          <div class="ame-vs-modal__cta" data-vs-modal-cta>
            <p class="ame-vs-modal__cta-title" data-vs-modal-cta-title></p>
            <a class="ame-vs-modal__cta-btn" data-vs-modal-cta-link>
              <span data-vs-modal-cta-label></span>
              <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
            </a>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.closest('[data-vs-modal-close]')) closeModal();
      });
      modal.querySelector('[data-vs-modal-prev]').addEventListener('click', (e) => {
        e.stopPropagation();
        navigate(-1);
      });
      modal.querySelector('[data-vs-modal-next]').addEventListener('click', (e) => {
        e.stopPropagation();
        navigate(1);
      });
      document.addEventListener('keydown', (e) => {
        if (!modal.classList.contains('is-open')) return;
        if (e.key === 'Escape') closeModal();
        else if (e.key === 'ArrowLeft') navigate(-1);
        else if (e.key === 'ArrowRight') navigate(1);
      });
      return modal;
    }

    function buildPlayer(data) {
      // Apenas vídeo nativo do Shopify. Suporte YouTube/Vimeo foi removido
      // por performance — players externos baixam ~600KB de JS.
      if (data.type === 'native' && data.src) {
        return `<video src="${escapeHTML(data.src)}" autoplay controls playsinline></video>`;
      }
      return '<p style="color:#fff;text-align:center;padding:2rem;">Vídeo indisponível.</p>';
    }

    function buildBars(modal) {
      const bars = modal.querySelector('[data-vs-modal-bars]');
      bars.innerHTML = '';
      if (state.videos.length <= 1) return;
      for (let i = 0; i < state.videos.length; i++) {
        const bar = document.createElement('div');
        bar.className = 'ame-vs-modal__bar';
        const fill = document.createElement('div');
        fill.className = 'ame-vs-modal__bar-fill';
        fill.dataset.vsBarFill = String(i);
        bar.appendChild(fill);
        bars.appendChild(bar);
      }
    }

    function startProgress(modal) {
      cancelAnimationFrame(state.progressFrame);
      const fills = modal.querySelectorAll('[data-vs-bar-fill]');
      fills.forEach((fill, i) => {
        fill.style.transition = 'none';
        fill.style.width = i < state.idx ? '100%' : '0%';
      });

      const fill = modal.querySelector(`[data-vs-bar-fill="${state.idx}"]`);
      const videoEl = modal.querySelector('[data-vs-modal-player] video');

      // Vídeo nativo: barra acompanha currentTime/duration real
      if (videoEl) {
        const updateFromVideo = () => {
          const dur = videoEl.duration;
          if (!dur || !isFinite(dur)) return;
          const pct = Math.min((videoEl.currentTime / dur) * 100, 100);
          if (fill) {
            fill.style.transition = 'none';
            fill.style.width = pct + '%';
          }
        };
        videoEl.addEventListener('timeupdate', updateFromVideo);
        videoEl.addEventListener('ended', () => navigate(1), { once: true });
        // Garante reset visual mesmo se metadata ainda não carregou
        updateFromVideo();
        return;
      }

      // Fallback (iframes YouTube/Vimeo, ou enquanto não há vídeo): timer fixo
      state.progressStart = Date.now();
      function tick() {
        const elapsed = Date.now() - state.progressStart;
        const pct = Math.min((elapsed / STORY_DURATION) * 100, 100);
        if (fill) {
          fill.style.transition = 'none';
          fill.style.width = pct + '%';
        }
        if (pct >= 100) {
          navigate(1);
        } else {
          state.progressFrame = requestAnimationFrame(tick);
        }
      }
      tick();
    }

    function loadCurrent() {
      const modal = ensureModal();
      const data = state.videos[state.idx];
      if (!data) return closeModal();

      const player = modal.querySelector('[data-vs-modal-player]');
      const cta = modal.querySelector('[data-vs-modal-cta]');
      const ctaLink = modal.querySelector('[data-vs-modal-cta-link]');
      const ctaLabel = modal.querySelector('[data-vs-modal-cta-label]');
      const ctaTitle = modal.querySelector('[data-vs-modal-cta-title]');

      player.innerHTML = buildPlayer(data);

      if (data.ctaUrl) {
        ctaLink.href = data.ctaUrl;
        ctaLabel.textContent = data.ctaLabel || 'Ver mais';
        ctaTitle.textContent = data.title || '';
        ctaTitle.style.display = data.title ? '' : 'none';
        cta.classList.add('is-visible');
      } else {
        cta.classList.remove('is-visible');
      }

      startProgress(modal);
    }

    function navigate(delta) {
      cancelAnimationFrame(state.progressFrame);
      const next = state.idx + delta;
      if (next < 0 || next >= state.videos.length) {
        closeModal();
        return;
      }
      state.idx = next;
      loadCurrent();
    }

    function openModal(videos, startIdx) {
      const list = Array.isArray(videos) ? videos : [videos];
      state.videos = list;
      state.idx = Math.max(0, Math.min(startIdx || 0, list.length - 1));
      const modal = ensureModal();
      buildBars(modal);
      loadCurrent();
      modal.hidden = false;
      requestAnimationFrame(() => modal.classList.add('is-open'));
      document.body.style.overflow = 'hidden';
    }

    function closeModal() {
      const modal = document.getElementById('ame-vs-modal');
      if (!modal) return;
      cancelAnimationFrame(state.progressFrame);
      const player = modal.querySelector('[data-vs-modal-player]');
      modal.classList.remove('is-open');
      document.body.style.overflow = '';
      setTimeout(() => {
        if (player) player.innerHTML = '';
        modal.hidden = true;
      }, 250);
    }

    // No-op (compatibilidade com chamadas legadas). Cliques são tratados
    // pelo delegate global abaixo.
    function bindOpenLinks(_root) { /* no-op */ }

    window.AmeVideoStories = { open: openModal, close: closeModal, navigate, bindOpenLinks };

    function openFromButton(btn) {
      const widget = btn.closest('[data-vs-widget]');
      const all = widget
        ? Array.from(widget.querySelectorAll('[data-vs-open]'))
        : [btn];
      const videos = all.map(b => ({
        type: b.dataset.vsType,
        id: b.dataset.vsId,
        host: b.dataset.vsHost,
        src: b.dataset.vsSrc,
        title: b.dataset.vsTitle,
        ctaUrl: b.dataset.vsCtaUrl,
        ctaLabel: b.dataset.vsCtaLabel,
      }));
      const idx = all.indexOf(btn);
      openModal(videos, idx >= 0 ? idx : 0);
    }

    /* Listener simples de click — o browser nativo já cancela o click
       sintético quando o usuário rola a página (não precisamos detectar
       scroll manualmente). Antes tinha um detector de swipe que
       comparava touchstart vs touchmove com threshold de 10px, mas isso
       disparava em qualquer tap com tremor mínimo no dedo, impedindo a
       abertura do modal mesmo em taps legítimos. */
    function handleOpenClick(e) {
      const btn = e.target.closest('[data-vs-open]');
      if (!btn) return;
      e.preventDefault();
      openFromButton(btn);
    }
    document.addEventListener('click', handleOpenClick);
  }

  /* ── Hidrata templates: copia conteúdo para o slot apropriado ── */
  /* `hydrate` chama enableHorizontalDrag/initSpotlight, declaradas mais
     abaixo neste mesmo IIFE — function declarations sofrem hoisting, e o
     callback do IntersectionObserver roda depois do script inteiro ser
     avaliado, então ambas já estão resolvidas de qualquer forma. */
  function hydrate(tpl, widget) {
    const cardsHTML = tpl.innerHTML;
    tpl.remove();

    if (widget.dataset.vsSpotlight !== undefined) {
      const track = widget.querySelector('[data-vs-spot-track]');
      if (track) track.innerHTML = cardsHTML;
      initSpotlight(widget);
    } else {
      const track = widget.querySelector('[data-vs-track]');
      if (track) {
        track.innerHTML = cardsHTML;
        enableHorizontalDrag(track);
      }
      window.AmeVideoStories.bindOpenLinks(widget);
    }
  }

  /* PSI 03/09: hidratar tudo na hora (o script roda junto do
     DOMContentLoaded) injetava TODOS os posters com prioridade High dentro
     da janela do LCP — na home eram 10 posters / 609 KiB competindo por
     banda, com 1.282 ms de "resource load delay" no LCP. Agora cada widget
     só hidrata quando chega perto da viewport. rootMargin de 400px carrega
     com folga antes de aparecer, então o usuário nunca vê o slot vazio.
     Widget já visível no primeiro frame dispara imediatamente — esperado. */
  document.querySelectorAll('[data-vs-template-for]').forEach(tpl => {
    /* A home renderiza o snippet DUAS vezes (stories + spotlight), então
       cada cópia deste script varre TODOS os templates já parseados da
       página. (Não escreva a tag de script literal num comentário aqui: o
       parser Liquid-HTML do theme-check conta como abertura aninhada e
       aborta o arquivo inteiro com LiquidHTMLSyntaxError.) Antes
       a hidratação era síncrona e o tpl.remove() sumia com o template antes
       do 2º script rodar; agora o template fica no DOM até entrar na
       viewport, então sem esta marca o 2º script registraria um segundo
       observer no MESMO widget e hydrate rodaria duas vezes (wheel listener
       e autoplay do spotlight duplicados). */
    if (tpl.dataset.vsClaimed === '1') return;
    tpl.dataset.vsClaimed = '1';

    const widgetId = tpl.dataset.vsTemplateFor;
    const widget = document.querySelector(`[data-vs-widget="${widgetId}"]`);
    if (!widget) return;

    // Browser sem IntersectionObserver: hidrata na hora (comportamento antigo).
    if (typeof IntersectionObserver !== 'function') {
      hydrate(tpl, widget);
      return;
    }

    const io = new IntersectionObserver((entries, obs) => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      obs.disconnect(); // desobserva: hidrata uma única vez
      hydrate(tpl, widget);
    }, { rootMargin: '400px 0px' });
    io.observe(widget);
  });

  /* Versão anterior tinha mouse-drag custom + handler de click em CAPTURE
     PHASE que cancelava clicks com `moved > 5`. Isso interceptava clicks
     legítimos antes do delegate global (preventDefault+stopPropagation),
     fazendo os stories não abrirem em desktop. Mobile não usava o drag
     (touch usa scroll nativo), mas tinha sintomas paralelos.

     Agora só mantemos wheel-vertical → scroll-horizontal pra usuários de
     mouse desktop conseguirem navegar pelo carrossel. Touch e touchpad
     já fazem scroll horizontal nativo via overflow-x:auto. Drag por mouse
     (clicar e arrastar) virou só scroll por wheel — mais previsível e
     não interfere com clicks. */
  function enableHorizontalDrag(track) {
    track.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && e.deltaY !== 0) {
        e.preventDefault();
        track.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }

  /* ──────────────────────────────────────── */
  /* Spotlight — card central destacado, loop infinito + autoplay.
     Loop é implementado clonando o último card no início e o primeiro
     no fim. Quando a navegação chega num clone, o JS faz um salto
     invisível (sem transition) pro original equivalente.
  /* ──────────────────────────────────────── */
  function initSpotlight(widget) {
    const outer = widget.querySelector('[data-vs-spot-outer]');
    const track = widget.querySelector('[data-vs-spot-track]');
    const prevBtn = widget.querySelector('[data-vs-spot-prev]');
    const nextBtn = widget.querySelector('[data-vs-spot-next]');
    if (!outer || !track) return;

    const originals = Array.from(track.querySelectorAll('[data-vs-spot-card]'));
    const origLen = originals.length;
    if (origLen === 0) return;

    // Loop infinito: precisa de ≥3 originais (com 1-2 fica ridículo).
    const enableLoop = origLen >= 3;
    const AUTOPLAY_INTERVAL = 5000;

    if (origLen <= 1) {
      if (prevBtn) prevBtn.style.display = 'none';
      if (nextBtn) nextBtn.style.display = 'none';
    }

    // Monta a esteira: [...N-clones-esquerda, ...originais, ...N-clones-direita]
    // quando loop ON. Sem clones suficientes à esquerda, no primeiro paint o
    // card ativo (primeiro original) ficava colado no clone-último — todo o
    // espaço à esquerda da viewport ficava vazio até o autoplay avançar.
    // N = min(3, origLen) cobre ~3 cards à esquerda, suficiente pra layouts
    // desktop sem precisar de mais clones.
    const LOOP_CLONES = Math.min(3, origLen);
    let displayCards = originals;
    if (enableLoop) {
      const makeClone = (orig) => {
        const c = orig.cloneNode(true);
        c.setAttribute('data-vs-clone', '1');
        return c;
      };
      // Esquerda: últimos N originais (preserva continuidade do loop)
      const leftClones = originals.slice(-LOOP_CLONES).map(makeClone);
      // Direita: primeiros N originais
      const rightClones = originals.slice(0, LOOP_CLONES).map(makeClone);
      leftClones.forEach(c => track.insertBefore(c, originals[0]));
      rightClones.forEach(c => track.appendChild(c));
      displayCards = [...leftClones, ...originals, ...rightClones];
    }

    // activeIdx é o índice em displayCards. Começa no primeiro ORIGINAL
    // (índice LOOP_CLONES quando loop ON, 0 quando OFF).
    let activeIdx = enableLoop ? LOOP_CLONES : 0;

    function loadVideoIntoCard(card) {
      const vid = card.querySelector('[data-vs-spot-vid]');
      if (!vid || vid.innerHTML) return;
      const type = card.dataset.vsType;
      const src = card.dataset.vsSrc;
      // Apenas vídeo nativo. Sem fallback YouTube/Vimeo (performance).
      if (src) {
        vid.innerHTML = `<video src="${escapeHTML(src)}" autoplay muted loop playsinline></video>`;
      }
      card.classList.add('is-vid-loaded');
    }

    function unloadVideoInCard(card) {
      const vid = card.querySelector('[data-vs-spot-vid]');
      if (vid) vid.innerHTML = '';
      card.classList.remove('is-vid-loaded');
    }

    function centerActive(animated) {
      const card = displayCards[activeIdx];
      if (!card) return;
      const outerW = outer.offsetWidth;
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const tx = Math.round(outerW / 2 - cardCenter);

      if (!animated) {
        track.classList.add('is-no-transition');
        track.style.transform = `translateX(${tx}px)`;
        void track.offsetHeight; // força reflow pra browser aplicar antes
        track.classList.remove('is-no-transition');
      } else {
        track.style.transform = `translateX(${tx}px)`;
      }

      displayCards.forEach((c, i) => {
        c.classList.toggle('is-spot-active', i === activeIdx);
        if (i !== activeIdx) unloadVideoInCard(c);
      });
      loadVideoIntoCard(card);

      // Setas só ficam disabled quando loop está OFF.
      if (!enableLoop) {
        if (prevBtn) prevBtn.disabled = activeIdx === 0;
        if (nextBtn) nextBtn.disabled = activeIdx === displayCards.length - 1;
      }
    }

    // Controle de transição via transitionend (com fallback timer).
    // Sem isso, qualquer reflow durante a animação (ex: URL bar do mobile
    // escondendo) pode disparar o ResizeObserver, chamar centerActive(false)
    // e deixar a animação "perdida" — o que travava a próxima seta.
    let transitionTimer = null;
    let isTransitioning = false;
    function finishTransition() {
      if (!isTransitioning) return;
      isTransitioning = false;
      clearTimeout(transitionTimer);
      transitionTimer = null;
      if (!enableLoop) return;
      // Saiu pelos clones da esquerda → salto invisível pro original equivalente.
      // Os N clones esquerdos refletem os N últimos originais — somando origLen
      // ao activeIdx aterrissa no original de mesma imagem.
      if (activeIdx < LOOP_CLONES) {
        activeIdx += origLen;
        centerActive(false);
      } else if (activeIdx >= LOOP_CLONES + origLen) {
        // Saiu pelos clones da direita → subtrai origLen pra voltar ao original.
        activeIdx -= origLen;
        centerActive(false);
      }
    }
    track.addEventListener('transitionend', (e) => {
      if (e.propertyName !== 'transform') return;
      if (e.target !== track) return;
      finishTransition();
    });

    function goTo(idx, animated = true) {
      // Se ainda estamos em transição, finaliza ela ANTES e dispara a nova.
      // (Em vez de bloquear silenciosamente — que era o bug "trava após 1 clique".)
      if (isTransitioning) finishTransition();
      activeIdx = idx;

      if (!animated) {
        centerActive(false);
        return;
      }

      isTransitioning = true;
      centerActive(true);

      // Fallback: se transitionend não disparar (ex: transição cancelada
      // por reflow), libera o flag depois de 600ms pra próxima seta funcionar.
      clearTimeout(transitionTimer);
      transitionTimer = setTimeout(finishTransition, 600);
    }

    // Autoplay: avança 1 card a cada AUTOPLAY_INTERVAL. Pausa em hover
    // e em interação manual (clique nas setas, swipe).
    let autoplayTimer = null;
    function startAutoplay() {
      if (origLen <= 1) return;
      clearInterval(autoplayTimer);
      autoplayTimer = setInterval(() => goTo(activeIdx + 1, true), AUTOPLAY_INTERVAL);
    }
    function stopAutoplay() {
      clearInterval(autoplayTimer);
    }
    function resetAutoplay() {
      stopAutoplay();
      startAutoplay();
    }
    outer.addEventListener('mouseenter', stopAutoplay);
    outer.addEventListener('mouseleave', startAutoplay);

    prevBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      goTo(activeIdx - 1);
      resetAutoplay();
    });
    nextBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      goTo(activeIdx + 1);
      resetAutoplay();
    });

    // Clique num card lateral o traz pro centro.
    displayCards.forEach((card, i) => {
      card.addEventListener('click', (e) => {
        if (i === activeIdx) return;
        e.preventDefault();
        e.stopPropagation();
        goTo(i);
        resetAutoplay();
      }, true);
    });

    // Swipe touch
    let touchStartX = 0;
    outer.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      stopAutoplay();
    }, { passive: true });
    outer.addEventListener('touchend', (e) => {
      const diff = touchStartX - e.changedTouches[0].clientX;
      if (Math.abs(diff) >= 50) goTo(activeIdx + (diff > 0 ? 1 : -1));
      startAutoplay();
    }, { passive: true });

    let resizeRaf = null;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => centerActive(false));
    });

    window.AmeVideoStories.bindOpenLinks(widget);

    // Init — espera o outer ter largura real antes do primeiro centerActive.
    // Durante transição animada, ignoramos resizes (URL bar do mobile, reflow
    // do card cresce/encolhe) — senão centerActive(false) cancela a animação
    // e o flag isTransitioning trava a próxima seta.
    let initialized = false;
    let lastOuterW = 0;
    let roTimer = null;
    const ro = new ResizeObserver(() => {
      const w = outer.offsetWidth;
      if (w === 0) return;
      if (!initialized) {
        initialized = true;
        lastOuterW = w;
        centerActive(false);
        // Revela o track após o primeiro translateX correto (evita o
        // "salto" do primeiro paint com translateX(0)). CSS faz fade
        // suave via opacity transition.
        track.classList.add('is-initialized');
        startAutoplay();
        return;
      }
      // Mudança apenas de altura (card ativo cresce/encolhe) não exige
      // recentralizar — o cálculo é só horizontal.
      if (w === lastOuterW) return;
      lastOuterW = w;
      // Debounce: vários resizes em sequência (mobile scroll) viram um só.
      clearTimeout(roTimer);
      roTimer = setTimeout(() => {
        if (isTransitioning) return; // não interrompe animação em curso
        centerActive(false);
      }, 150);
    });
    ro.observe(outer);
  }
})();
