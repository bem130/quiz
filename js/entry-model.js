// js/entry-model.js
import { ENTRY_JSON_PATH, ENTRY_JSON_FALLBACK_PATH } from './config.js';

/**
 * クイズ一覧エントリをプライマリ／フォールバックの順で取得する。
 */
export async function loadQuizEntries() {
    const primary = await fetchEntries(ENTRY_JSON_PATH, 'primary');
    if (primary !== null) {
        return primary;
    }

    console.warn('[entry] Falling back to secondary entry data source:', ENTRY_JSON_FALLBACK_PATH);
    const fallback = await fetchEntries(ENTRY_JSON_FALLBACK_PATH, 'fallback');
    if (fallback !== null) {
        return fallback;
    }

    throw new Error('Failed to load entry data');
}

/**
 * 指定されたパスからエントリ JSON を取得し、 quizzes 配列を返す。
 */
async function fetchEntries(path, label) {
    const requestLabel = label || 'unknown';
    console.info(`[entry] Fetching ${requestLabel} entry data from ${path}`);

    try {
        const res = await fetch(path);
        if (!res.ok) {
            console.warn(`[entry] Response not OK for ${path}: ${res.status} ${res.statusText}`);
            return null;
        }
        const json = await res.json();
        const quizzes = json.quizzes;
        if (!Array.isArray(quizzes)) {
            console.warn(`[entry] Invalid entry schema from ${path}: missing quizzes array`);
            return null;
        }

        console.info(`[entry] Loaded ${quizzes.length} quizzes from ${path}`);
        return quizzes;
    } catch (error) {
        console.error(`[entry] Failed to fetch entries from ${path}:`, error);
        return null;
    }
}
