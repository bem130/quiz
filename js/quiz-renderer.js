// js/quiz-renderer.js
import { dom } from './dom-refs.js';

let renderedQuestion = null;

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

function renderHideValueIntoSpan(span, token, row) {
    if (Array.isArray(token.value)) {
        appendTokens(span, token.value, row, null);
        return;
    }
    if (token.value && typeof token.value === 'object') {
        appendTokens(span, [token.value], row, null);
        return;
    }
    const field = token.field;
    const value = field && row ? row[field] ?? '' : '';
    span.appendChild(createStyledSpan(value || '____', token.styles || []));
}

function appendTokens(parent, tokens, row, placeholders = null) {
    let answerIndexCounter = 0;
    (tokens || []).forEach((token) => {
        if (!token || !token.type) return;
        if (token.type === 'text') {
            parent.appendChild(createStyledSpan(token.value ?? '', token.styles || []));
            return;
        }
        if (token.type === 'katex') {
            const text =
                token.value != null
                    ? token.value
                    : token.field && row
                        ? row[token.field] ?? ''
                        : '';
            parent.appendChild(createStyledSpan(String(text), ['katex', ...(token.styles || [])]));
            return;
        }
        if (token.type === 'smiles') {
            const text =
                token.value != null
                    ? token.value
                    : token.field && row
                        ? row[token.field] ?? ''
                        : '';
            const span = document.createElement('span');
            span.textContent = text ? `[SMILES: ${text}]` : '[SMILES]';
            span.classList.add('font-mono');
            parent.appendChild(span);
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
                const span = document.createElement('span');
                renderHideValueIntoSpan(span, token, row);
                parent.appendChild(span);
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
    const sourceDataSetId = option.dataSetId || (question.meta && question.meta.dataSetId);
    const ds = sourceDataSetId ? dataSets[sourceDataSetId] : null;
    const row = option.entityId && ds
        ? ds.type === 'table' && Array.isArray(ds.data)
            ? ds.data.find((r) => r.id === option.entityId)
            : ds.type === 'factSentences' && Array.isArray(ds.sentences)
                ? ds.sentences.find((s) => s.id === option.entityId)
                : null
        : null;
    if (option.labelTokens) {
        const span = document.createElement('span');
        appendTokens(span, option.labelTokens, row);
        return [span];
    }
    if (option.label) {
        return [createStyledSpan(option.label)];
    }
    if (row) {
        const span = document.createElement('span');
        appendTokens(span, [{ type: 'key', field: 'nameEnCap' }], row);
        return [span];
    }
    return [createStyledSpan(String(option.label || option.displayKey || ''))];
}

function renderAnswerGroup(question, dataSets, answerIndex, onSelect) {
    const answer = question.answers[answerIndex];
    const group = document.createElement('div');
    group.className = 'space-y-2 hidden';
    group.dataset.answerIndex = String(answerIndex);

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

function updateAnswerNavigation(question, targetIndex) {
    if (!question || !question._answerGroups) return;
    const maxIndex = question._answerGroups.length - 1;
    const nextIndex = Math.min(Math.max(targetIndex, 0), maxIndex);
    question.currentAnswerIndex = nextIndex;

    question._answerGroups.forEach((group, idx) => {
        if (idx === nextIndex) {
            group.classList.remove('hidden');
        } else {
            group.classList.add('hidden');
        }
    });

    if (question._answerNav) {
        const { prevBtn, nextBtn, statusEl } = question._answerNav;
        if (statusEl) {
            statusEl.textContent = `${nextIndex + 1} / ${question._answerGroups.length}`;
        }
        if (prevBtn) {
            prevBtn.disabled = nextIndex === 0;
        }
        if (nextBtn) {
            nextBtn.disabled = nextIndex === maxIndex;
        }
    }
}

function createAnswerNavigation(question) {
    const nav = document.createElement('div');
    nav.className = 'flex items-center justify-between gap-3';

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50';
    prev.textContent = '<';

    const status = document.createElement('div');
    status.className = 'text-xs text-slate-500 dark:text-slate-400';

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50';
    next.textContent = '>';

    nav.appendChild(prev);
    nav.appendChild(status);
    nav.appendChild(next);

    prev.addEventListener('click', () => {
        updateAnswerNavigation(question, question.currentAnswerIndex - 1);
    });
    next.addEventListener('click', () => {
        updateAnswerNavigation(question, question.currentAnswerIndex + 1);
    });

    question._answerNav = { prevBtn: prev, nextBtn: next, statusEl: status };
    return nav;
}

export function renderQuestion(question, dataSets, onSelect) {
    renderedQuestion = question;
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

    const answersWrapper = document.createElement('div');
    answersWrapper.className = 'space-y-3';
    const answerGroups = question.answers.map((_, idx) => renderAnswerGroup(question, dataSets, idx, onSelect));
    question._answerGroups = answerGroups;

    const useNavigation = question.format === 'sentence_fill_choice' && answerGroups.length > 1;
    question.useNavigation = useNavigation;

    if (useNavigation) {
        const nav = createAnswerNavigation(question);
        dom.optionsContainer.appendChild(nav);
    } else {
        answerGroups.forEach((group) => group.classList.remove('hidden'));
    }

    const groupsContainer = document.createElement('div');
    groupsContainer.className = 'space-y-4';
    answerGroups.forEach((group) => groupsContainer.appendChild(group));
    answersWrapper.appendChild(groupsContainer);
    dom.optionsContainer.appendChild(answersWrapper);

    if (useNavigation) {
        updateAnswerNavigation(question, question.currentAnswerIndex || 0);
    }
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

export function revealNextAnswerGroup() {
    if (!renderedQuestion || !renderedQuestion.answers || !renderedQuestion.useNavigation) return;
    const current = renderedQuestion.currentAnswerIndex || 0;
    const nextUnanswered = renderedQuestion.answers.findIndex((ans, idx) => idx > current && ans && ans.userSelectedIndex == null);
    if (nextUnanswered >= 0) {
        updateAnswerNavigation(renderedQuestion, nextUnanswered);
        return;
    }
    const firstUnanswered = renderedQuestion.answers.findIndex((ans) => ans && ans.userSelectedIndex == null);
    if (firstUnanswered >= 0) {
        updateAnswerNavigation(renderedQuestion, firstUnanswered);
    }
}

export function appendPatternPreviewToOptions(question, dataSets) {
    if (!question || !Array.isArray(question.answers)) return;
    question.answers.forEach((answer, answerIndex) => {
        answer.options.forEach((opt, optIndex) => {
            const btn = dom.optionsContainer.querySelector(
                `button[data-answer-index="${answerIndex}"][data-option-index="${optIndex}"]`
            );
            if (!btn || btn.querySelector('.option-preview')) return;
            const preview = document.createElement('div');
            preview.className = 'option-preview text-[0.7rem] text-slate-500 dark:text-slate-400 mt-1';
            const rowContext = resolveQuestionContext(question, dataSets);
            const text = tokensToPlainText(question.tokens || [], rowContext);
            preview.textContent = text || '';
            btn.appendChild(preview);
        });
    });
}

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
        const when = tip.when || 'after_answer';
        const visible =
            when === 'after_answer' ||
            when === 'always' ||
            (when === 'correct' && isCorrect) ||
            (when === 'after_correct' && isCorrect) ||
            (when === 'incorrect' && !isCorrect) ||
            (when === 'after_incorrect' && !isCorrect);
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

function tokensToPlainText(tokens, row) {
    let text = '';
    (tokens || []).forEach((token) => {
        if (!token || !token.type) return;
        if (token.type === 'text') {
            text += token.value ?? '';
            return;
        }
        if (token.type === 'katex') {
            const value = token.value != null ? token.value : token.field && row ? row[token.field] ?? '' : '';
            text += String(value ?? '');
            return;
        }
        if (token.type === 'smiles') {
            const value = token.value != null ? token.value : token.field && row ? row[token.field] ?? '' : '';
            text += String(value ?? '');
            return;
        }
        if (token.type === 'key') {
            const value = token.field && row ? row[token.field] ?? '' : '';
            text += String(value ?? '');
            return;
        }
        if (token.type === 'ruby' || token.type === 'hideruby') {
            text += resolveSubTokenValue(token.base, row);
            return;
        }
        if (token.type === 'hide') {
            if (token.value) {
                if (Array.isArray(token.value)) {
                    text += tokensToPlainText(token.value, row);
                } else if (token.value && typeof token.value === 'object') {
                    text += tokensToPlainText([token.value], row);
                }
            } else if (token.field && row) {
                text += row[token.field] ?? '';
            }
            return;
        }
    });
    return text.trim();
}

function optionToText(option, dataSets, question) {
    if (!option) return '';
    if (option.label) return String(option.label);
    const sourceDataSetId = option.dataSetId || (question.meta && question.meta.dataSetId);
    const ds = sourceDataSetId ? dataSets[sourceDataSetId] : null;
    const row = option.entityId && ds
        ? ds.type === 'table' && Array.isArray(ds.data)
            ? ds.data.find((r) => r.id === option.entityId)
            : ds.type === 'factSentences' && Array.isArray(ds.sentences)
                ? ds.sentences.find((s) => s.id === option.entityId)
                : null
        : null;
    if (option.labelTokens) {
        return tokensToPlainText(option.labelTokens, row);
    }
    if (option.displayKey) {
        return String(option.displayKey);
    }
    if (row && row.nameEnCap) {
        return String(row.nameEnCap);
    }
    return '';
}

export function summarizeQuestion(question, dataSets) {
    const contextRow = resolveQuestionContext(question, dataSets);
    return tokensToPlainText(question.tokens || [], contextRow);
}

export function summarizeAnswers(question, dataSets) {
    if (!question || !Array.isArray(question.answers)) return '';
    const parts = question.answers.map((answer, idx) => {
        const selected = answer && answer.options ? answer.options[answer.userSelectedIndex] : null;
        const label = optionToText(selected, dataSets, question);
        return `(${idx + 1}) ${label || '-'}`;
    });
    return parts.join(' / ');
}

export function resetResultList() {
    if (dom.resultList) {
        dom.resultList.innerHTML = '';
    }
}

export function addResultItem(historyItem) {
    if (!dom.resultList) return;
    const item = document.createElement('li');
    item.className = historyItem.correct
        ? 'p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
        : 'p-2 rounded-lg border border-rose-200 dark:border-rose-700 bg-rose-50/70 dark:bg-rose-900/40';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between text-xs text-slate-500 dark:text-slate-400';
    const orderSpan = document.createElement('span');
    orderSpan.textContent = `Q${historyItem.index}`;
    const status = document.createElement('span');
    status.textContent = historyItem.correct ? 'Correct' : 'Incorrect';
    header.appendChild(orderSpan);
    header.appendChild(status);

    const text = document.createElement('div');
    text.className = 'text-sm text-slate-800 dark:text-slate-100 mt-1';
    text.textContent = historyItem.questionText;

    const answer = document.createElement('div');
    answer.className = 'text-xs text-slate-500 dark:text-slate-400 mt-1';
    answer.textContent = historyItem.userAnswerSummary;

    item.appendChild(header);
    item.appendChild(text);
    item.appendChild(answer);
    dom.resultList.appendChild(item);
}
