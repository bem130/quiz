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
            'block p-3 rounded-xl border text-xs',
            isCurrent
                ? 'border-emerald-400 bg-emerald-950/40'
                : 'border-slate-700 hover:border-emerald-400 hover:bg-slate-800/60'
        ].join(' ');

        a.innerHTML = `
            <div class="flex items-center justify-between gap-2">
                <div>
                    <div class="font-semibold">
                        ${entry.title}
                        ${isCurrent ? '<span class="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">Current</span>' : ''}
                    </div>
                    <div class="mt-0.5 text-[10px] text-slate-400">
                        ${entry.description}
                    </div>
                </div>
                <div class="text-[10px] text-slate-500 text-right">
                    ${entry.difficulty || ''}
                </div>
            </div>
        `;
        dom.quizList.appendChild(a);
    });
}
