// js/distractor-strategy.js
import { getConfusionStatsForConcept } from './storage/confusion-store.js';
import { getConceptStatsMap } from './storage/concept-stats.js';

function shuffle(array) {
    const clone = Array.isArray(array) ? [...array] : [];
    for (let i = clone.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = clone[i];
        clone[i] = clone[j];
        clone[j] = temp;
    }
    return clone;
}

export async function applyDistractorStrategy(question, context) {
    if (!question || !context || !context.userId) {
        return question;
    }

    const answers = Array.isArray(question.answers) ? question.answers : [];
    const userId = context.userId;

    for (const answer of answers) {
        const options = Array.isArray(answer && answer.options) ? answer.options : null;
        if (!options || options.length === 0) {
            continue;
        }

        const correctOption = options.find((opt) => opt && opt.isCorrect);
        const correctConcept = correctOption && correctOption.conceptId;
        if (!correctOption || correctConcept == null) {
            continue;
        }

        const nonCorrect = options.filter((opt) => opt && !opt.isCorrect);
        if (nonCorrect.length === 0) {
            continue;
        }

        let confusionOption = null;
        try {
            const confusions = await getConfusionStatsForConcept(userId, correctConcept, {
                limit: 3
            });
            const targetIds = new Set(
                (confusions || []).map((entry) => String(entry.wrongConceptId))
            );
            if (targetIds.size > 0) {
                confusionOption = nonCorrect.find(
                    (opt) =>
                        opt &&
                        opt.conceptId != null &&
                        targetIds.has(String(opt.conceptId))
                );
            }
        } catch (error) {
            console.warn('[distractor] failed to fetch confusion stats', error);
        }

        let coverageOption = null;
        const coverageCandidates = nonCorrect.filter(
            (opt) => opt && (!confusionOption || opt !== confusionOption)
        );
        const coverageConceptIds = coverageCandidates
            .map((opt) => opt && opt.conceptId)
            .filter((cid) => cid != null);
        if (coverageConceptIds.length) {
            const conceptStats = await getConceptStatsMap(userId, coverageConceptIds);
            let bestScore = -1;
            coverageCandidates.forEach((opt) => {
                if (!opt || opt.conceptId == null) {
                    return;
                }
                const stats = conceptStats.get(String(opt.conceptId));
                const score = stats && typeof stats.uncertaintyEma === 'number'
                    ? stats.uncertaintyEma
                    : 0;
                if (score > bestScore) {
                    bestScore = score;
                    coverageOption = opt;
                }
            });
        }
        if (!coverageOption && coverageCandidates.length) {
            coverageOption = coverageCandidates[0];
        }

        const remaining = nonCorrect.filter(
            (opt) => opt && opt !== confusionOption && opt !== coverageOption
        );

        const bucket = [
            correctOption,
            ...[confusionOption, coverageOption].filter(Boolean),
            ...remaining
        ];

        const shuffledOptions = shuffle(bucket).map((opt) =>
            opt && typeof opt === 'object' ? { ...opt } : opt
        );
        const newCorrectIndex = shuffledOptions.findIndex((opt) => opt && opt.isCorrect);
        if (newCorrectIndex >= 0) {
            answer.options = shuffledOptions;
            answer.correctIndex = newCorrectIndex;
        }
    }

    return question;
}
