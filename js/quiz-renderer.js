// js/quiz-renderer.js
import { dom } from './dom-refs.js';

function createStyledSpan(text, styles = []) {
    const span = document.createElement('span');

    // KaTeX
    if (styles.includes('katex') && window.katex) {
        try {
            window.katex.render(text, span, {
                throwOnError: false,
                strict: false
            });
            return span;
        } catch (e) {
            // fall through to plain text
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
    // rem ベースの小さい文字（スケールに追従）
    rt.classList.add('text-[0.65rem]');
    rt.appendChild(rtSpan);

    rubyEl.appendChild(rb);
    rubyEl.appendChild(rt);

    return rubyEl;
}

// targetElement を指定できるようにしておく（mistake 用でも再利用）
export function renderQuestionText(
    patternTokens,
    entity,
    skipAnswerTokens = true,
    targetElement = dom.questionText
) {
    targetElement.innerHTML = '';

    patternTokens.forEach((token) => {
        if (!token || !token.type) return;

        // hideruby は選択肢専用にして、通常の問題文には出さない
        if (skipAnswerTokens && token.type === 'hideruby') {
            return;
        }

        if (token.type === 'text') {
            const span = createStyledSpan(token.value ?? '', token.styles || []);
            targetElement.appendChild(span);
        } else if (token.type === 'key') {
            const value = entity?.[token.field] ?? '';
            const span = createStyledSpan(value, token.styles || []);
            targetElement.appendChild(span);
        } else if (token.type === 'ruby') {
            const rubyEl = renderRubyToken(token, entity);
            targetElement.appendChild(rubyEl);
        } else if (token.type === 'hide') {
            const span = createStyledSpan('____', token.styles || []);
            span.classList.add('px-2', 'border-b', 'border-slate-500');
            targetElement.appendChild(span);
        }
    });
}

/**
 * Create option button with numeric label (1–4) and ruby text.
 */
function createRubyOptionButton(hiderubyToken, entity, index, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = [
        'w-full text-left px-3 py-2 rounded-xl border text-xs transition-colors',
        'bg-white dark:bg-slate-900',
        'border-slate-300 dark:border-slate-700',
        'text-slate-800 dark:text-slate-100',
        'hover:bg-slate-100 dark:hover:bg-slate-800'
    ].join(' ');

    // Wrapper for label + ruby text
    const wrapper = document.createElement('div');
    wrapper.className = 'flex items-center gap-2';

    // Numeric label (1–4)
    const label = document.createElement('span');
    label.textContent = String(index + 1);
    label.className = [
        'inline-flex items-center justify-center',
        'w-5 h-5 rounded-full border',
        'border-slate-300 dark:border-slate-600',
        'text-[0.75rem] text-slate-500 dark:text-slate-300'
    ].join(' ');

    const rubyEl = renderRubyToken(hiderubyToken, entity);

    wrapper.appendChild(label);
    wrapper.appendChild(rubyEl);

    btn.appendChild(wrapper);
    btn.addEventListener('click', onClick);
    return btn;
}

export function renderOptions(question, entitySet, onSelectOption) {
    const entities = entitySet.entities || {};
    dom.optionsContainer.innerHTML = '';

    question.answer.options.forEach((opt, idx) => {
        const ent = entities[opt.entityId];
        const btn = createRubyOptionButton(
            question.answer.hiderubyToken,
            ent,
            idx,
            () => {
                onSelectOption(idx);
            }
        );
        btn.dataset.index = String(idx);
        dom.optionsContainer.appendChild(btn);
    });
}

export function showOptionFeedback(question, selectedIndex) {
    const buttons = Array.from(dom.optionsContainer.querySelectorAll('button'));
    const correctIndex = question.answer.correctIndex;

    buttons.forEach((btn, idx) => {
        btn.disabled = true;
        btn.classList.remove('hover:bg-slate-100', 'dark:hover:bg-slate-800');

        if (idx === correctIndex) {
            btn.classList.add(
                'border-emerald-400',
                'dark:border-emerald-400',
                'bg-emerald-50',
                'dark:bg-emerald-900/40'
            );
        }
        if (idx === selectedIndex && idx !== correctIndex) {
            btn.classList.add(
                'border-red-400',
                'dark:border-red-400',
                'bg-red-50',
                'dark:bg-red-900/40'
            );
        }
    });
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
 * Mistakes リストに 1 件追加する（2段構成）
 * 1段目: [Q4 Incorrect] | [Question text...]
 * 2段目: [Your answer ...] | [Correct ...]
 */
export function addReviewItem(question, entitySet, questionNumber, selectedIndex) {
    const entities = entitySet.entities || {};
    const entity = entities[question.entityId];
    if (!entity) return;

    const options = question.answer.options || [];
    const correctIndex = question.answer.correctIndex;

    const selectedOpt = options[selectedIndex];
    const correctOpt = options[correctIndex];

    const selectedEntity = selectedOpt ? entities[selectedOpt.entityId] : null;
    const correctEntity = correctOpt ? entities[correctOpt.entityId] : null;

    // 最初のミスなら「No mistakes yet.」を消す
    dom.reviewEmpty.classList.add('hidden');
    dom.reviewList.classList.remove('hidden');

    const li = document.createElement('li');
    li.className = [
        'rounded-lg border border-slate-300 dark:border-slate-700',
        'bg-white dark:bg-slate-900',
        'px-3 py-2',
        'text-xs'
    ].join(' ');

    /* --- 1段目: ヘッダ + 問題文（横並び） --- */
    const topRow = document.createElement('div');
    topRow.className = 'flex items-start gap-3 justify-between';

    // 左側: Q4 + Incorrect
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

    // 右側: 問題文（flex-1 で広く取る）
    const qText = document.createElement('div');
    qText.className = 'flex-1 text-slate-700 dark:text-slate-200';
    renderQuestionText(question.patternTokens, entity, false, qText);

    topRow.appendChild(headerBox);
    topRow.appendChild(qText);
    li.appendChild(topRow);

    /* --- 2段目: Your answer / Correct（横並び） --- */
    const bottomRow = document.createElement('div');
    bottomRow.className = 'mt-2 flex flex-wrap gap-4';

    if (selectedEntity) {
        const yourCol = document.createElement('div');
        yourCol.className = 'flex-1 min-w-[8rem]';

        const label = document.createElement('div');
        label.className =
            'text-[0.7rem] uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0.5';
        label.textContent = 'Your answer';

        const rubyBox = document.createElement('div');
        rubyBox.className = 'text-slate-800 dark:text-slate-100';
        const rubyEl = renderRubyToken(question.answer.hiderubyToken, selectedEntity);
        rubyBox.appendChild(rubyEl);

        yourCol.appendChild(label);
        yourCol.appendChild(rubyBox);
        bottomRow.appendChild(yourCol);
    }

    if (correctEntity) {
        const correctCol = document.createElement('div');
        correctCol.className = 'flex-1 min-w-[8rem]';

        const label = document.createElement('div');
        label.className =
            'text-[0.7rem] uppercase tracking-wide text-emerald-600 dark:text-emerald-300 mb-0.5';
        label.textContent = 'Correct';

        const rubyBox = document.createElement('div');
        rubyBox.className = 'text-slate-800 dark:text-slate-100';
        const rubyEl = renderRubyToken(question.answer.hiderubyToken, correctEntity);
        rubyBox.appendChild(rubyEl);

        correctCol.appendChild(label);
        correctCol.appendChild(rubyBox);
        bottomRow.appendChild(correctCol);
    }

    li.appendChild(bottomRow);

    dom.reviewList.appendChild(li);

    // カウンタ更新
    const count = dom.reviewList.children.length;
    dom.mistakeCount.textContent = String(count);
    dom.mistakeCount.classList.remove('hidden');
}
