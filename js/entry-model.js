// js/entry-model.js

/**
 * 指定したエントリ URL から情報を取得し、利用可否とクイズ一覧を返す。
 * @param {string} entryUrl - entry.php などの URL。
 * @returns {Promise<object>} EntrySource 互換のオブジェクト。
 */
export async function loadEntrySourceFromUrl(entryUrl) {
    const baseResult = {
        url: entryUrl,
        label: entryUrl,
        available: false
    };

    try {
        const res = await fetch(entryUrl);
        if (!res.ok) {
            return {
                ...baseResult,
                errorMessage: `${res.status} ${res.statusText}`
            };
        }
        const json = await res.json();
        const label = typeof json.label === 'string' && json.label.trim()
            ? json.label.trim()
            : entryUrl;
        const quizzes = Array.isArray(json.quizzes) ? json.quizzes : null;
        if (!quizzes) {
            return {
                ...baseResult,
                label,
                errorMessage: 'Invalid entry schema (quizzes missing)'
            };
        }

        const baseUrl = new URL('.', entryUrl).toString();
        const normalizedQuizzes = quizzes.map((quiz) => ({
            ...quiz,
            _entryBaseUrl: baseUrl
        }));

        return {
            url: entryUrl,
            label,
            available: true,
            quizzes: normalizedQuizzes
        };
    } catch (error) {
        return {
            ...baseResult,
            errorMessage: error instanceof Error ? error.message : String(error)
        };
    }
}
