// js/menu-renderer.js
import { dom } from './dom-refs.js';

function createCapacityElement(status, capacityValue, context) {
    if (!status) {
        return null;
    }

    const text = document.createElement('div');
    if (status === 'pending') {
        text.className = 'mt-0.5 text-[11px] text-slate-500 dark:text-slate-400';
        text.textContent = 'Calculating questions...';
        return text;
    }

    if (status === 'done') {
        text.className = 'mt-0.5 text-[11px] text-slate-500 dark:text-slate-400';
        if (capacityValue && capacityValue > 0) {
            text.textContent = context === 'entry'
                ? `~${capacityValue} questions available`
                : `~${capacityValue} questions`;
        } else {
            text.textContent = context === 'entry'
                ? 'No questions available in this entry.'
                : 'No questions in this quiz.';
        }
        return text;
    }

    if (status === 'error') {
        text.className = 'mt-0.5 text-[11px] text-rose-600 dark:text-rose-300';
        text.textContent = 'Failed to estimate questions.';
        return text;
    }

    return null;
}

/**
 * エントリ一覧を描画する。
 * @param {Array<object>} entrySources - EntrySource 配列。
 * @param {object|null} currentEntry - 現在選択中のエントリ。
 */
export function renderEntryMenu(entrySources, currentEntry) {
    if (!dom.entryList) return;
    dom.entryList.innerHTML = '';

    const list = Array.isArray(entrySources) ? entrySources : [];
    if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'text-xs text-slate-500 dark:text-slate-400';
        empty.textContent = 'No entries available.';
        dom.entryList.appendChild(empty);
        return;
    }

    list.forEach((entry) => {
        const isCurrent = currentEntry && currentEntry.url === entry.url;
        const wrapper = document.createElement('div');
        wrapper.className = 'relative';

        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.entryUrl = entry.url;
        button.className = [
            'w-full text-left rounded-xl border px-3 py-2 transition-colors',
            'bg-white dark:bg-slate-900',
            isCurrent
                ? 'border-emerald-400 dark:border-emerald-400 shadow-sm'
                : 'border-slate-300 dark:border-slate-700 hover:border-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800'
        ].join(' ');

        const title = document.createElement('div');
        title.className = 'flex items-center gap-2';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'font-semibold text-sm';
        labelSpan.textContent = entry.label || entry.url;

        const status = document.createElement('span');
        status.className = 'text-[11px] font-semibold';
        if (entry.available) {
            status.classList.add('text-emerald-600', 'dark:text-emerald-300');
            status.textContent = '✓ Available';
        } else {
            status.classList.add('text-rose-500', 'dark:text-rose-300');
            status.textContent = '× Unavailable';
        }

        title.appendChild(labelSpan);
        if (entry.temporary) {
            const tempBadge = document.createElement('span');
            tempBadge.className = [
                'ml-2 inline-flex items-center rounded-full px-1.5 py-0.5',
                'text-[10px] bg-amber-100 text-amber-700',
                'dark:bg-amber-900/40 dark:text-amber-300'
            ].join(' ');
            tempBadge.textContent = 'Temporary';
            title.appendChild(tempBadge);
        }
        title.appendChild(status);

        const urlText = document.createElement('div');
        urlText.className = 'text-[11px] text-slate-500 dark:text-slate-400 break-all';
        urlText.textContent = entry.url;

        button.appendChild(title);
        button.appendChild(urlText);

        const capacity = createCapacityElement(entry._capacityStatus, entry._capacity, 'entry');
        if (capacity) {
            button.appendChild(capacity);
        }

        if (!entry.available && entry.errorMessage) {
            const error = document.createElement('div');
            error.className = 'mt-1 text-[11px] text-rose-600 dark:text-rose-300';
            error.textContent = entry.errorMessage;
            button.appendChild(error);
        }

        wrapper.appendChild(button);

        if (entry.temporary) {
            const addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.dataset.addUrl = entry.url;
            addButton.className = [
                'absolute bottom-2 right-2 text-[11px] font-semibold',
                'text-emerald-600 hover:text-emerald-700',
                'dark:text-emerald-300 dark:hover:text-emerald-100'
            ].join(' ');
            addButton.textContent = 'Add entry';
            wrapper.appendChild(addButton);
        }

        if (!entry.builtIn) {
            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.dataset.removeUrl = entry.url;
            removeButton.className = 'absolute top-2 right-2 text-[11px] text-slate-500 hover:text-rose-500';
            removeButton.textContent = 'Remove';
            wrapper.appendChild(removeButton);
        }

        dom.entryList.appendChild(wrapper);
    });
}

/**
 * クイズ一覧をサイドメニューに描画し、選択状態を示す。
 * @param {Array<object>} entries - 表示するクイズエントリの配列。
 * @param {object|null} currentQuiz - 現在選択中のクイズエントリ。
 */
export function renderQuizMenu(entries, currentQuiz) {
    dom.quizList.innerHTML = '';

    const list = Array.isArray(entries) ? entries : [];
    if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'text-xs text-slate-500 dark:text-slate-400';
        empty.textContent = 'No quizzes for this entry.';
        dom.quizList.appendChild(empty);
        return;
    }

    list.forEach((entry) => {
        const isCurrent = currentQuiz && currentQuiz.id === entry.id;
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.quizId = entry.id;
        button.className = [
            'w-full text-left rounded-xl border px-3 py-2 text-xs transition-colors',
            isCurrent
                ? 'border-emerald-400 dark:border-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-100'
                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:border-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800'
        ].join(' ');

        const title = document.createElement('div');
        title.className = 'font-semibold mb-0.5';
        title.textContent = entry.title || entry.id;

        const desc = document.createElement('div');
        desc.className =
            'text-[11px] text-slate-600 dark:text-slate-300';
        desc.textContent = entry.description || '';

        button.appendChild(title);
        button.appendChild(desc);

        const capacity = createCapacityElement(entry._capacityStatus, entry._capacity, 'quiz');
        if (capacity) {
            button.appendChild(capacity);
        }

        dom.quizList.appendChild(button);
    });
}
