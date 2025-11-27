// js/quiz-model.js
import { getQuizNameFromLocation, resolveQuizJsonPath } from './config.js';

/**
 * Load quiz definition JSON.
 *
 * 優先順位:
 *  1. entries（entry.php or data/entry.json）から、id が一致するエントリを探す
 *  2. そのエントリの "dir" を使って "dir/<id>.json" を読む
 *     - "dir" は "data/" で始まっていなければエラー
 *  3. エントリが見つからない / dir が無い場合のみ、resolveQuizJsonPath(id) にフォールバック
 */
export async function loadQuizDefinition(entries) {
    const quizName = getQuizNameFromLocation();

    // 1. entries から path を解決（entry.php or entry.json）
    let path = null;

    if (Array.isArray(entries)) {
        const matched = entries.find(entry => entry && entry.id === quizName);
        if (matched) {
            const dir = matched.dir;

            if (typeof dir === 'string') {
                // "data/" で始まるかチェック
                if (!dir.startsWith('data/')) {
                    const msg = `[quiz] Invalid dir for quiz "${quizName}": "${dir}" (must start with "data/")`;
                    console.error(msg);
                    throw new Error(msg);
                }

                path = `${dir.replace(/\/+$/, '')}/${quizName}.json`;
                console.log('[quiz] resolved path from entries:', quizName, '->', path);
            } else {
                console.warn('[quiz] entry found but no valid "dir" for quizName =', quizName, 'entry =', matched);
            }
        } else {
            console.log('[quiz] no matching entry for quizName:', quizName);
        }
    }

    // 2. Fallback: どうしても path が決まらない場合は、従来どおり data/quizzes/<id>.json を想定
    if (!path) {
        path = resolveQuizJsonPath(quizName);
        console.log('[quiz] fallback resolveQuizJsonPath:', path);
    }

    // 3. Fetch quiz JSON
    const res = await fetch(path);
    console.log('[quiz] fetch quiz JSON status =', res.status, res.statusText);
    if (!res.ok) {
        throw new Error(`Failed to load quiz JSON: ${path}`);
    }

    const json = await res.json();

    return {
        quizName,
        meta: {
            // ID は URL / ファイル名ベースで統一
            id: quizName,
            title: json.title || quizName,
            description: json.description || '',
            colorHue: json.color
        },
        entitySet: json.entitySet,
        patterns: json.questionRules.patterns,
        modes: json.questionRules.modes
    };
}
