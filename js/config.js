// js/config.js

// Get quiz name from URL ?quiz=...
export function getQuizNameFromLocation() {
    const params = new URLSearchParams(window.location.search);
    const quiz = params.get('quiz');
    return quiz || 'amino-acids-v1';
}

// Resolve quiz JSON path from quizName
export function resolveQuizJsonPath(quizName) {
    return `data/quizzes/${quizName}.json`;
}

// Path to entry generator (quiz list)
export const ENTRY_JSON_PATH = 'entry.php';
