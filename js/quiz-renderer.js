// js/quiz-renderer.js
import { dom } from './dom-refs.js';

function createStyledSpan(text, styles = []) {
    const span = document.createElement('span');
    if (styles.includes('katex') && window.katex) {
        try {
            window.katex.render(text, span, {
                throwOnError: false,
                strict: false
            });
            return span;
        } catch (e) {
            span.textContent = text;
        }
    }
    span.textContent = text;
    if (styles.includes('bold')) span.classList.add('font-semibold');
    if (styles.includes('italic')) span.classList.add('italic');
    if (styles.includes('serif')) span.classList.add('font-serif');
    if (styles.includes('sans')) span.classList.add('font-sans');
    if (styles.includes('muted')) span.classList.add('text-slate-500', 'dark:text-slate-400');
    return span;
}

function resolveSubTokenValue(spec, row) {
    if (!spec) return '';
    const source = spec.source || 'text';
    if (source === 'key') {
        const field = spec.field;
        return field && row ? row[field] ?? '' : '';
    }
    if (source === 'text') {
        return spec.value ?? '';
    }
    return '';
}

function renderRubyToken(token, row) {
    const rubyEl = document.createElement('ruby');
    const baseText = token.base ? resolveSubTokenValue(token.base, row) : '';
    const rubyText = token.ruby ? resolveSubTokenValue(token.ruby, row) : '';
    const rbSpan = document.createElement('span');
    const baseStyles = (token.base && token.base.styles) || token.styles || [];
    rbSpan.appendChild(createStyledSpan(baseText, baseStyles));
    const rt = document.createElement('rt');
    rt.textContent = rubyText;
    rubyEl.appendChild(rbSpan);
    rubyEl.appendChild(rt);
    return rubyEl;
}

function appendTokens(parent, tokens, row, placeholders = null) {
    let answerIndexCounter = 0;
    (tokens || []).forEach((token) => {
        if (!token || !token.type) return;
        if (token.type === 'text') {
            parent.appendChild(createStyledSpan(token.value ?? '', token.styles || []));
            return;
        }
        if (token.type === 'key') {
            const field = token.field;
            const value = field && row ? row[field] ?? '' : '';
            parent.appendChild(createStyledSpan(value, token.styles || []));
            return;
        }
        if (token.type === 'ruby' || token.type === 'hideruby') {
            parent.appendChild(renderRubyToken(token, row));
            return;
        }
        if (token.type === 'hide') {
            if (placeholders && token.answer) {
                const span = document.createElement('span');
                span.dataset.answerIndex = String(answerIndexCounter);
                span.className = 'inline-block min-w-[2.5rem] border-b border-slate-500 mx-1';
                span.textContent = ' ';
                parent.appendChild(span);
            } else {
                const field = token.field;
                const value = field && row ? row[field] ?? '' : '';
                parent.appendChild(createStyledSpan(value || '____', token.styles || []));
            }
            answerIndexCounter += 1;
            return;
        }
        if (token.type === 'br') {
            parent.appendChild(document.createElement('br'));
        }
    });
}

function createOptionButton(labelNodes, isDisabled, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
        'w-full text-left px-3 py-2 rounded-xl border text-sm transition-colors bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 hover:border-emerald-400';
    btn.disabled = isDisabled;
    labelNodes.forEach((node) => btn.appendChild(node));
    btn.addEventListener('click', onClick);
    return btn;
}

function renderOptionLabel(option, dataSets, question) {
    if (option.labelTokens) {
        const span = document.createElement('span');
        appendTokens(span, option.labelTokens, null);
        return [span];
    }
    if (option.label) {
        return [createStyledSpan(option.label)];
    }
    const sourceDataSetId = option.dataSetId || (question.meta && question.meta.dataSetId);
    if (option.entityId && sourceDataSetId) {
        const ds = dataSets[sourceDataSetId];
        const row = (ds && Array.isArray(ds.data))
            ? ds.data.find((r) => r.id === option.entityId)
            : null;
        if (row) {
            const span = document.createElement('span');
            appendTokens(span, [{ type: 'key', field: 'nameEnCap' }], row);
            return [span];
        }
    }
    return [createStyledSpan(String(option.label || option.displayKey || ''))];
}

function renderAnswerGroup(question, dataSets, answerIndex, onSelect) {
    const answer = question.answers[answerIndex];
    const group = document.createElement('div');
    group.className = 'space-y-2';

    if (answer.meta && answer.meta.leftText) {
        const title = document.createElement('div');
        title.className = 'text-sm font-semibold text-slate-700 dark:text-slate-200';
        title.textContent = answer.meta.leftText;
        group.appendChild(title);
    }

    const optionsWrapper = document.createElement('div');
    optionsWrapper.className = 'grid grid-cols-1 md:grid-cols-2 gap-2';

    answer.options.forEach((opt, idx) => {
        const labelNodes = renderOptionLabel(opt, dataSets, question);
        const btn = createOptionButton(labelNodes, question.meta.disabled, () => {
            onSelect(answerIndex, idx);
        });
        btn.dataset.answerIndex = String(answerIndex);
        btn.dataset.optionIndex = String(idx);
        optionsWrapper.appendChild(btn);
    });

    group.appendChild(optionsWrapper);
    return group;
}

export function renderQuestion(question, dataSets, onSelect) {
    dom.questionText.innerHTML = '';
    dom.optionsContainer.innerHTML = '';

    const contextRow = resolveQuestionContext(question, dataSets);
    if (question.format === 'table_matching') {
        const header = document.createElement('div');
        header.className = 'text-sm text-slate-500 dark:text-slate-400 mb-2';
        header.textContent = 'Match the items on the left with the correct options on the right.';
        dom.questionText.appendChild(header);
    }

    appendTokens(dom.questionText, question.tokens, contextRow, true);

    question.answers.forEach((_, idx) => {
        const group = renderAnswerGroup(question, dataSets, idx, onSelect);
        dom.optionsContainer.appendChild(group);
    });
}

function resolveQuestionContext(question, dataSets) {
    if (!question.meta || !question.meta.dataSetId) return null;
    const ds = dataSets[question.meta.dataSetId];
    if (!ds) return null;
    if (ds.type === 'table' && Array.isArray(ds.data)) {
        return ds.data.find((row) => row.id === question.meta.entityId) || null;
    }
    if (ds.type === 'factSentences' && Array.isArray(ds.sentences)) {
        return ds.sentences.find((s) => s.id === question.meta.sentenceId) || null;
    }
    return null;
}

export function updateInlineBlank(question, dataSets, answerIndex) {
    const answer = question.answers[answerIndex];
    if (!answer) return;
    const selected = answer.options[answer.userSelectedIndex];
    const placeholders = dom.questionText.querySelectorAll(`[data-answer-index="${answerIndex}"]`);
    let fillText = '';
    if (selected) {
        if (selected.labelTokens) {
            const span = document.createElement('span');
            appendTokens(span, selected.labelTokens, null);
            fillText = span.textContent || '';
        } else {
            fillText = selected.label || selected.displayKey || '';
        }
    }
    placeholders.forEach((el) => {
        el.textContent = fillText;
    });
}

export function renderProgress(currentIndex, total, score) {
    dom.currentQNum.textContent = `${currentIndex + 1}`;
    dom.totalQNum.textContent = `${total}`;
    dom.currentScore.textContent = `${score}`;
}

export function showOptionFeedback(question) {
    question.answers.forEach((answer, answerIndex) => {
        answer.options.forEach((opt, optIndex) => {
            const btn = dom.optionsContainer.querySelector(
                `button[data-answer-index="${answerIndex}"][data-option-index="${optIndex}"]`
            );
            if (!btn) return;
            btn.classList.remove('border-slate-300', 'dark:border-slate-700');
            if (optIndex === answer.correctIndex) {
                btn.classList.add('border-emerald-400', 'bg-emerald-50', 'dark:bg-emerald-900/30');
            } else if (answer.userSelectedIndex === optIndex) {
                btn.classList.add('border-rose-400', 'bg-rose-50', 'dark:bg-rose-900/30');
            }
        });
    });
}

export function showOptionFeedbackForAnswer(question, answerIndex) {
    showOptionFeedback(question);
}

export function revealNextAnswerGroup() {}

export function appendPatternPreviewToOptions() {}

export function resetReviewList() {
    dom.reviewList.innerHTML = '';
    dom.mistakeCount.textContent = '0';
    dom.reviewEmpty.classList.remove('hidden');
}

export function addReviewItem(question, dataSets, order) {
    dom.reviewEmpty.classList.add('hidden');
    const item = document.createElement('div');
    item.className = 'p-2 border-b border-slate-200 dark:border-slate-700';
    const row = resolveQuestionContext(question, dataSets);
    const text = document.createElement('div');
    text.className = 'text-sm';
    appendTokens(text, question.tokens, row, false);
    const info = document.createElement('div');
    info.className = 'text-xs text-slate-500';
    info.textContent = `Q${order}`;
    item.appendChild(info);
    item.appendChild(text);
    dom.reviewList.appendChild(item);
    dom.mistakeCount.textContent = String(Number(dom.mistakeCount.textContent || '0') + 1);
}

export function renderTips(tips, row, isCorrect) {
    dom.tipContainer.innerHTML = '';
    (tips || []).forEach((tip) => {
        const when = tip.when || 'always';
        const visible =
            when === 'always' || (when === 'correct' && isCorrect) || (when === 'incorrect' && !isCorrect);
        if (!visible) return;
        const block = document.createElement('div');
        block.className = 'p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm mb-2';
        appendTokens(block, tip.tokens, row);
        dom.tipContainer.appendChild(block);
    });
}

export function resetTips() {
    dom.tipContainer.innerHTML = '';
}
