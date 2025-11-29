// js/config.js

export const ENTRY_STORAGE_KEY = 'quizEntrySources.v1';

/**
 * URL クエリから entry パラメータを取得する。
 * @returns {string|null} URL デコード済みの entry URL。存在しない場合は null。
 */
export function getEntryUrlFromLocation() {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('entry');
    return value ? decodeURIComponent(value) : null;
}

/**
 * URL クエリから quiz パラメータを取得する。
 * @returns {string|null} クイズ ID。存在しない場合は null。
 */
export function getQuizNameFromLocation() {
    const params = new URLSearchParams(window.location.search);
    const quiz = params.get('quiz');
    return quiz;
}

/**
 * localStorage からエントリソース情報を復元する。
 * @returns {Array<object>} 復元されたエントリソース配列。欠損時は空配列を返す。
 */
export function loadEntrySourcesFromStorage() {
    try {
        const raw = window.localStorage.getItem(ENTRY_STORAGE_KEY);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .filter((entry) => entry && typeof entry.url === 'string')
            .map((entry) => ({
                url: entry.url,
                label: entry.label || entry.url,
                builtIn: Boolean(entry.builtIn)
            }));
    } catch (error) {
        console.warn('[config] Failed to parse entry sources from storage:', error);
        return [];
    }
}

/**
 * エントリソース配列を localStorage に保存する。
 * @param {Array<object>} sources - 保存対象のエントリソース配列。
 */
export function saveEntrySourcesToStorage(sources) {
    try {
        const payload = (sources || []).map((source) => ({
            url: source.url,
            label: source.label,
            builtIn: Boolean(source.builtIn)
        }));
        window.localStorage.setItem(ENTRY_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
        console.error('[config] Failed to save entry sources:', error);
    }
}

/**
 * デフォルトのエントリソースを生成する。
 * @returns {Array<object>} デフォルトエントリの配列。
 */
export function createDefaultEntrySources() {
    return [
        {
            url: 'entry.php',
            label: 'Local entry.php',
            builtIn: true
        }
    ];
}
