// js/menu-renderer.js
import { dom } from './dom-refs.js';
import { getQuizNameFromLocation } from './config.js';

export function renderQuizMenu(entries) {
    const currentQuiz = getQuizNameFromLocation();
    dom.quizList.innerHTML = '';

    entries.forEach(entry => {
        const isCurrent = entry.id === currentQuiz;
        const a = document.createElement('a');
        a.href = `?quiz=${encodeURIComponent(entry.id)}`;

        a.className = [
            'block rounded-xl border px-3 py-2 text-xs transition-colors',
            isCurrent
                ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-100'
                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:border-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800'
        ].join(' ');

        a.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex flex-col">
                    <span class="font-semibold">${entry.title}</span>
                    ${
                        entry.description
                            ? `<span class="text-[0.8rem] text-slate-500 dark:text-slate-400">${entry.description}</span>`
                            : ''
                    }
                </div>
                <div class="ml-3 text-[0.7rem] text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    ${entry.id}
                </div>
            </div>
        `;
        dom.quizList.appendChild(a);
    });
}
