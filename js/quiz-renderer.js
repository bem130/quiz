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
            ? (entity[base.field] ?? '')
            : (base.value ?? '');

    const rubyText =
        ruby.source === 'key'
            ? (entity[ruby.field] ?? '')
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
            const value = entity[token.field] ?? '';
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
 * @param {*} hiderubyToken 
 * @param {*} entity 
 * @param {number} index option index (0-based)
 * @param {*} onClick 
 * @returns {HTMLButtonElement}
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

export function addReviewItem(question, entitySet, questionNumber) {
    const entities = entitySet.entities || {};
    const entity = entities[question.entityId];
    if (!entity) return;

    // 最初のミスなら「No mistakes yet.」を消す
    dom.reviewEmpty.classList.add('hidden');
    dom.reviewList.classList.remove('hidden');

    const li = document.createElement('li');
    li.className = [
        'rounded-lg border border-slate-300 dark:border-slate-700',
        'bg-white dark:bg-slate-900',
        'px-3 py-2',
        'text-xs',
        'space-y-1'
    ].join(' ');

    const header = document.createElement('div');
    header.className = 'flex justify-between items-center';

    const qLabel = document.createElement('span');
    qLabel.className = 'font-semibold text-slate-800 dark:text-slate-100';
    qLabel.textContent = `Q${questionNumber}`;

    header.appendChild(qLabel);
    li.appendChild(header);

    // 問題文（hide/hideruby も含めて再表示）
    const qText = document.createElement('div');
    qText.className = 'text-slate-700 dark:text-slate-200';
    renderQuestionText(question.patternTokens, entity, false, qText);
    li.appendChild(qText);

    dom.reviewList.appendChild(li);

    // カウンタ更新
    const count = dom.reviewList.children.length;
    dom.mistakeCount.textContent = String(count);
    dom.mistakeCount.classList.remove('hidden');
}
