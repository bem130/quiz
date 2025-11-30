// js/entry-model.js

/**
 * 指定したエントリ URL から情報を取得し、利用可否とクイズ一覧を返す。
 * @param {string} entryUrl - entry.php などの URL。
 * @returns {Promise<object>} EntrySource 互換のオブジェクト。
 */
export async function loadEntrySourceFromUrl(entryUrl) {
    // この関数に渡された元の値（入力欄や URL パラメータの値）
    const rawUrl = entryUrl;

    // まずは「最低限の情報」を持つ結果オブジェクト
    const baseResult = {
        url: rawUrl,
        label: rawUrl,
        available: false
    };

    // 1. 相対 URL（entry.php など）を絶対 URL に正規化する
    let absoluteUrl;
    try {
        // window.location.href をベースにして、相対 URL も解決する
        absoluteUrl = new URL(rawUrl, window.location.href).toString();
    } catch (e) {
        // URL として解釈できない場合はここで打ち切り
        return {
            ...baseResult,
            errorMessage:
                'Invalid URL format. Please use an absolute http(s) URL or a relative path from this page.'
        };
    }

    // 以降はこちらを基準にする
    const resultBase = {
        url: absoluteUrl,
        label: rawUrl,
        available: false
    };

    try {
        // 2. entry エンドポイントへアクセス
        const res = await fetch(absoluteUrl);
        if (!res.ok) {
            return {
                ...resultBase,
                errorMessage: `HTTP ${res.status} ${res.statusText}`
            };
        }

        // 3. JSON としてパース
        let json;
        try {
            json = await res.json();
        } catch (e) {
            return {
                ...resultBase,
                errorMessage:
                    'Response is not valid JSON. Please check the entry endpoint output.'
            };
        }

        // 4. label と quizzes を検証
        const label =
            typeof json.label === 'string' && json.label.trim()
                ? json.label.trim()
                : rawUrl;

        const quizzes = Array.isArray(json.quizzes) ? json.quizzes : null;
        if (!quizzes) {
            return {
                ...resultBase,
                label,
                errorMessage:
                    'Invalid entry schema: "quizzes" array is missing.'
            };
        }

        // 5. クイズ定義用に、entry ベース URL (dir 解決の基準) を持たせる
        const baseUrl = new URL('.', absoluteUrl).toString();
        const normalizedQuizzes = quizzes.map((quiz) => ({
            ...quiz,
            _entryBaseUrl: baseUrl
        }));

        // 6. 正常終了
        return {
            url: absoluteUrl,  // 正規化後の URL を採用
            label,
            available: true,
            quizzes: normalizedQuizzes
        };
    } catch (error) {
        // ネットワークエラーなど
        return {
            ...resultBase,
            errorMessage:
                error instanceof Error ? error.message : String(error)
        };
    }
}
