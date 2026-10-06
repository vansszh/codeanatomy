/* ==========================================================================
   motion.js : primitives shared by every route.

   Nothing here is decorative for its own sake. The rules the whole site
   follows:
     - reveals are transform + opacity only, never layout properties;
     - hover states are small color and arrow movements;
     - a single element never receives two competing tweens on one property,
       because anime v4 cancels the earlier one at creation time;
     - everything is gated on IntersectionObserver and document visibility.
   ========================================================================== */

import {
    animate,
    createTimeline,
    createDrawable,
    spring,
    stagger,
    utils,
} from 'https://cdn.jsdelivr.net/npm/animejs@4.5.0/+esm';

export { animate, createTimeline, createDrawable, spring, stagger, utils };

export const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* --------------------------------------------------------------------------
   Text splitting
   -------------------------------------------------------------------------- */

/**
 * Wrap each character in its own span. Spaces stay bare text nodes so word
 * breaking is unaffected, and the original text is cached on the element so a
 * second call is idempotent.
 */
export function splitChars(el, { hide = true } = {}) {
    if (!el) return [];
    if (!el.dataset.srcText) el.dataset.srcText = el.textContent;

    const source = el.dataset.srcText;
    const frag = document.createDocumentFragment();
    const out = [];

    for (const ch of source) {
        if (ch === ' ') {
            frag.appendChild(document.createTextNode(' '));
            continue;
        }
        const span = document.createElement('span');
        span.className = 'ch';
        span.textContent = ch;
        span.style.display = 'inline-block';
        span.style.willChange = 'transform, opacity';
        if (hide) span.style.opacity = '0';
        frag.appendChild(span);
        out.push(span);
    }

    el.textContent = '';
    el.appendChild(frag);
    return out;
}

/**
 * Wrap each word so lines can rise independently. Keeps inline markup out of
 * scope on purpose: it only walks direct text.
 */
export function splitWords(el) {
    if (!el) return [];
    const words = [];

    const walk = (node) => {
        const kids = Array.from(node.childNodes);
        for (const child of kids) {
            if (child.nodeType === Node.TEXT_NODE) {
                const parts = child.textContent.split(/(\s+)/);
                const frag = document.createDocumentFragment();
                for (const part of parts) {
                    if (!part) continue;
                    if (/^\s+$/.test(part)) {
                        frag.appendChild(document.createTextNode(part));
                        continue;
                    }
                    const span = document.createElement('span');
                    span.className = 'w';
                    span.textContent = part;
                    frag.appendChild(span);
                    words.push(span);
                }
                child.replaceWith(frag);
            } else if (child.nodeType === Node.ELEMENT_NODE && !child.classList.contains('w')) {
                walk(child);
            }
        }
    };

    walk(el);
    return words;
}

/* --------------------------------------------------------------------------
   Scramble
   -------------------------------------------------------------------------- */

const NOISE = '@#$%&*+=<>/\\|{}[]()!?~^';
const DIGITS = '0123456789';

/**
 * Resolve text left to right out of noise. Only non-whitespace is ever
 * substituted, so monospace code blocks keep their exact indentation and the
 * layout cannot reflow mid-animation.
 */
export function scrambleIn(el, { duration = 900, delay = 0, alphabet = NOISE } = {}) {
    if (!el) return;
    if (!el.dataset.srcText) el.dataset.srcText = el.textContent;

    const target = el.dataset.srcText;
    const chars = Array.from(target);
    const pick = () => alphabet[Math.floor(Math.random() * alphabet.length)];

    if (REDUCED) {
        el.textContent = target;
        return;
    }

    const state = { p: 0 };
    animate(state, {
        p: 1,
        duration,
        delay,
        ease: 'outQuad',
        onUpdate: () => {
            const cut = state.p * chars.length;
            let out = '';
            for (let i = 0; i < chars.length; i++) {
                const ch = chars[i];
                if (i < cut || /\s/.test(ch)) out += ch;
                else out += pick();
            }
            el.textContent = out;
        },
        onComplete: () => {
            el.textContent = target;
        },
    });
}

/**
 * Count a numeric label up from zero. utils.round(0) is curried in v4, so it
 * is passed straight through as the modifier.
 */
export function countUp(el, { duration = 1500, delay = 0 } = {}) {
    if (!el) return;
    const to = parseFloat(el.dataset.count ?? el.textContent) || 0;
    if (REDUCED) {
        el.textContent = String(to);
        return;
    }
    const state = { v: 0 };
    animate(state, {
        v: to,
        duration,
        delay,
        ease: 'outExpo',
        modifier: utils.round(0),
        onUpdate: () => {
            el.textContent = String(state.v);
        },
    });
}

/* --------------------------------------------------------------------------
   Viewport
   -------------------------------------------------------------------------- */

/** Fire once, the first time an element crosses into view. */
export function onEnter(el, fn, opts = {}) {
    if (!el) return;
    const io = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                io.disconnect();
                fn(entry.target);
            }
        },
        { threshold: 0, rootMargin: '0px 0px -14% 0px', ...opts }
    );
    io.observe(el);
}

/** Toggle a callback as an element enters and leaves, for looping visuals. */
export function onVisible(el, onIn, onOut, opts = {}) {
    if (!el) return;
    const io = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) onIn(entry.target);
                else onOut(entry.target);
            }
        },
        { threshold: 0, ...opts }
    );
    io.observe(el);
}

/** Reset drawables to hidden so they can be drawn on demand. */
export function arm(drawables) {
    utils.set(drawables, { draw: '0 0' });
}

/* --------------------------------------------------------------------------
   Hover: shuttling chevron
   -------------------------------------------------------------------------- */

/** Clone the chevron so one can exit right while its twin enters from left. */
export function buildArrow(host) {
    const box = host.querySelector('.btn-arrow');
    if (!box || box.dataset.built) return null;
    const svg = box.querySelector('svg');
    if (!svg) return null;

    box.dataset.built = '1';
    const clone = svg.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    box.appendChild(clone);
    return [svg, clone];
}

export function playArrow(pair, enter) {
    if (!pair) return;
    const [lead, follow] = pair;
    animate(lead, {
        x: enter ? 15 : 0,
        duration: enter ? 460 : 380,
        ease: 'outExpo',
    });
    animate(follow, {
        x: enter ? 15 : 0,
        duration: enter ? 460 : 380,
        ease: 'outExpo',
    });
}

/* --------------------------------------------------------------------------
   Hover wiring
   -------------------------------------------------------------------------- */

/**
 * Drive the arrow inside each host.
 * Keyboard focus fires the same motion as the pointer, so the affordance is
 * not pointer-only.
 */
export function wireHovers(root = document) {
    const hosts = root.querySelectorAll('[data-hover]');

    hosts.forEach((host) => {
        const arrow = buildArrow(host);

        const run = (enter) => {
            playArrow(arrow, enter);
        };

        host.addEventListener('pointerenter', () => run(true));
        host.addEventListener('pointerleave', () => run(false));
        host.addEventListener('focus', () => run(true));
        host.addEventListener('blur', () => run(false));
    });
}

/**
 * Very short pointer-follow offset. Capped at single-digit pixels and spring
 * settled: enough to feel responsive, far short of a floating element.
 */
export function wireMagnets(root = document) {
    if (REDUCED) return;
    const settle = spring({ stiffness: 92, damping: 16 });

    root.querySelectorAll('[data-magnet]').forEach((el) => {
        const reach = parseFloat(el.dataset.magnet) || 8;
        const inner = el.querySelector('[data-magnet-in]');

        el.addEventListener('pointermove', (e) => {
            const r = el.getBoundingClientRect();
            const dx = ((e.clientX - r.left) / r.width - 0.5) * 2;
            const dy = ((e.clientY - r.top) / r.height - 0.5) * 2;
            animate(el, { x: dx * reach, y: dy * reach, duration: 420, ease: 'outQuad' });
            if (inner) {
                animate(inner, {
                    x: dx * reach * 0.5,
                    y: dy * reach * 0.5,
                    duration: 420,
                    ease: 'outQuad',
                });
            }
        });

        el.addEventListener('pointerleave', () => {
            animate(el, { x: 0, y: 0, ease: settle.ease, duration: 560 });
            if (inner) animate(inner, { x: 0, y: 0, ease: settle.ease, duration: 560 });
        });
    });
}

/* --------------------------------------------------------------------------
   Chrome and scroll state
   -------------------------------------------------------------------------- */

export function wireScrollState({ chrome, rail } = {}) {
    let raf = 0;

    const read = () => {
        raf = 0;
        const y = window.scrollY || 0;

        if (chrome) chrome.classList.toggle('stuck', y > 24);

        if (rail) {
            const max = document.documentElement.scrollHeight - window.innerHeight;
            const p = max > 0 ? Math.min(1, y / max) : 0;
            rail.style.transform = `scaleX(${p})`;
        }
    };

    const onScrollEvent = () => {
        if (!raf) raf = requestAnimationFrame(read);
    };

    window.addEventListener('scroll', onScrollEvent, { passive: true });
    window.addEventListener('resize', onScrollEvent, { passive: true });
    read();
}

/* --------------------------------------------------------------------------
   Navigation
   -------------------------------------------------------------------------- */

export function scrollToId(id) {
    const target = document.querySelector(id);
    if (!target) return;
    const top = target.getBoundingClientRect().top + window.scrollY - 40;
    window.scrollTo({ top, behavior: REDUCED ? 'auto' : 'smooth' });
}

/**
 * Curtain wipe out, then navigate. A hard timeout always calls through, so a
 * dropped animation frame can never trap the user on a covered page.
 */
export function leave(href, curtain) {
    if (REDUCED || !curtain) {
        window.location.href = href;
        return;
    }

    const panels = curtain.querySelectorAll('i');
    utils.set(panels, { y: '101%' });

    let done = false;
    const go = () => {
        if (done) return;
        done = true;
        window.location.href = href;
    };

    animate(panels, {
        y: '0%',
        duration: 520,
        delay: stagger(42),
        ease: 'inOutQuint',
        onComplete: go,
    });

    setTimeout(go, 900);
}

export function wireNavigation(curtain) {
    document.querySelectorAll('[data-goto]').forEach((el) => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            leave(el.dataset.goto, curtain);
        });
    });

    document.querySelectorAll('[data-scroll]').forEach((el) => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            scrollToId(el.dataset.scroll);
        });
    });
}

/** Release the pre-paint hide even if boot never completes. */
export function releaseMotionGate() {
    clearTimeout(window.__caBail);
    document.documentElement.classList.remove('js-motion');
}
