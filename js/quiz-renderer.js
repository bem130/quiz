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

    btn.className = [
        // セルいっぱいに広げる
        'w-full h-full',
        // 中身のレイアウト
        'flex flex-col items-start justify-center gap-1',
        'text-left',
        // 余白・見た目
        'px-3 py-3 rounded-xl border text-sm',
        'transition-colors',
        'bg-white dark:bg-slate-900',
        'border-slate-300 dark:border-slate-700',
        'hover:border-emerald-400 dark:hover:border-emerald-400',
        // フォーカス枠
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500'
    ].join(' ');

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

export function updateInlineBlank(
    question,
    dataSets,
    answerIndex,
    rootElement = dom.questionText
) {
    const answers = question.answers || [];
    const answer = answers[answerIndex];
    if (!answer) return;

    const placeholders = rootElement.querySelectorAll(
        `[data-answer-index="${answerIndex}"]`
    );
    if (!placeholders.length) return;

    const options = answer.options || [];
    const selectedIndex = answer.userSelectedIndex;
    const selectedOpt =
        selectedIndex != null ? options[selectedIndex] : null;
    const correctOpt =
        typeof answer.correctIndex === 'number'
            ? options[answer.correctIndex]
            : null;

    const isCorrect =
        selectedIndex != null &&
        typeof answer.correctIndex === 'number' &&
        selectedIndex === answer.correctIndex;

    const isReviewContext = rootElement !== dom.questionText;

    function resolveRowForOption(opt) {
        if (!opt) return null;
        const sourceDataSetId =
            opt.dataSetId || (question.meta && question.meta.dataSetId);
        const ds = sourceDataSetId ? dataSets[sourceDataSetId] : null;
        if (!ds) return null;

        if (ds.type === 'table' && Array.isArray(ds.data)) {
            return opt.entityId
                ? ds.data.find((r) => r.id === opt.entityId) || null
                : null;
        }
        if (
            ds.type === 'factSentences' &&
            Array.isArray(ds.sentences)
        ) {
            return opt.entityId
                ? ds.sentences.find((s) => s.id === opt.entityId) || null
                : null;
        }
        return null;
    }

    function buildLabelNode(opt) {
        const span = document.createElement('span');
        if (!opt) return span;

        const row = resolveRowForOption(opt);

        if (opt.labelTokens && opt.labelTokens.length) {
            appendTokens(span, opt.labelTokens, row, null);
        } else if (opt.label) {
            span.appendChild(createStyledSpan(String(opt.label), []));
        } else if (opt.displayKey) {
            span.appendChild(createStyledSpan(String(opt.displayKey), []));
        } else if (row) {
            const text =
                row.nameEnCap || row.nameEn || row.text || '';
            span.appendChild(createStyledSpan(String(text), []));
        }

        return span;
    }

    placeholders.forEach((placeholder) => {
        // プレースホルダを「縦積み構造」にリセット
        placeholder.innerHTML = '';
        placeholder.className =
            'inline-flex flex-col items-start mx-1 align-baseline leading-tight';

        // 上段: 正答（下線つき）
        const correctLine = document.createElement('span');
        correctLine.className =
            'block px-2 border-b border-slate-500 min-w-[2.5rem] whitespace-nowrap';

        if (isReviewContext) {
            // Mistakes では正答を少し強調（青緑）
            correctLine.classList.add(
                'text-emerald-300',
                'dark:text-emerald-200'
            );
        }

        correctLine.appendChild(buildLabelNode(correctOpt));
        placeholder.appendChild(correctLine);

        // 間違えている場合のみ下段に「× ユーザの解答」を表示
        if (!isCorrect && selectedOpt) {
            const wrongLine = document.createElement('span');
            wrongLine.className =
                'mt-0.5 text-[0.7rem] text-rose-400 dark:text-rose-300 ' +
                'flex items-center gap-1 whitespace-nowrap';

            const mark = document.createElement('span');
            mark.textContent = '×';
            wrongLine.appendChild(mark);

            const wrongLabel = buildLabelNode(selectedOpt);
            wrongLabel.style.fontSize = '0.85em';
            wrongLine.appendChild(wrongLabel);

            placeholder.appendChild(wrongLine);
        }
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

    const rowContext = resolveQuestionContext(question, dataSets);

    question.answers.forEach((answer, answerIndex) => {
        (answer.options || []).forEach((opt, optIndex) => {
            const btn = dom.optionsContainer.querySelector(
                `button[data-answer-index="${answerIndex}"][data-option-index="${optIndex}"]`
            );
            if (!btn || btn.querySelector('.option-preview')) return;

            const preview = document.createElement('div');
            preview.className =
                'option-preview text-[0.7rem] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed';

            appendTokens(
                preview,
                question.tokens || [],
                rowContext,
                false // hide トークンは値を出す
            );

            btn.appendChild(preview);
        });
    });
}

export function resetReviewList() {
    if (dom.reviewList) {
        dom.reviewList.innerHTML = '';
        dom.reviewList.classList.add('hidden');
    }
    if (dom.reviewEmpty) {
        dom.reviewEmpty.classList.remove('hidden');
    }
    if (dom.mistakeCount) {
        dom.mistakeCount.textContent = '0';
        dom.mistakeCount.classList.add('hidden');
    }
}

export function addReviewItem(question, dataSets, questionNumber) {
    if (!dom.reviewList) return;

    // 空状態メッセージを隠し、リストを表示
    if (dom.reviewEmpty) {
        dom.reviewEmpty.classList.add('hidden');
    }
    dom.reviewList.classList.remove('hidden');

    // カウントバッジを表示
    if (dom.mistakeCount) {
        const current = Number(dom.mistakeCount.textContent || '0') + 1;
        dom.mistakeCount.textContent = String(current);
        dom.mistakeCount.classList.remove('hidden');
    }

    const li = document.createElement('li');
    li.className = [
        'rounded-lg border border-slate-300 dark:border-slate-700',
        'bg-white dark:bg-slate-900',
        'px-3 py-2',
        'text-xs'
    ].join(' ');

    const topRow = document.createElement('div');
    topRow.className = 'flex items-start gap-3 justify-between';

    // 左側: Q番号 + Incorrectバッジ
    const headerBox = document.createElement('div');
    headerBox.className = 'flex flex-col gap-1 min-w-[3.5rem]';

    const headerLine = document.createElement('div');
    headerLine.className = 'flex items-center gap-2';

    const qLabel = document.createElement('span');
    qLabel.className = 'font-semibold text-slate-800 dark:text-slate-100';
    qLabel.textContent = `Q${questionNumber}`;

    const badge = document.createElement('span');
    badge.className =
        'text-[0.7rem] px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 ' +
        'dark:text-red-300 border border-red-300/60 dark:border-red-500/50';
    badge.textContent = 'Incorrect';

    headerLine.appendChild(qLabel);
    headerLine.appendChild(badge);
    headerBox.appendChild(headerLine);

    // 右側: 問題文（穴埋め付き）
    const qText = document.createElement('div');
    qText.className = 'flex-1 text-slate-700 dark:text-slate-200';

    const row = resolveQuestionContext(question, dataSets);

    // まずはプレースホルダ付きで本文を描画（question-view と同じロジック）
    appendTokens(qText, question.tokens || [], row, true);

    // 各パーツごとに正答 / 誤答を埋め込む
    (question.answers || []).forEach((_, idx) => {
        updateInlineBlank(question, dataSets, idx, qText);
    });

    topRow.appendChild(headerBox);
    topRow.appendChild(qText);
    li.appendChild(topRow);

    dom.reviewList.appendChild(li);
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

export function addResultItem(historyItem, dataSets) {
    if (!dom.resultList || !historyItem || !historyItem.question) return;

    const question = historyItem.question;
    const item = document.createElement('li');
    item.className = historyItem.correct
        ? 'p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
        : 'p-2 rounded-lg border border-rose-200 dark:border-rose-700 bg-rose-50/70 dark:bg-rose-900/40';

    const header = document.createElement('div');
    header.className =
        'flex items-center justify-between text-xs text-slate-500 dark:text-slate-400';

    const orderSpan = document.createElement('span');
    orderSpan.textContent = `Q${historyItem.index}`;
    header.appendChild(orderSpan);

    // 正解 / 不正解バッジ
    const badge = document.createElement('span');
    badge.className = historyItem.correct
        ? 'px-2 py-0.5 rounded-full text-[0.7rem] bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-300/70 dark:border-emerald-500/60'
        : 'px-2 py-0.5 rounded-full text-[0.7rem] bg-rose-500/10 text-rose-600 dark:text-rose-300 border border-rose-300/70 dark:border-rose-500/60';
    badge.textContent = historyItem.correct ? 'Correct' : 'Incorrect';
    header.appendChild(badge);

    // 問題文：tokens をそのまま描画（ルビ・KaTeX 対応）
    const text = document.createElement('div');
    text.className = 'text-sm text-slate-800 dark:text-slate-100 mt-1 leading-relaxed';

    const rowContext = resolveQuestionContext(question, dataSets);
    appendTokens(text, question.tokens || [], rowContext, false);
    // ↑ hide トークンは値を出す

    // ユーザ回答サマリ（文字列のまま）
    const answer = document.createElement('div');
    answer.className = 'text-xs text-slate-500 dark:text-slate-400 mt-1';
    answer.textContent = historyItem.userAnswerSummary;

    item.appendChild(header);
    item.appendChild(text);
    item.appendChild(answer);
    dom.resultList.appendChild(item);
}
