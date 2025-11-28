// js/config.js

// Get quiz name from URL ?quiz=...
export function getQuizNameFromLocation() {
    const params = new URLSearchParams(window.location.search);
    const quiz = params.get('quiz');

    console.log('[quiz] window.location.search =', window.location.search);
    console.log('[quiz] raw quiz param =', quiz);

    // ★ ここではデフォルトを決めない
    // デフォルトの ID は「エントリ一覧(entries)」を見て決める
    return quiz;  // null のままで OK
}

// Resolve quiz JSON path from quizName
export function resolveQuizJsonPath(quizName) {
    return `data/quizzes/${quizName}.json`;
}

// Resolve quiz JSON path from entry data
export function resolveQuizJsonFromEntry(entry) {
    if (!entry) {
        return null;
    }

    if (typeof entry.dir === 'string' && entry.id) {
        const trimmed = entry.dir.replace(/\/+$/, '');
        return `${trimmed}/${entry.id}.json`;
    }

    if (typeof entry.file === 'string') {
        return entry.file;
    }

    return null;
}

// Path to entry generator (quiz list)
export const ENTRY_JSON_PATH = 'entry.php';
export const ENTRY_JSON_FALLBACK_PATH = 'data/entry.json';
