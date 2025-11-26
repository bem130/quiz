// js/entry-model.js
import { ENTRY_JSON_PATH } from './config.js';

export async function loadQuizEntries() {
    const res = await fetch(ENTRY_JSON_PATH);
    if (!res.ok) {
        throw new Error('Failed to load entry.json');
    }
    const json = await res.json();
    return json.quizzes || [];
}
