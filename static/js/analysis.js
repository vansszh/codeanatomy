/* ==========================================================================
   analysis.js : editor, loader, and the complexity report

   - Syntax highlighting: a transparent textarea sits over a highlighted <pre>;
     both share font metrics and scroll together.
   - Scroll model: the page is locked until a report exists. Once the report
     opens, the lock is released and the report flows below the editor at
     full length (no inner scrollbar).
   - The report is model output, so every string is written with textContent.
   ========================================================================== */

import { $, $$, wireCopy, bootStudio } from './lib/studio.js';
import { animate, stagger, utils, REDUCED } from './lib/motion.js';

const LINE_H = 24;   // must match --code-lh
const PAD_TOP = 20;  // must match --code-pad-y

const studio = $('[data-studio]');
const input = $('[data-input]');
const layer = $('[data-layer]');
const highlight = $('[data-highlight]');
const gutter = $('[data-gutter]');
const lineMark = $('[data-line-mark]');
const lineCurrent = $('[data-line-current]');
const cursorEl = $('[data-cursor]');
const lineCount = $('[data-line-count]');
const hintEl = $('[data-hint]');
const codeSpace = $('[data-space]');
const reportSection = $('[data-report-section]');
const reportBox = $('[data-report]');
const reportError = $('[data-report-error]');
const errorMsg = $('[data-error-msg]');
const reportMeta = $('[data-report-meta]');
const staleChip = $('[data-stale]');
const runBtn = $('[data-run]');

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
$$('[data-mod]').forEach((n) => { n.textContent = IS_MAC ? '\u2318' : 'Ctrl'; });

let lastReport = null;
let lastRunSource = null;

/* --------------------------------------------------------------------------
   Python tokenizer
   -------------------------------------------------------------------------- */

const KEYWORDS = new Set(
    'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case'.split(' ')
);
const CONSTANTS = new Set(['True', 'False', 'None', 'Ellipsis', 'NotImplemented', '__debug__']);
const BUILTINS = new Set(
    ('abs all any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len list locals map max memoryview min next object oct open ord pow print property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip __import__ ' +
     'Exception BaseException ValueError TypeError KeyError IndexError StopIteration RuntimeError AttributeError NotImplementedError ZeroDivisionError OSError').split(' ')
);

// 1 comment | 2 string | 3 decorator | 4 number | 5 identifier | 6 operator | 7 punctuation
const TOKEN = /(#[^\n]*)|((?:\b[rRbBuUfF]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?))|(@[A-Za-z_][\w.]*)|(\b0[xXoObB][\da-fA-F_]+\b|\b\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?[jJ]?|\.\d[\d_]*(?:[eE][+-]?\d+)?)|([A-Za-z_]\w*)|(->|[+\-*/%=<>!&|^~:@]+)|([()[\]{},.;])/g;

function nextChar(src, i) {
    while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i++;
    return src[i];
}

function onlySpaceBefore(src, index) {
    const start = src.lastIndexOf('\n', index - 1) + 1;
    return /^[ \t]*$/.test(src.slice(start, index));
}

function tokenize(src) {
    const out = [];
    let last = 0;
    let prevWord = '';
    let prevSig = '';
    let depth = 0;
    let m;

    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(src)) !== null) {
        const text = m[0];
        if (!text) { TOKEN.lastIndex++; continue; }
        if (m.index > last) out.push([null, src.slice(last, m.index)]);

        let cls = null;
        let word = '';

        if (m[1]) {
            cls = 'tok-comment';
        } else if (m[2]) {
            const body = text.replace(/^[a-zA-Z]+/, '');
            if ((body.startsWith('"""') || body.startsWith("'''")) && onlySpaceBefore(src, m.index)) cls = 'tok-doc';
            else cls = /^[a-zA-Z]*[fF]/.test(text) ? 'tok-fstring' : 'tok-string';
        } else if (m[3]) {
            if (onlySpaceBefore(src, m.index)) {
                cls = 'tok-decorator';
            } else {
                // Matrix-multiply operator, not a decorator.
                out.push(['tok-op', '@']);
                last = TOKEN.lastIndex = m.index + 1;
                prevSig = '@';
                prevWord = '';
                continue;
            }
        } else if (m[4]) {
            cls = 'tok-number';
        } else if (m[5]) {
            word = text;
            const callNext = nextChar(src, TOKEN.lastIndex) === '(';
            if (KEYWORDS.has(word)) cls = 'tok-keyword';
            else if (CONSTANTS.has(word)) cls = 'tok-const';
            else if (word === 'self' || word === 'cls') cls = 'tok-self';
            else if (prevWord === 'def') cls = 'tok-fn-def';
            else if (prevWord === 'class') cls = 'tok-class-def';
            else if (prevSig === '.') cls = callNext ? 'tok-method' : 'tok-attr';
            else if (BUILTINS.has(word)) cls = 'tok-builtin';
            else if (callNext) cls = 'tok-call';
            else if (word.length > 1 && /^[A-Z][A-Z0-9_]+$/.test(word)) cls = 'tok-const-name';
            else if (/^[A-Z]/.test(word)) cls = 'tok-type';
        } else if (m[6]) {
            cls = 'tok-op';
        } else if (m[7]) {
            if ('([{'.includes(text)) { cls = `tok-br-${depth % 3}`; depth++; }
            else if (')]}'.includes(text)) { depth = Math.max(0, depth - 1); cls = `tok-br-${depth % 3}`; }
            else cls = 'tok-punct';
        }

        out.push([cls, text]);
        prevWord = word;
        prevSig = text;
        last = TOKEN.lastIndex;
    }

    if (last < src.length) out.push([null, src.slice(last)]);
    return out;
}

/* --------------------------------------------------------------------------
   Editor rendering
   -------------------------------------------------------------------------- */

function paintCode() {
    const src = input.value;
    const frag = document.createDocumentFragment();
    for (const [cls, text] of tokenize(src)) {
        if (!cls) {
            frag.append(text);
        } else {
            const span = document.createElement('span');
            span.className = cls;
            span.textContent = text;
            frag.append(span);
        }
    }
    // Keep a trailing empty line measurable.
    if (!src || src.endsWith('\n')) frag.append(' ');
    highlight.replaceChildren(frag);
}

let gutterCount = 0;
let activeLine = 0;

function syncGutter() {
    const count = Math.max(1, input.value.split('\n').length);
    if (count !== gutterCount) {
        const frag = document.createDocumentFragment();
        for (let i = 1; i <= count; i++) {
            const row = document.createElement('div');
            row.textContent = i;
            frag.append(row);
        }
        gutter.replaceChildren(frag);
        gutterCount = count;
        activeLine = 0;
    }
    if (lineCount) lineCount.textContent = `${count} line${count === 1 ? '' : 's'}`;
    syncActiveLine();
}

function syncActiveLine() {
    const before = input.value.slice(0, input.selectionStart);
    const line = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    if (cursorEl) cursorEl.textContent = `Ln ${line}, Col ${col}`;
    if (line === activeLine) return;
    gutter.children[activeLine - 1]?.classList.remove('on');
    gutter.children[line - 1]?.classList.add('on');
    if (lineCurrent) lineCurrent.style.top = `${PAD_TOP + (line - 1) * LINE_H}px`;
    activeLine = line;
}

function syncScroll() {
    const { scrollTop: t, scrollLeft: l } = input;
    layer.style.transform = `translate(${-l}px, ${-t}px)`;
    gutter.style.transform = `translateY(${-t}px)`;
}

function markStale() {
    if (lastRunSource === null || reportSection.hidden) return;
    const stale = input.value !== lastRunSource;
    staleChip.hidden = !stale;
    reportSection.classList.toggle('is-stale', stale);
}

function refreshNow() {
    paintCode();
    syncGutter();
    syncScroll();
    markStale();
}

let frame = 0;
function refresh() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(refreshNow);
}

input.addEventListener('input', refresh);
input.addEventListener('scroll', syncScroll, { passive: true });
['keyup', 'click', 'select', 'focus'].forEach((ev) => input.addEventListener(ev, syncActiveLine));
window.addEventListener('resize', syncScroll);

function insertText(text) {
    input.focus();
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
    if (!ok) {
        input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
        refresh();
    }
}

input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        run();
        return;
    }
    if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        insertText('    ');
        return;
    }
    // Enter keeps the current indentation, plus one level after a colon.
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing) {
        const s = input.selectionStart;
        const v = input.value;
        const line = v.slice(v.lastIndexOf('\n', s - 1) + 1, s);
        let indent = (line.match(/^[ \t]*/) || [''])[0];
        if (/:\s*(#.*)?$/.test(line)) indent += '    ';
        e.preventDefault();
        insertText(`\n${indent}`);
    }
});

let hintTimer = 0;
function flashHint(text) {
    if (!hintEl) return;
    hintEl.textContent = text;
    hintEl.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hintEl.hidden = true; }, 2800);
}

function chromeHeight() {
    return $('.chrome')?.offsetHeight || 0;
}

let markTimer = 0;
function jumpToLine(n) {
    const lines = input.value.split('\n');
    if (n < 1 || n > lines.length) return;
    let pos = 0;
    for (let i = 0; i < n - 1; i++) pos += lines[i].length + 1;

    // Bring the editor back into view if the page has scrolled down to the report.
    const r = codeSpace.getBoundingClientRect();
    if (r.top < chromeHeight() || r.top > window.innerHeight * 0.5) {
        window.scrollTo({
            top: Math.max(0, r.top + window.scrollY - chromeHeight() - 16),
            behavior: REDUCED ? 'auto' : 'smooth',
        });
    }

    input.focus({ preventScroll: true });
    input.setSelectionRange(pos, pos + lines[n - 1].length);
    input.scrollTop = Math.max(0, (n - 1) * LINE_H - input.clientHeight / 3);
    syncScroll();
    syncActiveLine();

    lineMark.style.top = `${PAD_TOP + (n - 1) * LINE_H}px`;
    lineMark.classList.remove('on');
    void lineMark.offsetWidth;
    lineMark.classList.add('on');
    clearTimeout(markTimer);
    markTimer = setTimeout(() => lineMark.classList.remove('on'), 1800);
}

/* --------------------------------------------------------------------------
   Full-screen loader

   The API returns one response, so stage progress is time-based: it eases
   toward 94% while waiting and completes to 100% when the report arrives.
   Each finished step shows how long it took.
   -------------------------------------------------------------------------- */

function createLoader() {
    const root = $('[data-loader]');
    const pctEl = $('[data-loader-pct]');
    const track = $('[data-loader-track]');
    const bar = $('[data-loader-bar]');
    const stageEl = $('[data-loader-stage]');
    const timeEl = $('[data-loader-time]');
    const linesEl = $('[data-loader-lines]');
    const steps = $$('[data-step]');
    const labels = steps.map((li) => $('.step-label', li).textContent.trim());
    const stepTimes = steps.map((li) => $('[data-step-time]', li));
    const thresholds = [0, 16, 38, 62, 84];

    let raf = 0;
    let start = 0;
    let value = 0;
    let hideTimer = 0;
    let doneAt = [];
    let lastStage = '';

    const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;

    function render(p) {
        value = p;
        const pct = Math.round(p);
        const now = performance.now();
        pctEl.textContent = `${pct}%`;
        bar.style.transform = `scaleX(${p / 100})`;
        track.setAttribute('aria-valuenow', String(pct));

        let idx = 0;
        thresholds.forEach((t, i) => { if (p >= t) idx = i; });
        const done = p >= 100;

        steps.forEach((li, i) => {
            const isDone = done || i < idx;
            if (isDone && doneAt[i] == null) {
                doneAt[i] = now;
                const from = i === 0 ? start : (doneAt[i - 1] ?? start);
                stepTimes[i].textContent = fmt(now - from);
            }
            li.classList.toggle('done', isDone);
            li.classList.toggle('now', !done && i === idx);
        });

        const stage = done ? 'Finalizing report' : `${labels[idx]}\u2026`;
        if (stage !== lastStage) {
            stageEl.textContent = stage;
            lastStage = stage;
        }
        timeEl.textContent = fmt(now - start);
    }

    function tick() {
        const t = (performance.now() - start) / 1000;
        render(94 * (1 - Math.exp(-t / 7)));
        raf = requestAnimationFrame(tick);
    }

    function open(lines) {
        clearTimeout(hideTimer);
        cancelAnimationFrame(raf);
        start = performance.now();
        doneAt = [];
        lastStage = '';
        stepTimes.forEach((n) => { n.textContent = ''; });
        linesEl.textContent = `${lines} line${lines === 1 ? '' : 's'}`;
        root.hidden = false;
        document.body.classList.add('is-busy');
        requestAnimationFrame(() => root.classList.add('on'));
        render(0);
        tick();
    }

    function close() {
        cancelAnimationFrame(raf);
        root.classList.remove('on');
        document.body.classList.remove('is-busy');
        hideTimer = setTimeout(() => { root.hidden = true; }, REDUCED ? 0 : 280);
    }

    function finish() {
        cancelAnimationFrame(raf);
        const from = value;
        const duration = REDUCED ? 0 : 420;
        const t0 = performance.now();
        return new Promise((resolve) => {
            const step = () => {
                const k = duration ? Math.min(1, (performance.now() - t0) / duration) : 1;
                render(from + (100 - from) * (1 - Math.pow(1 - k, 3)));
                if (k < 1) requestAnimationFrame(step);
                else setTimeout(() => { close(); resolve(); }, REDUCED ? 0 : 260);
            };
            step();
        });
    }

    return { open, close, finish };
}

const loader = createLoader();

/* --------------------------------------------------------------------------
   Report builders
   -------------------------------------------------------------------------- */

const KINDS = new Set(['loop', 'recursion', 'allocation', 'call']);
const JUMP_ICON = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13V3M3.8 7.2 8 3l4.2 4.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function block(title, desc, count) {
    const wrap = el('section', 'report-block');
    const head = el('header', 'block-head');
    const t = el('div', 'block-title');
    t.append(el('h3', null, title));
    if (count != null) t.append(el('span', 'count', String(count)));
    head.append(t);
    if (desc) head.append(el('p', 'block-desc', desc));
    wrap.append(head);
    return wrap;
}

function stat(label, value, tone) {
    const node = el('div', 'stat');
    node.dataset.tone = tone;
    node.append(el('span', 'stat-label', label), el('span', 'stat-value', value || 'Unknown'));
    return node;
}

function boundRow(label, entry, tone) {
    const row = el('div', 'bound-row');
    row.dataset.tone = tone;
    const c = el('div', 'bound-case');
    c.append(el('i'), el('span', null, label));
    row.append(
        c,
        el('code', 'bound-value', entry?.bound || 'Unknown'),
        el('p', 'bound-reason', entry?.reason || 'No reasoning given.')
    );
    return row;
}

function lineFrom(text) {
    if (!text) return 0;
    const s = String(text);
    const m = s.match(/(?:\blines?\s*|\bL)(\d+)/i) || s.match(/\b(\d+)\b/);
    const n = m ? parseInt(m[1], 10) : 0;
    return n >= 1 && n <= gutterCount ? n : 0;
}

function driverRow(driver) {
    const row = el('article', 'driver fx fx-lift');
    const kind = String(driver?.kind || 'other').toLowerCase();
    row.dataset.kind = KINDS.has(kind) ? kind : 'other';

    const main = el('div', 'driver-main');
    const top = el('div', 'driver-top');
    top.append(el('span', 'driver-kind', kind));
    if (driver?.where) top.append(el('span', 'driver-where', driver.where));
    main.append(top);
    if (driver?.note) main.append(el('p', 'driver-note', driver.note));

    const side = el('div', 'driver-side');
    side.append(el('code', 'driver-cost', driver?.cost || '\u2014'));

    const line = lineFrom(driver?.where);
    if (line) {
        const jump = el('button', 'line-jump');
        jump.type = 'button';
        jump.innerHTML = JUMP_ICON;
        jump.append(el('span', null, `Go to line ${line}`));
        jump.addEventListener('click', () => jumpToLine(line));
        side.append(jump);
    }

    row.append(main, side);
    return row;
}

function paint(report) {
    reportBox.textContent = '';
    const time = report.time || {};

    // Overview
    const overview = el('section', 'overview fx');
    const copy = el('div', 'overview-copy');
    copy.append(el('span', 'label', 'Summary'), el('p', 'overview-summary', report.summary || 'No summary was returned.'));
    const stats = el('div', 'overview-stats');
    stats.append(stat('Worst-case time', time.worst?.bound, 'worst'), stat('Space', report.space?.bound, 'space'));
    overview.append(copy, stats);
    reportBox.append(overview);

    // Bounds table
    const boundsSec = block('Time and space bounds', 'How the cost changes across inputs');
    const bounds = el('div', 'bounds fx');
    const headRow = el('div', 'bound-row bound-head');
    headRow.append(el('span', null, 'Case'), el('span', null, 'Bound'), el('span', null, 'Reasoning'));
    bounds.append(
        headRow,
        boundRow('Best case', time.best, 'best'),
        boundRow('Average case', time.average, 'average'),
        boundRow('Worst case', time.worst, 'worst'),
        boundRow('Space', report.space, 'space')
    );
    boundsSec.append(bounds);
    reportBox.append(boundsSec);

    // Drivers
    const drivers = Array.isArray(report.drivers) ? report.drivers : [];
    if (drivers.length) {
        const sec = block('What drives the cost', 'Click a line to highlight it in the editor', drivers.length);
        const list = el('div', 'drivers');
        drivers.forEach((d) => list.append(driverRow(d)));
        sec.append(list);
        reportBox.append(sec);
    }

    // Notes
    const notes = Array.isArray(report.notes) ? report.notes.filter(Boolean) : [];
    if (notes.length) {
        const sec = block('Notes and assumptions', null, notes.length);
        const list = el('ol', 'notes fx');
        notes.forEach((n, i) => {
            const li = el('li');
            li.append(el('span', 'note-index', String(i + 1).padStart(2, '0')), el('p', null, String(n)));
            list.append(li);
        });
        sec.append(list);
        reportBox.append(sec);
    }

    reportBox.hidden = false;
    if (REDUCED) return;

    const blocks = Array.from(reportBox.children);
    utils.set(blocks, { opacity: 0 });
    animate(blocks, { opacity: 1, y: [14, 0], duration: 640, delay: stagger(80, { start: 120 }), ease: 'outExpo' });
}

/** Flatten the report to plain text for the copy button. */
function asText(report) {
    if (!report) return '';
    const time = report.time || {};
    const lines = ['COMPLEXITY REPORT', ''];
    if (report.summary) lines.push(report.summary, '');

    const push = (label, entry) => {
        if (!entry) return;
        lines.push(`${label}: ${entry.bound || 'unknown'}`);
        if (entry.reason) lines.push(`  ${entry.reason}`);
    };
    push('Time, best', time.best);
    push('Time, average', time.average);
    push('Time, worst', time.worst);
    push('Space', report.space);

    const drivers = Array.isArray(report.drivers) ? report.drivers : [];
    if (drivers.length) {
        lines.push('', 'Cost drivers:');
        drivers.forEach((d) => {
            lines.push(`  [${d.kind || 'other'}] ${d.where || ''} -> ${d.cost || ''}`);
            if (d.note) lines.push(`    ${d.note}`);
        });
    }

    const notes = Array.isArray(report.notes) ? report.notes.filter(Boolean) : [];
    if (notes.length) {
        lines.push('', 'Notes:');
        notes.forEach((n) => lines.push(`  - ${n}`));
    }
    return lines.join('\n');
}

/* --------------------------------------------------------------------------
   Layout state
   -------------------------------------------------------------------------- */

function setReportMode(on) {
    studio.classList.toggle('has-report', on);
    document.body.classList.toggle('page-lock', !on);
    reportSection.hidden = !on;
    if (on) {
        staleChip.hidden = true;
        reportSection.classList.remove('is-stale');
    }
    requestAnimationFrame(syncScroll);
}

function scrollToReport() {
    requestAnimationFrame(() => {
        const top = reportSection.getBoundingClientRect().top + window.scrollY - chromeHeight() - 12;
        window.scrollTo({ top: Math.max(0, top), behavior: REDUCED ? 'auto' : 'smooth' });
    });
}

function closeReport() {
    window.scrollTo({ top: 0, behavior: 'auto' });
    setReportMode(false);
    staleChip.hidden = true;
}

function showError(message) {
    lastReport = null;
    lastRunSource = null;
    setReportMode(true);
    reportBox.hidden = true;
    reportBox.textContent = '';
    reportMeta.textContent = '';
    reportError.hidden = false;
    errorMsg.textContent = message;
    scrollToReport();
}

function showReport(report, lines, seconds) {
    setReportMode(true);
    reportError.hidden = true;
    paint(report);
    const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    reportMeta.textContent = `Generated at ${at} \u00b7 ${lines} line${lines === 1 ? '' : 's'} \u00b7 ${seconds.toFixed(1)}s`;
    scrollToReport();
}

/* --------------------------------------------------------------------------
   Run
   -------------------------------------------------------------------------- */

let inflight = null;

async function run() {
    if (inflight) return;
    const code = input.value.trim();
    if (!code) {
        input.focus();
        flashHint('Paste some Python code first');
        return;
    }

    const controller = new AbortController();
    inflight = controller;
    input.blur();
    if (runBtn) runBtn.disabled = true;
    const lines = code.split('\n').length;
    const t0 = performance.now();
    loader.open(lines);

    try {
        const res = await fetch('/api/complexity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, language: 'python' }),
            signal: controller.signal,
        });
        const payload = await res.json().catch(() => null);

        if (!res.ok || !payload?.ok) {
            loader.close();
            showError(payload?.error || `Request failed (${res.status}).`);
            return;
        }
        if (!payload.report) {
            loader.close();
            showError('The report came back empty. Try again.');
            return;
        }

        await loader.finish();
        lastReport = payload.report;
        lastRunSource = input.value;
        showReport(lastReport, lines, (performance.now() - t0) / 1000);
    } catch (err) {
        loader.close();
        if (err.name !== 'AbortError') {
            showError('Could not reach the server. Check your connection and try again.');
        }
    } finally {
        if (inflight === controller) inflight = null;
        if (runBtn) runBtn.disabled = false;
    }
}

function cancel() {
    inflight?.abort();
}

runBtn?.addEventListener('click', run);
$('[data-retry]')?.addEventListener('click', run);
$('[data-rerun]')?.addEventListener('click', run);
$('[data-loader-cancel]')?.addEventListener('click', cancel);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && inflight) cancel();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && e.target !== input) {
        e.preventDefault();
        run();
    }
});

wireCopy($('[data-copy]'), () => asText(lastReport));
$('[data-close-report]')?.addEventListener('click', closeReport);

// PDF export is not built yet: point the user at the coming-soon notice.
const soonBox = $('[data-report-soon]');
$('[data-pdf]')?.addEventListener('click', () => {
    if (!soonBox) return;
    soonBox.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
    soonBox.classList.remove('pulse');
    void soonBox.offsetWidth;
    soonBox.classList.add('pulse');
});

$('[data-clear]')?.addEventListener('click', () => {
    input.value = '';
    input.focus();
    lastReport = null;
    lastRunSource = null;
    reportBox.textContent = '';
    closeReport();
    refreshNow();
});

const SAMPLE = `def group_anagrams(words):
    """Group words that are anagrams of each other."""
    buckets = {}
    for w in words:
        key = "".join(sorted(w))  # O(k log k)
        buckets.setdefault(key, []).append(w)
    return list(buckets.values())`;

$('[data-sample]')?.addEventListener('click', () => {
    input.value = SAMPLE;
    input.focus();
    input.setSelectionRange(0, 0);
    input.scrollTop = 0;
    refreshNow();
});

refreshNow();
bootStudio();
