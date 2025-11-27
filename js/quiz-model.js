// js/quiz-model.js
import { getQuizNameFromLocation, resolveQuizJsonPath } from './config.js';

export async function loadQuizDefinition() {
    const quizName = getQuizNameFromLocation();
    const path = resolveQuizJsonPath(quizName);

    console.log('[quiz] loadQuizDefinition quizName =', quizName);
    console.log('[quiz] resolved JSON path =', path);

    try {
        const res = await fetch(path);
        console.log('[quiz] fetch quiz JSON status =', res.status, res.statusText);

        if (!res.ok) {
            console.error('[quiz] fetch not OK for', path);
            throw new Error(`Failed to load quiz JSON: ${path}`);
        }

        const json = await res.json();
        console.log('[quiz] loaded quiz JSON keys =', Object.keys(json || {}));

        return {
            quizName,
            meta: {
                id: json.id,
                title: json.title,
                description: json.description,
                colorHue: json.color
            },
            entitySet: json.entitySet,
            patterns: json.questionRules.patterns,
            modes: json.questionRules.modes
        };
    } catch (err) {
        console.error('[quiz] error while loading quiz definition for', path, err);
        throw err;
    }
}
