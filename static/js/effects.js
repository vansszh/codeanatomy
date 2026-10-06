/* ==========================================================================
   effects.js : cursor light for .fx cards, scroll reveal, PBL team dialog
   Standalone module with no imports. Pairs with css/effects.css.
   ========================================================================== */

const root = document.documentElement;
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/* --------------------------------------------------------------------------
   Cursor light: only the card under the pointer is updated, so the effect
   stays local and quiet. Delegated, so report cards added later work too.
   -------------------------------------------------------------------------- */

function initCursorLight() {
    if (!FINE_POINTER) return;

    let card = null;
    let x = 0;
    let y = 0;
    let raf = 0;

    const paint = () => {
        raf = 0;
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty('--fx-mx', `${(x - r.left).toFixed(1)}px`);
        card.style.setProperty('--fx-my', `${(y - r.top).toFixed(1)}px`);
    };

    document.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        card = e.target instanceof Element ? e.target.closest('.fx') : null;
        if (!card) return;
        x = e.clientX;
        y = e.clientY;
        if (!raf) raf = requestAnimationFrame(paint);
    }, { passive: true });
}

/* --------------------------------------------------------------------------
   Scroll reveal. The page adds .fx-js early (inline in <head>) so nothing
   flashes. Siblings are staggered by 70ms unless data-reveal-delay is set.
   -------------------------------------------------------------------------- */

function initReveal() {
    if (!root.classList.contains('fx-js')) return;
    const nodes = document.querySelectorAll('.fx-reveal');
    if (REDUCED || !nodes.length || !('IntersectionObserver' in window)) {
        root.classList.remove('fx-js');
        return;
    }
    root.classList.add('fx-ready');

    const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const node = entry.target;
            io.unobserve(node);

            let delay = Number(node.dataset.revealDelay);
            if (!Number.isFinite(delay)) {
                const peers = Array.from(node.parentElement?.children || []).filter((n) => n.classList.contains('fx-reveal'));
                delay = Math.max(0, peers.indexOf(node)) * 70;
            }

            node.style.transitionDelay = `${delay}ms`;
            node.classList.add('is-in');
            // Drop the delay afterwards so hover feedback is immediate.
            setTimeout(() => { node.style.transitionDelay = ''; }, delay + 1000);
        });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });

    nodes.forEach((n) => io.observe(n));
}

/* --------------------------------------------------------------------------
   PBL team dialog (landing page)
   -------------------------------------------------------------------------- */

function initTeamDialog() {
    const dialog = document.querySelector('[data-team]');
    if (!dialog) return;
    const closeBtn = dialog.querySelector('[data-team-close]');
    let lastFocus = null;
    let hideTimer = 0;

    const open = () => {
        clearTimeout(hideTimer);
        lastFocus = document.activeElement;
        dialog.hidden = false;
        document.body.classList.add('team-open');
        requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add('on')));
        closeBtn?.focus({ preventScroll: true });
    };

    const close = () => {
        if (dialog.hidden) return;
        dialog.classList.remove('on');
        document.body.classList.remove('team-open');
        hideTimer = setTimeout(() => { dialog.hidden = true; }, REDUCED ? 0 : 260);
        if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
    };

    document.querySelectorAll('[data-team-open]').forEach((btn) => btn.addEventListener('click', open));
    closeBtn?.addEventListener('click', close);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
    document.addEventListener('keydown', (e) => {
        if (dialog.hidden) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        } else if (e.key === 'Tab') {
            // The close button is the only control, so focus stays on it.
            e.preventDefault();
            closeBtn?.focus();
        }
    });
}

initCursorLight();
initReveal();
initTeamDialog();
