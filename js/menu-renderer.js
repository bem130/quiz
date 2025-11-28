// js/menu-renderer.js
import { dom } from './dom-refs.js';
import { getQuizNameFromLocation } from './config.js';

/**
 * クイズ一覧をサイドメニューに描画し、URL パラメータと整合した選択状態を示す。
 */
export function renderQuizMenu(entries) {
    const requested = getQuizNameFromLocation();
    let currentQuiz = requested || null;

    if (Array.isArray(entries) && entries.length > 0) {
        const hasRequested =
            requested && entries.some((entry) => entry && entry.id === requested);
        if (!hasRequested) {
            currentQuiz = entries[0].id; // URL なし or 不正なら先頭をデフォルト
        }
    }

    console.log(
        '[menu] renderQuizMenu entries length =',
        Array.isArray(entries) ? entries.length : 'not array'
    );
    console.log('[menu] currentQuiz (requested / resolved) =', currentQuiz);

    dom.quizList.innerHTML = '';

    entries.forEach((entry) => {
        const isCurrent = currentQuiz && entry.id === currentQuiz;
        const a = document.createElement('a');
        a.href = `?quiz=${encodeURIComponent(entry.id)}`;

        a.className = [
            'block rounded-xl border px-3 py-2 text-xs transition-colors',
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

        a.appendChild(title);
        a.appendChild(desc);

        dom.quizList.appendChild(a);
    });
}
