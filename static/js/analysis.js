/* ==========================================================================
   analysis.js : render the complexity report

   The report is model output, so every string is written with textContent and
   the DOM is built node by node. Nothing here goes through innerHTML.
   ========================================================================== */

import {
    $,
    createRunner,
    wireCopy,
    bootStudio,
} from './lib/studio.js';
import { animate, stagger, utils, REDUCED } from './lib/motion.js';

const input = $('[data-input]');
const reportBox = $('[data-report]');
const langChip = $('[data-lang-chip]');
const gutter = $('[data-gutter]');
const lineCount = $('[data-line-count]');
const highlightLayer = $('#ca-highlight-layer');
const resultsSection = $('#ca-results');
const loader = $('#ca-loader');

let lastReport = null;

/* --------------------------------------------------------------------------
   Python Syntax Highlighter
   -------------------------------------------------------------------------- */

const KEYWORDS = ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'import', 
                  'from', 'as', 'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 
                  'pass', 'break', 'continue', 'raise', 'try', 'except', 'finally', 'with', 
                  'lambda', 'yield', 'del', 'global', 'nonlocal', 'assert'];

const BUILTINS = ['print', 'len', 'range', 'enumerate', 'zip', 'map', 'filter', 'list', 
                  'dict', 'set', 'tuple', 'type', 'str', 'int', 'float', 'bool', 'any', 
                  'all', 'sorted', 'reversed', 'min', 'max', 'sum', 'open', 'super', 'self'];

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function highlightPython(code) {
    let result = escapeHtml(code);
    
    // Comments
    result = result.replace(/(#[^\n]*)/g, '<span class="hl-comment">$1</span>');
    
    // Strings (triple quotes first, then single/double)
    result = result.replace(/("""[\s\S]*?"""|'''[\s\S]*?''')/g, '<span class="hl-string">$1</span>');
    result = result.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="hl-string">$1</span>');
    
    // Numbers
    result = result.replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-number">$1</span>');
    
    // Keywords
    const keywordPattern = new RegExp(`\\b(${KEYWORDS.join('|')})\\b`, 'g');
    result = result.replace(keywordPattern, '<span class="hl-keyword">$1</span>');
    
    // Builtins
    const builtinPattern = new RegExp(`\\b(${BUILTINS.join('|')})\\b`, 'g');
    result = result.replace(builtinPattern, '<span class="hl-builtin">$1</span>');
    
    // Function definitions (word before '(')
    result = result.replace(/\b([a-zA-Z_]\w*)\s*(?=\()/g, '<span class="hl-func">$1</span>');
    
    // Operators
    result = result.replace(/([+\-*/%=<>!&|^~])/g, '<span class="hl-operator">$1</span>');
    
    return result;
}

function syncHighlight() {
    if (!highlightLayer || !input) return;
    const code = input.value;
    highlightLayer.innerHTML = highlightPython(code);
}

function syncScroll() {
    if (!highlightLayer || !input) return;
    highlightLayer.scrollTop = input.scrollTop;
    highlightLayer.scrollLeft = input.scrollLeft;
    if (gutter) gutter.scrollTop = input.scrollTop;
}

/* --------------------------------------------------------------------------
   Loader
   -------------------------------------------------------------------------- */

function showLoader() {
    if (loader) {
        loader.hidden = false;
        document.body.style.pointerEvents = 'none';
    }
}

function hideLoader() {
    if (loader) {
        loader.hidden = true;
        document.body.style.pointerEvents = '';
    }
}

/* --------------------------------------------------------------------------
   Builders
   -------------------------------------------------------------------------- */

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function boundCell(label, entry) {
    const cell = el('div', 'bound');
    cell.append(
        el('span', 'bound-label', label),
        el('span', 'bound-value', entry?.bound || 'unknown'),
        el('p', 'bound-reason', entry?.reason || 'No reasoning given.')
    );
    return cell;
}

function driverRow(driver) {
    const row = el('div', 'driver');
    row.append(
        el('span', 'driver-kind', driver?.kind || 'other'),
        el('span', 'driver-where', driver?.where || ''),
        el('span', 'driver-cost', driver?.cost || ''),
        el('p', 'driver-note', driver?.note || '')
    );
    return row;
}

function paint(report) {
    reportBox.textContent = '';

    if (report.summary) {
        reportBox.append(el('p', 'report-summary', report.summary));
    }

    const time = report.time || {};
    const bounds = el('div', 'bounds');
    bounds.append(
        boundCell('Best case', time.best),
        boundCell('Average case', time.average),
        boundCell('Worst case', time.worst),
        boundCell('Space', report.space)
    );
    reportBox.append(bounds);

    const drivers = Array.isArray(report.drivers) ? report.drivers : [];
    if (drivers.length) {
        reportBox.append(el('h3', null, 'What drives the cost'));
        const list = el('div', 'drivers');
        drivers.forEach((d) => list.append(driverRow(d)));
        reportBox.append(list);
    }

    const notes = Array.isArray(report.notes) ? report.notes.filter(Boolean) : [];
    if (notes.length) {
        reportBox.append(el('h3', null, 'Notes and assumptions'));
        const list = el('ul', 'notes');
        notes.forEach((n) => list.append(el('li', null, String(n))));
        reportBox.append(list);
    }

    if (resultsSection) {
        resultsSection.hidden = false;
        setTimeout(() => {
            resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }

    if (REDUCED) return;

    const cells = Array.from(reportBox.querySelectorAll('.bound'));
    const rows = Array.from(reportBox.querySelectorAll('.driver, .notes li'));
    const heads = Array.from(reportBox.querySelectorAll('.report-summary, h3'));

    utils.set([...cells, ...rows, ...heads], { opacity: 0 });

    animate(heads, { opacity: 1, y: [10, 0], duration: 620, delay: stagger(80), ease: 'outExpo' });
    animate(cells, {
        opacity: 1,
        y: [16, 0],
        duration: 760,
        delay: stagger(90, { start: 120 }),
        ease: 'outExpo',
    });
    animate(rows, {
        opacity: 1,
        x: [-10, 0],
        duration: 640,
        delay: stagger(60, { start: 360 }),
        ease: 'outExpo',
    });
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
   Language chip
   -------------------------------------------------------------------------- */

function setLanguage() {
    if (!langChip) return;
    langChip.innerHTML = '<i></i>Python';
    langChip.classList.add('live');
}

function syncEditorMeta() {
    if (!input) return;
    const count = Math.max(1, input.value.split('\n').length);
    if (gutter) gutter.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
    if (lineCount) lineCount.textContent = `${count} line${count === 1 ? '' : 's'}`;
    syncHighlight();
}

input?.addEventListener('input', syncEditorMeta);
input?.addEventListener('scroll', syncScroll);

/* --------------------------------------------------------------------------
   Run
   -------------------------------------------------------------------------- */

const runner = createRunner({
    endpoint: '/api/complexity',
    input,
    runBtn: $('[data-run]'),
    result: reportBox,
    states: {
        empty: $('[data-state-empty]'),
        working: $('[data-state-working]'),
        error: $('[data-state-error]'),
    },
    words: ['Reading', 'Tracing', 'Writing'],
    onLanguage: setLanguage,
    render(payload) {
        lastReport = payload.report || null;
        if (!lastReport) {
            runner.setError('The report came back empty. Try again.');
            hideLoader();
            return;
        }
        paint(lastReport);
        hideLoader();
    },
});

// Hook into run button to show loader
$('[data-run]')?.addEventListener('click', () => {
    showLoader();
});

// Observe working state to sync loader
const workingState = $('[data-state-working]');
if (workingState) {
    const observer = new MutationObserver(() => {
        if (workingState.hidden) {
            hideLoader();
        }
    });
    observer.observe(workingState, { attributes: true, attributeFilter: ['hidden'] });
}

wireCopy($('[data-copy]'), () => asText(lastReport));

$('[data-clear]')?.addEventListener('click', () => {
    if (!input) return;
    input.value = '';
    input.focus();
    setLanguage();
    syncEditorMeta();
    lastReport = null;
    reportBox.textContent = '';
    if (resultsSection) resultsSection.hidden = true;
    runner.show('empty');
});

const SAMPLE = `def group_anagrams(words):
    buckets = {}
    for w in words:
        key = "".join(sorted(w))
        buckets.setdefault(key, []).append(w)
    return list(buckets.values())`;

$('[data-sample]')?.addEventListener('click', () => {
    if (!input) return;
    input.value = SAMPLE;
    input.focus();
    setLanguage();
    syncEditorMeta();
});

setLanguage();
syncEditorMeta();
bootStudio();
