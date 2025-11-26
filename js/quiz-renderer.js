// js/quiz-renderer.js
import { dom } from './dom-refs.js';

function createStyledSpan(text, styles = []) {
    const span = document.createElement('span');
    span.textContent = text;

    if (styles.includes('bold')) {
        span.classList.add('font-semibold');
    }
    if (styles.includes('italic')) {
        span.classList.add('italic');
    }
    if (styles.includes('serif')) {
        span.classList.add('font-serif');
    }
    if (styles.includes('sans')) {
        span.classList.add('font-sans');
    }
    if (styles.includes('katex')) {
        span.textContent = '';
        try {
            // window.katex provided by CDN
            window.katex.render(text, span, { throwOnError: false });
        } catch (e) {
            span.textContent = text;
        }
    }

    return span;
}

function renderRubyToken(token, entity) {
    const base = token.base;
    const ruby = token.ruby;

    const baseText = base.source === 'key'
        ? (entity[base.field] ?? '')
        : (base.value ?? '');
    const rubyText = ruby.source === 'key'
        ? (entity[ruby.field] ?? '')
        : (ruby.value ?? '');

    const rubyEl = document.createElement('ruby');

    const rb = createStyledSpan(baseText, base.styles || []);
    const rtSpan = createStyledSpan(rubyText, ruby.styles || []);
    const rt = document.createElement('rt');
    rt.classList.add('text-[10px]');
    rt.appendChild(rtSpan);

    rubyEl.appendChild(rb);
    rubyEl.appendChild(rt);

    return rubyEl;
}

export function renderQuestionText(patternTokens, entity, skipAnswerTokens = true) {
    dom.questionText.innerHTML = '';
    if (!patternTokens) return;

    patternTokens.forEach(token => {
        if (!token) return;
        if (skipAnswerTokens && token.type === 'hideruby') {
            // question text には表示せず、選択肢だけで使う
            return;
        }

        if (token.type === 'text') {
            const span = createStyledSpan(token.value ?? '', token.styles || []);
            dom.questionText.appendChild(span);
        } else if (token.type === 'key') {
            const value = entity[token.field] ?? '';
            const span = createStyledSpan(value, token.styles || []);
            dom.questionText.appendChild(span);
        } else if (token.type === 'ruby') {
            const rubyEl = renderRubyToken(token, entity);
            dom.questionText.appendChild(rubyEl);
        } else if (token.type === 'hide') {
            // ここでは 4択クイズなので、単純に空欄風に表示
            const span = createStyledSpan('____', token.styles || []);
            span.classList.add('px-2', 'border-b', 'border-slate-500');
            dom.questionText.appendChild(span);
        }
    });
}

function createRubyOptionButton(hiderubyToken, entity, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'w-full text-left px-3 py-2 rounded-xl border border-slate-700 bg-slate-900 hover:border-emerald-400 text-sm';

    const rubyEl = renderRubyToken(hiderubyToken, entity);
    btn.appendChild(rubyEl);

    btn.addEventListener('click', onClick);

    return btn;
}

export function renderOptions(question, entitySet, onSelectOption) {
    const entities = entitySet.entities || {};
    dom.optionsContainer.innerHTML = '';

    question.answer.options.forEach((opt, idx) => {
        const ent = entities[opt.entityId];
        const btn = createRubyOptionButton(question.answer.hiderubyToken, ent, () => {
            onSelectOption(idx);
        });
        btn.dataset.index = String(idx);
        dom.optionsContainer.appendChild(btn);
    });
}

export function showOptionFeedback(question, selectedIndex) {
    const correctIndex = question.answer.correctIndex;
    const buttons = Array.from(dom.optionsContainer.querySelectorAll('button'));

    buttons.forEach((btn, idx) => {
        btn.disabled = true;
        btn.classList.remove('hover:border-emerald-400');
        if (idx === correctIndex) {
            btn.classList.add('border-emerald-400', 'bg-emerald-900/40');
        }
        if (idx === selectedIndex && idx !== correctIndex) {
            btn.classList.add('border-red-400', 'bg-red-900/40');
        }
    });
}

export function renderProgress(currentIndex, total, score) {
    dom.currentQNum.textContent = String(currentIndex + 1);
    dom.totalQNum.textContent = String(total);
    dom.currentScore.textContent = String(score);
}
