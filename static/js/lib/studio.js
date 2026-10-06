/* ==========================================================================
   studio.js : the run loop for complexity analysis.

   State swapping, copy, the busy indicator, and the request lifecycle live here
   so the workspace stays focused on rendering the report.
   ========================================================================== */

import {
    animate,
    stagger,
    utils,
    REDUCED,
    scrambleIn,
    wireHovers,
    wireMagnets,
    wireScrollState,
    wireNavigation,
    releaseMotionGate,
} from './motion.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* --------------------------------------------------------------------------
   Copy and download
   -------------------------------------------------------------------------- */

const TICK = '<svg viewBox="0 0 15 15" fill="none"><path d="M3 8l3.2 3.2L12 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function wireCopy(btn, getText) {
    if (!btn) return;
    const original = btn.innerHTML;
    let resetTimer = 0;

    btn.addEventListener('click', async () => {
        const text = getText();
        if (!text) return;

        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // Clipboard is unavailable over plain HTTP and in some embedded
            // webviews. A hidden textarea plus execCommand still works there.
            const pad = document.createElement('textarea');
            pad.value = text;
            pad.style.position = 'fixed';
            pad.style.opacity = '0';
            document.body.appendChild(pad);
            pad.select();
            try {
                document.execCommand('copy');
            } finally {
                pad.remove();
            }
        }

        btn.innerHTML = TICK;
        btn.classList.add('done');
        btn.setAttribute('aria-label', 'Copied');

        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
            btn.innerHTML = original;
            btn.classList.remove('done');
            btn.setAttribute('aria-label', 'Copy');
        }, 1600);
    });
}

export function wireDownload(btn, getText, getName) {
    if (!btn) return;
    btn.addEventListener('click', () => {
        const text = getText();
        if (!text) return;

        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = getName();
        a.click();
        // Revoking immediately can cancel the download in Safari; one frame
        // of delay is enough for the navigation to be picked up.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
}

/* --------------------------------------------------------------------------
   Busy indicator

   Cycles a status word so a long request reads as progress rather than a
   hang. The words describe what the request is actually doing.
   -------------------------------------------------------------------------- */

export function createBusy(wordEl, words) {
    let timer = 0;
    let index = 0;

    return {
        start() {
            if (!wordEl || !words.length) return;
            index = 0;
            wordEl.textContent = words[0];
            clearInterval(timer);
            timer = setInterval(() => {
                index = (index + 1) % words.length;
                wordEl.dataset.srcText = words[index];
                if (REDUCED) wordEl.textContent = words[index];
                else scrambleIn(wordEl, { duration: 460 });
            }, 2400);
        },
        stop() {
            clearInterval(timer);
            timer = 0;
        },
    };
}

/* --------------------------------------------------------------------------
/* --------------------------------------------------------------------------
   Run loop
   -------------------------------------------------------------------------- */

/**
 * Wire one pane pair to one endpoint.
 *
 * @param {object} opts
 * @param {string} opts.endpoint      POST target
 * @param {HTMLElement} opts.input    textarea
 * @param {HTMLElement} opts.runBtn   primary action
 * @param {object} opts.states        { empty, working, error } pane-state nodes
 * @param {Function} opts.render      (payload) => void, paints the result pane
 * @param {Function} [opts.onLanguage] (lang) => void
 * @param {string[]} [opts.words]     busy words
 */
export function createRunner(opts) {
    const {
        endpoint,
        input,
        runBtn,
        states = {},
        render,
        onLanguage,
        words = ['Reading', 'Tracing', 'Reasoning', 'Writing'],
        result,
    } = opts;

    const busy = createBusy($('.working-word', states.working || document), words);
    let inflight = null;

    const show = (which) => {
        Object.entries(states).forEach(([name, node]) => {
            if (node) node.hidden = name !== which;
        });
        if (result) result.hidden = which !== null;
    };

    const setError = (message) => {
        const node = states.error;
        if (node) {
            const p = $('p', node);
            if (p) p.textContent = message;
        }
        show('error');
    };

    const run = async () => {
        const code = (input?.value || '').trim();
        if (!code) {
            input?.focus();
            setError('Paste some code first.');
            return;
        }

        // A second click while a request is open aborts the first rather than
        // racing it, so the pane always reflects the newest input.
        if (inflight) inflight.abort();
        const controller = new AbortController();
        inflight = controller;

        show('working');
        busy.start();
        if (runBtn) runBtn.disabled = true;

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, language: 'python' }),
                signal: controller.signal,
            });

            const payload = await res.json().catch(() => null);

            if (!res.ok || !payload?.ok) {
                setError(payload?.error || `Request failed (${res.status}).`);
                return;
            }

            if (payload.language && onLanguage) onLanguage(payload.language);
            show(null);
            render(payload);
        } catch (err) {
            if (err.name === 'AbortError') return;
            setError('Could not reach the server. Check your connection and try again.');
        } finally {
            busy.stop();
            if (inflight === controller) inflight = null;
            if (runBtn) runBtn.disabled = false;
        }
    };

    runBtn?.addEventListener('click', run);

    // Ctrl/Cmd + Enter runs from inside the textarea.
    input?.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            run();
        }
    });

    // Tab inserts four spaces rather than leaving the field, which is what a
    // code surface should do.
    input?.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab' || e.shiftKey) return;
        e.preventDefault();
        const { selectionStart: s, selectionEnd: end, value } = input;
        input.value = `${value.slice(0, s)}    ${value.slice(end)}`;
        input.selectionStart = input.selectionEnd = s + 4;
    });

    show('empty');
    return { run, show, setError };
}

/* --------------------------------------------------------------------------
   Reveal and boot
   -------------------------------------------------------------------------- */

export function revealStudio() {
    releaseMotionGate();
    const curtain = $('.curtain');
    if (curtain) curtain.style.display = 'none';

    if (REDUCED) {
        utils.set(['.workspace-head', '.code-space', '.workspace-actions', '.chrome'], { opacity: 1, y: 0 });
        return;
    }

    animate('.chrome', { opacity: [0, 1], y: [-12, 0], duration: 680, ease: 'outExpo' });
    animate(['.workspace-head', '.code-space', '.workspace-actions'], {
        opacity: [0, 1],
        y: [18, 0],
        duration: 900,
        delay: stagger(110),
        ease: 'outExpo',
    });
}

export function bootStudio() {
    wireScrollState({ chrome: $('.chrome'), rail: $('.rail-fill') });
    wireNavigation($('.curtain'));
    wireHovers();
    wireMagnets();
    revealStudio();
}
