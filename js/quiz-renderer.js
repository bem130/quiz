// js/quiz-renderer.js
import { dom } from './dom-refs.js';

function isTipVisible(tip, isCorrect) {
    const when = tip && tip.when ? tip.when : 'always';

    if (when === 'always') return true;
    if (when === 'correct') return Boolean(isCorrect);
    if (when === 'incorrect') return !isCorrect;

    return false;
}

function createStyledSpan(text, styles = []) {
    const span = document.createElement('span');

    // KaTeX support
    if (styles.includes('katex') && window.katex) {
        try {
            window.katex.render(text, span, {
                throwOnError: false,
                strict: false
            });
            return span;
        } catch (e) {
            // fall through
        }
    }

    span.textContent = text;

    if (styles.includes('bold')) span.classList.add('font-semibold');
    if (styles.includes('italic')) span.classList.add('italic');
    if (styles.includes('serif')) span.classList.add('font-serif');
    if (styles.includes('sans')) span.classList.add('font-sans');

    return span;
}

function renderRubyToken(token, entity) {
    const base = token.base;
    const ruby = token.ruby;

    const baseText =
        base.source === 'key'
            ? (entity?.[base.field] ?? '')
            : (base.value ?? '');

    const rubyText =
        ruby.source === 'key'
            ? (entity?.[ruby.field] ?? '')
            : (ruby.value ?? '');

    const rubyEl = document.createElement('ruby');

    const rb = createStyledSpan(baseText, base.styles || []);
    const rtSpan = createStyledSpan(rubyText, ruby.styles || []);
    const rt = document.createElement('rt');
    rt.classList.add('text-[0.65rem]');
    rt.appendChild(rtSpan);

    rubyEl.appendChild(rb);
    rubyEl.appendChild(rt);

    return rubyEl;
}

// 下線だけの穴埋めプレースホルダ（answers[n] に対応）
function createBlankPlaceholder(answerIndex) {
    const wrapper = document.createElement('span');
    wrapper.dataset.answerIndex = String(answerIndex);
    wrapper.className = 'inline-flex flex-col items-start mx-1';

    const underline = document.createElement('span');
    underline.className =
        'px-2 border-b border-slate-500 min-w-[2.5rem] inline-block';
    underline.textContent = ' ';

    wrapper.appendChild(underline);
    return wrapper;
}

function appendTokens(targetElement, tokens, entity) {
    (tokens || []).forEach((token) => {
        if (!token || !token.type) return;

        if (token.type === 'text') {
            const span = createStyledSpan(token.value ?? '', token.styles || []);
            targetElement.appendChild(span);
        } else if (token.type === 'key') {
            const value = entity?.[token.field] ?? '';
            const span = createStyledSpan(value, token.styles || []);
            targetElement.appendChild(span);
        } else if (token.type === 'ruby' || token.type === 'hideruby') {
            const rubyEl = renderRubyToken(token, entity);
            targetElement.appendChild(rubyEl);
        } else if (token.type === 'hide') {
            const field = token.field;
            const text = field ? (entity?.[field] ?? '') : '';
            const span = createStyledSpan(text || '____', token.styles || []);
            targetElement.appendChild(span);
        }
    });
}

// 複数パーツ問題用のナビゲーション状態
let currentAnswerGroupIndex = 0;
let maxVisibleAnswerGroupIndex = 0;
let totalAnswerGroups = 1;

let navPrevButton = null;
let navNextButton = null;
let navStatusLabel = null;

// ナビゲーション状態のリセット
function resetAnswerGroupNavigation() {
    currentAnswerGroupIndex = 0;
    maxVisibleAnswerGroupIndex = 0;
    totalAnswerGroups = 1;

    navPrevButton = null;
    navNextButton = null;
    navStatusLabel = null;
}

// パート表示とナビボタンの状態を更新
function updateAnswerGroupNavigation() {
    if (!dom.optionsContainer) return;

    const groups = Array.from(
        dom.optionsContainer.querySelectorAll('[data-answer-index]')
    );

    groups.forEach((group) => {
        const idx = Number(group.dataset.answerIndex || '0');

        if (idx > maxVisibleAnswerGroupIndex) {
            group.classList.add('hidden');
            return;
        }

        if (idx === currentAnswerGroupIndex) {
            group.classList.remove('hidden');
        } else {
            group.classList.add('hidden');
        }
    });

    if (navStatusLabel) {
        navStatusLabel.textContent = `Part ${currentAnswerGroupIndex + 1} / ${totalAnswerGroups}`;
    }

    if (navPrevButton) {
        navPrevButton.disabled = currentAnswerGroupIndex <= 0;
    }

    if (navNextButton) {
        navNextButton.disabled = currentAnswerGroupIndex >= maxVisibleAnswerGroupIndex;
    }
}

/**
 * 問題文を描画する。
 * - skipAnswerTokens === true のとき:
 *   - hideruby / hide で answer を持つトークンは
 *     answers[n] に対応した下線プレースホルダを描画
 *   - その他のトークンは通常通り
 * - skipAnswerTokens === false のとき:
 *   - hideruby / hide も含めて「正しい本文」をそのまま描画
 */
export function renderQuestionText(
    patternTokens,
    entity,
    skipAnswerTokens = true,
    targetElement = dom.questionText
) {
    targetElement.innerHTML = '';

    let answerCounter = 0;

    (patternTokens || []).forEach((token) => {
        if (!token || !token.type) return;

        const isAnswerToken = Boolean(token.answer);

        // クイズ本編: answer 付きの hide/hideruby は下線プレースホルダ
        if (skipAnswerTokens && isAnswerToken) {
            if (token.type === 'hide' || token.type === 'hideruby') {
                const placeholder = createBlankPlaceholder(answerCounter);
                answerCounter += 1;
                targetElement.appendChild(placeholder);
                return;
            }
        }

        // Mistakes など: skipAnswerTokens = false のときは「正解そのもの」を描画
        if (token.type === 'text') {
            const span = createStyledSpan(token.value ?? '', token.styles || []);
            targetElement.appendChild(span);
        } else if (token.type === 'key') {
            const value = entity?.[token.field] ?? '';
            const span = createStyledSpan(value, token.styles || []);
            targetElement.appendChild(span);
        } else if (token.type === 'ruby' || token.type === 'hideruby') {
            const rubyEl = renderRubyToken(token, entity);
            targetElement.appendChild(rubyEl);
        } else if (token.type === 'hide') {
            const field = token.field;
            const text = field ? (entity?.[field] ?? '') : '';
            const span = createStyledSpan(
                skipAnswerTokens ? '____' : (text || '____'),
                token.styles || []
            );
            if (skipAnswerTokens) {
                span.classList.add('px-2', 'border-b', 'border-slate-500');
            }
            targetElement.appendChild(span);
        }
    });
}

/**
 * optionsContainer に、answers[] すべての選択肢を描画する。
 * answer ごとにグループを作って縦に並べる。
 * 複数パーツがある場合はナビゲーションで表示を切り替える。
 */
export function renderOptions(question, entitySet, onSelectOption) {
    if (!dom.optionsContainer) return;

    dom.optionsContainer.innerHTML = '';

    const answers = question.answers || [];
    if (!answers.length) {
        return;
    }

    const entities = entitySet.entities || {};

    resetAnswerGroupNavigation();
    totalAnswerGroups = answers.length;

    const hasMultipleParts = answers.length > 1;

    if (hasMultipleParts) {
        const nav = document.createElement('div');
        nav.className =
            'mb-2 flex items-center justify-between text-[0.7rem] ' +
            'text-slate-500 dark:text-slate-400';

        const left = document.createElement('div');
        left.textContent = 'Part navigation';

        const right = document.createElement('div');
        right.className = 'flex items-center gap-2';

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className =
            'px-1.5 py-0.5 rounded border border-slate-400/60 ' +
            'text-[0.7rem] leading-none hover:bg-slate-100 ' +
            'dark:hover:bg-slate-800 transition-colors';
        prevBtn.textContent = '<';

        const status = document.createElement('span');
        status.className = 'mx-1';

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className =
            'px-1.5 py-0.5 rounded border border-slate-400/60 ' +
            'text-[0.7rem] leading-none hover:bg-slate-100 ' +
            'dark:hover:bg-slate-800 transition-colors';
        nextBtn.textContent = '>';

        prevBtn.addEventListener('click', () => {
            if (currentAnswerGroupIndex > 0) {
                currentAnswerGroupIndex -= 1;
                updateAnswerGroupNavigation();
            }
        });

        nextBtn.addEventListener('click', () => {
            if (currentAnswerGroupIndex < maxVisibleAnswerGroupIndex) {
                currentAnswerGroupIndex += 1;
                updateAnswerGroupNavigation();
            }
        });

        right.appendChild(prevBtn);
        right.appendChild(status);
        right.appendChild(nextBtn);

        nav.appendChild(left);
        nav.appendChild(right);

        dom.optionsContainer.appendChild(nav);

        navPrevButton = prevBtn;
        navNextButton = nextBtn;
        navStatusLabel = status;
    }

    answers.forEach((answer, ansIdx) => {
        const group = document.createElement('div');
        group.dataset.answerIndex = String(ansIdx);
        group.className = 'space-y-1';

        if (hasMultipleParts) {
            const partLabel = document.createElement('div');
            partLabel.className =
                'text-[0.75rem] text-slate-500 dark:text-slate-400 mb-1';
            partLabel.textContent = `Part ${ansIdx + 1}`;
            group.appendChild(partLabel);
        }

        const optionsRow = document.createElement('div');
        optionsRow.className = 'space-y-2';

        (answer.options || []).forEach((opt, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = [
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg border',
                'border-slate-700/40 bg-slate-900/60 text-slate-100',
                'hover:border-emerald-400/80 hover:bg-slate-900',
                'transition-colors text-left text-xs'
            ].join(' ');

            btn.dataset.answerIndex = String(ansIdx);
            btn.dataset.optionIndex = String(idx);

            const num = document.createElement('div');
            num.className =
                'w-6 h-6 flex items-center justify-center rounded-full ' +
                'bg-slate-800 text-[0.75rem]';
            num.textContent = String(idx + 1);

            const label = document.createElement('div');
            label.className = 'flex-1 flex flex-col';

            const ent = entities[opt.entityId];
            if (opt.labelTokens && opt.labelTokens.length) {
                appendTokens(label, opt.labelTokens, ent);
            } else {
                const span = document.createElement('span');
                span.textContent = opt.label || '';
                label.appendChild(span);
            }

            btn.appendChild(num);
            btn.appendChild(label);

            btn.addEventListener('click', () => {
                onSelectOption(ansIdx, idx);
            });

            optionsRow.appendChild(btn);
        });

        group.appendChild(optionsRow);
        dom.optionsContainer.appendChild(group);
    });

    if (hasMultipleParts) {
        currentAnswerGroupIndex = 0;
        maxVisibleAnswerGroupIndex = 0;
        updateAnswerGroupNavigation();
    }
}

/**
 * 指定した answers[index] に対応する本文中の穴埋めを
 * 「×誤答」「正答（下線）」の2段表示に更新する。
 */
export function updateInlineBlank(question, entitySet, answerIndex) {
    const entities = entitySet.entities || {};
    const answers = question.answers || [];
    const answer = answers[answerIndex];
    if (!answer) return;

    const placeholder = dom.questionText.querySelector(
        `[data-answer-index="${answerIndex}"]`
    );
    if (!placeholder) return;

    const correctOpt = answer.options[answer.correctIndex];
    if (!correctOpt) return;

    const correctEntity = entities[correctOpt.entityId];
    if (!correctEntity) return;

    const userIndex = answer.userSelectedIndex;
    const isCorrect = userIndex === answer.correctIndex;
    const userOpt =
        userIndex != null ? answer.options[userIndex] : null;
    const userEntity =
        userOpt && entities[userOpt.entityId] ? entities[userOpt.entityId] : null;

    placeholder.innerHTML = '';

    const stack = document.createElement('div');
    stack.className = 'flex flex-col items-start leading-tight';

    // 上段: 誤答 (×) — 正解のときは表示しない
    if (!isCorrect && userEntity) {
        const wrongLine = document.createElement('div');
        wrongLine.className =
            'text-[0.8rem] text-red-500 dark:text-red-300 mb-0.5';

        const xSpan = document.createElement('span');
        xSpan.textContent = '× ';
        wrongLine.appendChild(xSpan);

        if (answer.token.type === 'hideruby') {
            wrongLine.appendChild(renderRubyToken(answer.token, userEntity));
        } else {
            const field = answer.token.field;
            const text = field
                ? (userEntity?.[field] ?? '')
                : (userEntity?.nameEnCap ?? '');
            wrongLine.appendChild(
                createStyledSpan(text, answer.token.styles || [])
            );
        }

        stack.appendChild(wrongLine);
    }

    // 下段: 正答（下線付き）
    const correctLine = document.createElement('div');
    correctLine.className =
        'px-2 border-b border-slate-500 inline-block min-w-[2.5rem]';

    if (answer.token.type === 'hideruby') {
        correctLine.appendChild(renderRubyToken(answer.token, correctEntity));
    } else {
        const field = answer.token.field;
        const text = field
            ? (correctEntity?.[field] ?? '')
            : (correctEntity?.nameEnCap ?? '');
        correctLine.appendChild(
            createStyledSpan(text, answer.token.styles || [])
        );
    }

    stack.appendChild(correctLine);
    placeholder.appendChild(stack);
}

/**
 * 指定パーツだけボタンに正誤フィードバックを付ける。
 * - 正解: 緑
 * - ユーザー選択かつ誤答: 赤
 */
export function showOptionFeedbackForAnswer(question, answerIndex) {
    const buttons = Array.from(
        dom.optionsContainer.querySelectorAll(
            `button[data-answer-index="${answerIndex}"]`
        )
    );

    buttons.forEach((btn) => {
        const ansIdx = Number(btn.dataset.answerIndex);
        const optIdx = Number(btn.dataset.optionIndex);

        const answer = question.answers[ansIdx];
        if (!answer) return;

        const correctIndex = answer.correctIndex;
        const selectedIndex = answer.userSelectedIndex;

        btn.disabled = true;
        btn.classList.remove('hover:bg-slate-100', 'dark:hover:bg-slate-800');

        if (optIdx === correctIndex) {
            btn.classList.add(
                'border-emerald-400',
                'dark:border-emerald-400',
                'bg-emerald-50',
                'dark:bg-emerald-900/40'
            );
        }

        if (
            selectedIndex != null &&
            optIdx === selectedIndex &&
            selectedIndex !== correctIndex
        ) {
            btn.classList.add(
                'border-red-400',
                'dark:border-red-400',
                'bg-red-50',
                'dark:bg-red-900/40'
            );
        }
    });
}

/**
 * 採点後に、全 answers のボタンに正誤フィードバックを付ける。
 * - 正解: 緑
 * - ユーザー選択かつ誤答: 赤
 */
export function showOptionFeedback(question) {
    const buttons = Array.from(
        dom.optionsContainer.querySelectorAll('button[data-answer-index]')
    );

    buttons.forEach((btn) => {
        const ansIdx = Number(btn.dataset.answerIndex);
        const optIdx = Number(btn.dataset.optionIndex);

        const answer = question.answers[ansIdx];
        if (!answer) return;

        const correctIndex = answer.correctIndex;
        const selectedIndex = answer.userSelectedIndex;

        btn.disabled = true;
        btn.classList.remove('hover:bg-slate-100', 'dark:hover:bg-slate-800');

        if (optIdx === correctIndex) {
            btn.classList.add(
                'border-emerald-400',
                'dark:border-emerald-400',
                'bg-emerald-50',
                'dark:bg-emerald-900/40'
            );
        }

        if (
            selectedIndex != null &&
            optIdx === selectedIndex &&
            selectedIndex !== correctIndex
        ) {
            btn.classList.add(
                'border-red-400',
                'dark:border-red-400',
                'bg-red-50',
                'dark:bg-red-900/40'
            );
        }
    });
}

/**
 * 次のパーツ (answerIndex + 1) の選択肢グループを表示する。
 */
export function revealNextAnswerGroup(answerIndex) {
    if (totalAnswerGroups <= 1) return;

    const nextIndex = answerIndex + 1;
    if (nextIndex >= totalAnswerGroups) {
        return;
    }

    if (nextIndex > maxVisibleAnswerGroupIndex) {
        maxVisibleAnswerGroupIndex = nextIndex;
    }

    currentAnswerGroupIndex = nextIndex;
    updateAnswerGroupNavigation();
}

export function renderProgress(currentIndex, total, score) {
    const current = Math.min(currentIndex + 1, total);

    if (dom.questionCounter) {
        dom.questionCounter.textContent = `Q${current} / ${total}`;
    }

    if (dom.progressBar) {
        const ratio = total > 0 ? (current / total) * 100 : 0;
        dom.progressBar.style.width = `${ratio}%`;
    }

    if (dom.currentScore) {
        dom.currentScore.textContent = String(score);
    }
}

export function resetReviewList() {
    dom.reviewList.innerHTML = '';
    dom.reviewList.classList.add('hidden');
    dom.reviewEmpty.classList.remove('hidden');
    dom.mistakeCount.classList.add('hidden');
}

/**
 * Mistakes リストに 1 件追加する。
 * 各パーツを「Part N: ×誤答 / 正答（下線）」の2段表示で並べる。
 */
export function addReviewItem(question, entitySet, questionNumber) {
    const entities = entitySet.entities || {};
    const entity = entities[question.entityId];
    if (!entity) return;

    dom.reviewEmpty.classList.add('hidden');
    dom.reviewList.classList.remove('hidden');

    const li = document.createElement('li');
    li.className = [
        'rounded-lg border border-slate-300 dark:border-slate-700',
        'bg-white dark:bg-slate-900',
        'px-3 py-2',
        'text-xs'
    ].join(' ');

    // --- 1段目: ヘッダ + 問題文 ---
    const topRow = document.createElement('div');
    topRow.className = 'flex items-start gap-3 justify-between';

    const headerBox = document.createElement('div');
    headerBox.className = 'flex flex-col gap-1 min-w-[3.5rem]';

    const headerLine = document.createElement('div');
    headerLine.className = 'flex items-center gap-2';

    const qLabel = document.createElement('span');
    qLabel.className = 'font-semibold text-slate-800 dark:text-slate-100';
    qLabel.textContent = `Q${questionNumber}`;

    const badge = document.createElement('span');
    badge.className =
        'text-[0.7rem] px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-300 border border-red-300/60 dark:border-red-500/50';
    badge.textContent = 'Incorrect';

    headerLine.appendChild(qLabel);
    headerLine.appendChild(badge);
    headerBox.appendChild(headerLine);

    const qText = document.createElement('div');
    qText.className = 'flex-1 text-slate-700 dark:text-slate-200';
    // Mistake 表示では hideruby も含めた全文を出す
    renderQuestionText(question.patternTokens, entity, false, qText);

    topRow.appendChild(headerBox);
    topRow.appendChild(qText);
    li.appendChild(topRow);

    // --- 2段目: 各パーツの 2段表示 ---
    const bottomRow = document.createElement('div');
    bottomRow.className = 'mt-2 space-y-1 text-slate-800 dark:text-slate-100';

    (question.answers || []).forEach((answer, idx) => {
        const row = document.createElement('div');
        row.className = 'flex items-start gap-2';

        const label = document.createElement('div');
        label.className =
            'text-[0.75rem] text-slate-500 dark:text-slate-400 mt-0.5';
        label.textContent = `Part ${idx + 1}`;
        row.appendChild(label);

        const stack = document.createElement('div');
        stack.className = 'flex flex-col items-start leading-tight';

        const userIndex = answer.userSelectedIndex;
        const correctOpt = answer.options[answer.correctIndex];
        const userOpt =
            userIndex != null ? answer.options[userIndex] : null;

        const correctEntity =
            correctOpt && entities[correctOpt.entityId]
                ? entities[correctOpt.entityId]
                : null;
        const userEntity =
            userOpt && entities[userOpt.entityId]
                ? entities[userOpt.entityId]
                : null;

        const isCorrect = userIndex === answer.correctIndex;

        // 上段: 誤答
        if (!isCorrect && userEntity) {
            const wrongLine = document.createElement('div');
            wrongLine.className =
                'text-[0.8rem] text-red-500 dark:text-red-300 mb-0.5';

            const xSpan = document.createElement('span');
            xSpan.textContent = '× ';
            wrongLine.appendChild(xSpan);

            if (answer.token.type === 'hideruby') {
                wrongLine.appendChild(renderRubyToken(answer.token, userEntity));
            } else {
                const field = answer.token.field;
                const text = field
                    ? (userEntity?.[field] ?? '')
                    : (userEntity?.nameEnCap ?? '');
                wrongLine.appendChild(
                    createStyledSpan(text, answer.token.styles || [])
                );
            }

            stack.appendChild(wrongLine);
        }

        // 下段: 正答
        if (correctEntity) {
            const correctLine = document.createElement('div');
            correctLine.className =
                'px-2 border-b border-slate-500 inline-block min-w-[2.5rem]';

            if (answer.token.type === 'hideruby') {
                correctLine.appendChild(
                    renderRubyToken(answer.token, correctEntity)
                );
            } else {
                const field = answer.token.field;
                const text = field
                    ? (correctEntity?.[field] ?? '')
                    : (correctEntity?.nameEnCap ?? '');
                correctLine.appendChild(
                    createStyledSpan(text, answer.token.styles || [])
                );
            }

            stack.appendChild(correctLine);
        }

        row.appendChild(stack);
        bottomRow.appendChild(row);
    });

    li.appendChild(bottomRow);
    dom.reviewList.appendChild(li);

    const count = dom.reviewList.children.length;
    dom.mistakeCount.textContent = String(count);
    dom.mistakeCount.classList.remove('hidden');
}

export function resetTips() {
    if (!dom.tipContainer) return;

    dom.tipContainer.innerHTML = '';
}

export function renderTips(tips, entity, isCorrect) {
    if (!dom.tipContainer) return;

    resetTips();

    if (!Array.isArray(tips) || tips.length === 0) {
        return;
    }

    const visibleTips = tips.filter((tip) => isTipVisible(tip, isCorrect));
    if (!visibleTips.length) {
        return;
    }

    const header = document.createElement('div');
    header.className = 'font-semibold text-slate-800 dark:text-slate-100';
    header.textContent = 'Tips';
    dom.tipContainer.appendChild(header);

    visibleTips.forEach((tip) => {
        const row = document.createElement('div');
        row.className = 'flex items-start gap-2';

        const bullet = document.createElement('span');
        bullet.className = 'mt-0.5 select-none';
        bullet.textContent = '•';

        const body = document.createElement('div');
        body.className = 'space-x-1 space-y-1 leading-relaxed';
        appendTokens(body, tip.tokens || [], entity);

        row.appendChild(bullet);
        row.appendChild(body);
        dom.tipContainer.appendChild(row);
    });
}
