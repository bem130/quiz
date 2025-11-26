// js/quiz-model.js
import { getQuizNameFromLocation, resolveQuizJsonPath } from './config.js';

export async function loadQuizDefinition() {
    const quizName = getQuizNameFromLocation();
    const path = resolveQuizJsonPath(quizName);

    const res = await fetch(path);
    if (!res.ok) {
        throw new Error(`Failed to load quiz JSON: ${path}`);
    }
    const json = await res.json();

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
}
