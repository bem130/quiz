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

// 誤答表示用に、ruby 全体と rt を少し小さくする
function shrinkRubyForWrong(rubyEl) {
    if (!rubyEl) return rubyEl;

    // 行全体を少し小さく
    rubyEl.style.fontSize = '0.9em';

    const rt = rubyEl.querySelector('rt');
    if (rt) {
        // ルビ部分はさらに小さく
        rt.style.fontSize = '0.6em';
    }

    return rubyEl;
}

// 下線だけの穴埋めプレースホルダ（answers[n] に対応）
function createBlankPlaceholder(answerIndex) {
    const wrapper = document.createElement('span');
    wrapper.dataset.answerIndex = String(answerIndex);
    wrapper.className = 'relative inline-block mx-1 align-baseline';

    const underline = document.createElement('span');
    underline.className =
        'block px-2 border-b border-slate-500 min-w-[2.5rem]';
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
 * 1つの選択肢ボタンを作る。
 * - token.type === 'hideruby' → ルビ
 * - token.type === 'hide'     → token.field を KaTeX / テキストで表示
 */
function createOptionButton(answerIndex, optionIndex, answer, entity, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = [
        'w-full text-left px-3 py-2 rounded-xl border text-xs transition-colors',
        'bg-white dark:bg-slate-900',
        'border-slate-300 dark:border-slate-700',
        'text-slate-800 dark:text-slate-100',
        'hover:bg-slate-100 dark:hover:bg-slate-800'
    ].join(' ');

    const wrapper = document.createElement('div');
    wrapper.className = 'flex items-center gap-2';

    const label = document.createElement('span');
    label.textContent = String(optionIndex + 1);
    label.className = [
        'inline-flex items-center justify-center',
        'w-5 h-5 rounded-full border',
        'border-slate-300 dark:border-slate-600',
        'text-[0.75rem] text-slate-500 dark:text-slate-300'
    ].join(' ');

    let content;
    if (answer.token.type === 'hideruby') {
        content = renderRubyToken(answer.token, entity);
    } else {
        // hide / その他: token.field を使って表示
        const field = answer.token.field;
        const text = field ? (entity?.[field] ?? '') : (entity?.nameEnCap ?? '');
        content = createStyledSpan(text, answer.token.styles || []);
    }

    wrapper.appendChild(label);
    wrapper.appendChild(content);
    btn.appendChild(wrapper);

    btn.dataset.answerIndex = String(answerIndex);
    btn.dataset.optionIndex = String(optionIndex);

    btn.addEventListener('click', onClick);
    return btn;
}

/**
 * optionsContainer に、answers[] すべての選択肢を描画する。
 * answer ごとにグループを作って縦に並べる。
 * 複数パーツがある場合、最初のパーツ以外は非表示 (hidden) からスタート。
 */
export function renderOptions(question, entitySet, onSelectOption) {
    const entities = entitySet.entities || {};
    dom.optionsContainer.innerHTML = '';

    (question.answers || []).forEach((answer, ansIdx) => {
        const group = document.createElement('div');
        group.className = 'mb-2 space-y-1';
        group.dataset.answerIndex = String(ansIdx);

        if (ansIdx > 0) {
            group.classList.add('hidden');
        }

        if (question.answers.length > 1) {
            const groupLabel = document.createElement('div');
            groupLabel.className =
                'text-[0.7rem] text-slate-500 dark:text-slate-400';
            groupLabel.textContent = `Part ${ansIdx + 1}`;
            group.appendChild(groupLabel);
        }

        (answer.options || []).forEach((opt, optIdx) => {
            const ent = entities[opt.entityId];
            if (!ent) return;

            const btn = createOptionButton(ansIdx, optIdx, answer, ent, () => {
                onSelectOption(ansIdx, optIdx);
            });

            group.appendChild(btn);
        });

        dom.optionsContainer.appendChild(group);
    });
}

/**
 * 1つの穴埋め（answers[answerIndex]）に対して
 * 「正答（上・下線つき） → 誤答（下・小さめ赤文字）」を表示する。
 *
 * rootElement:
 *   - 本編の問題文 → dom.questionText
 *   - ミス一覧（Mistakes）用 → addReviewItem 内で渡される qText
 *
 * Mistakes では正答を青緑色で強調する。
 */
export function updateInlineBlank(
    question,
    entitySet,
    answerIndex,
    rootElement = dom.questionText
) {
    const entities = entitySet.entities || {};
    const answers = question.answers || [];
    const answer = answers[answerIndex];
    if (!answer) return;

    const placeholder = rootElement.querySelector(
        `[data-answer-index="${answerIndex}"]`
    );
    if (!placeholder) return;

    const correctOpt = answer.options?.[answer.correctIndex];
    if (!correctOpt) return;

    const correctEntity = entities[correctOpt.entityId];
    if (!correctEntity) return;

    const userIndex = answer.userSelectedIndex;
    const isCorrect = userIndex === answer.correctIndex;

    const userOpt =
        userIndex != null ? answer.options[userIndex] : null;
    const userEntity =
        userOpt && entities[userOpt.entityId] ? entities[userOpt.entityId] : null;

    // Mistakes（復習画面）かどうか
    const isReviewContext = rootElement !== dom.questionText;

    // プレースホルダを縦積み構造にリセット
    placeholder.innerHTML = '';
    placeholder.className =
        'inline-flex flex-col items-start mx-1 align-baseline leading-tight';

    // ------------------------------
    // 上段：正答（下線つき）
    // ------------------------------
    const correctLine = document.createElement('span');
    correctLine.className =
        'block px-2 border-b border-slate-500 min-w-[2.5rem] whitespace-nowrap';

    if (isReviewContext) {
        // Mistakes では強調表示（青緑色）
        correctLine.classList.add('text-emerald-300', 'dark:text-emerald-200');
    }

    if (answer.token.type === 'hideruby') {
        const rubyEl = renderRubyToken(answer.token, correctEntity);
        correctLine.appendChild(rubyEl);
    } else {
        const field = answer.token.field;
        const text = field
            ? (correctEntity?.[field] ?? '')
            : (correctEntity?.nameEnCap ?? '');
        correctLine.appendChild(
            createStyledSpan(text, answer.token.styles || [])
        );
    }

    placeholder.appendChild(correctLine);

    // ------------------------------
    // 下段：誤答（小さめ赤文字）※誤答のときだけ
    // ------------------------------
    if (!isCorrect && userEntity) {
        const wrongLine = document.createElement('span');
        wrongLine.className =
            'mt-0.5 text-[0.7rem] text-rose-400 dark:text-rose-300 ' +
            'flex items-center gap-1 whitespace-nowrap';

        const mark = document.createElement('span');
        mark.textContent = '×';
        wrongLine.appendChild(mark);

        if (answer.token.type === 'hideruby') {
            const rubyWrong = renderRubyToken(answer.token, userEntity);
            shrinkRubyForWrong(rubyWrong); // ルビを小さくする
            wrongLine.appendChild(rubyWrong);
        } else {
            const field = answer.token.field;
            const text = field
                ? (userEntity?.[field] ?? '')
                : (userEntity?.nameEnCap ?? '');
            const span = createStyledSpan(text, answer.token.styles || []);
            span.style.fontSize = '0.85em';
            wrongLine.appendChild(span);
        }

        placeholder.appendChild(wrongLine);
    }
}

/**
 * 1つのパート（answers[answerIndex]）に対して選択肢の正誤フィードバックを表示する。
 * - 正答 → 緑
 * - 選択した誤答 → 赤
 * - このパートの選択肢はロックされる（再選択不可）
 */
export function showOptionFeedbackForAnswer(question, answerIndex) {
    const answer = (question.answers || [])[answerIndex];
    if (!answer) return;

    const buttons = Array.from(
        dom.optionsContainer.querySelectorAll(
            `button[data-answer-index="${answerIndex}"]`
        )
    );

    const correctIndex = answer.correctIndex;
    const selectedIndex = answer.userSelectedIndex;

    buttons.forEach((btn) => {
        const optIdx = Number(btn.dataset.optionIndex);

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
 * 全パートの選択肢に対して最終的な正誤フィードバックを適用する。
 * - 正答 → 緑
 * - 選択した誤答 → 赤
 * 全ボタンがロックされる。
 */
export function showOptionFeedback(question) {
    const buttons = Array.from(
        dom.optionsContainer.querySelectorAll('button[data-answer-index]')
    );

    buttons.forEach((btn) => {
        const ansIdx = Number(btn.dataset.answerIndex);
        const optIdx = Number(btn.dataset.optionIndex);

        const answer = (question.answers || [])[ansIdx];
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
    const nextGroup = dom.optionsContainer.querySelector(
        `div[data-answer-index="${answerIndex + 1}"]`
    );
    if (nextGroup) {
        nextGroup.classList.remove('hidden');
    }
}

export function renderProgress(currentIndex, total, score) {
    dom.currentQNum.textContent = String(currentIndex + 1);
    dom.totalQNum.textContent = String(total);
    dom.currentScore.textContent = String(score);
}

export function resetReviewList() {
    dom.reviewList.innerHTML = '';
    dom.reviewList.classList.add('hidden');
    dom.reviewEmpty.classList.remove('hidden');
    dom.mistakeCount.classList.add('hidden');
}

/**
 * Mistakes（誤答一覧）に 1 問追加する。
 *
 * ・問題文を「穴埋めつき」で描画
 * ・その直後に updateInlineBlank を使い、
 *   正答（青緑）＋誤答（小さく赤）を埋め込む
 * ・“Your wrong answers” などの追加見出しは付けない
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

    // --- 上段：Q番号・Incorrect バッジ・問題文 ---
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
        'text-[0.7rem] px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 ' +
        'dark:text-red-300 border border-red-300/60 dark:border-red-500/50';
    badge.textContent = 'Incorrect';

    headerLine.appendChild(qLabel);
    headerLine.appendChild(badge);
    headerBox.appendChild(headerLine);

    // 穴埋め用のコンテナ
    const qText = document.createElement('div');
    qText.className = 'flex-1 text-slate-700 dark:text-slate-200';

    // まず穴埋めプレースホルダを描画
    renderQuestionText(question.patternTokens, entity, true, qText);

    // 各穴に「正答（青緑）＋誤答（赤）」を適用
    (question.answers || []).forEach((_, idx) => {
        updateInlineBlank(question, entitySet, idx, qText);
    });

    topRow.appendChild(headerBox);
    topRow.appendChild(qText);
    li.appendChild(topRow);

    dom.reviewList.appendChild(li);

    // ミス数を更新
    const count = dom.reviewList.children.length;
    dom.mistakeCount.textContent = String(count);
    dom.mistakeCount.classList.remove('hidden');
}

export function resetTips() {
    if (!dom.tipContainer) return;

    dom.tipContainer.innerHTML = '';
    dom.tipContainer.classList.add('hidden');
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

    dom.tipContainer.classList.remove('hidden');
}
