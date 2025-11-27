// js/entry-model.js
import { ENTRY_JSON_PATH, ENTRY_JSON_FALLBACK_PATH } from './config.js';

export async function loadQuizEntries() {
    const primary = await fetchEntries(ENTRY_JSON_PATH);
    if (primary !== null) {
        return primary;
    }

    console.log("Falling back to secondary entry data source.");
    const fallback = await fetchEntries(ENTRY_JSON_FALLBACK_PATH);
    if (fallback !== null) {
        return fallback;
    }

    throw new Error('Failed to load entry data');
}

async function fetchEntries(path) {
    try {
        const res = await fetch(path);
        if (!res.ok) {
            return null;
        }
        const json = await res.json();
        return json.quizzes || [];
    } catch (error) {
        return null;
    }
}
