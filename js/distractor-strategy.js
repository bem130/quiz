// js/distractor-strategy.js
import { getConfusionStatsForConcept } from './storage/confusion-store.js';

const CONFUSION_RECENT_WINDOW = 3;
const CONFUSION_HISTORY_LIMIT = 8;
const COVERAGE_RECENT_WINDOW = 5;
const COVERAGE_HISTORY_LIMIT = 16;

// Per-user runtime state so we can enforce cooldown windows without touching IndexedDB.
const userQuestionCounters = new Map();
const recentConfusionUsage = new Map();
const recentCoverageUsage = new Map();

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

function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

function normalizeConceptId(value) {
    if (value == null) {
        return null;
    }
    try {
        return String(value);
    } catch (error) {
        return null;
    }
}

function nextQuestionOrder(userId) {
    const next = (userQuestionCounters.get(userId) || 0) + 1;
    userQuestionCounters.set(userId, next);
    return next;
}

function recordHistory(map, userId, conceptId, questionIndex, windowSize, limit) {
    if (!userId) return;
    const normalized = normalizeConceptId(conceptId);
    if (!normalized) return;
    const effectiveWindow = Math.max(1, windowSize || 1);
    const effectiveLimit = Math.max(effectiveWindow, limit || effectiveWindow);
    const existing = map.get(userId) || [];
    const minIndex = Math.max(0, questionIndex - (effectiveWindow - 1));
    const filtered = existing.filter((entry) => entry.questionIndex >= minIndex);
    filtered.push({ conceptId: normalized, questionIndex });
    map.set(userId, filtered.slice(-effectiveLimit));
}

function hasRecentUsage(map, userId, conceptId, questionIndex, windowSize) {
    if (!userId) return false;
    const normalized = normalizeConceptId(conceptId);
    if (!normalized) return false;
    const entries = map.get(userId);
    if (!entries || !entries.length) {
        return false;
    }
    const effectiveWindow = Math.max(1, windowSize || 1);
    const minIndex = Math.max(0, questionIndex - (effectiveWindow - 1));
    return entries.some(
        (entry) => entry.conceptId === normalized && entry.questionIndex >= minIndex
    );
}

function getRecentConceptSet(map, userId, questionIndex, windowSize) {
    const entries = map.get(userId) || [];
    const effectiveWindow = Math.max(1, windowSize || 1);
    const minIndex = Math.max(0, questionIndex - (effectiveWindow - 1));
    const result = new Set();
    entries.forEach((entry) => {
        if (entry.questionIndex >= minIndex) {
            result.add(entry.conceptId);
        }
    });
    return result;
}

function resolveAnswerStructure(answer) {
    const options = Array.isArray(answer && answer.options) ? answer.options : null;
    if (!options || !options.length) {
        return null;
    }
    let correctIndex = options.findIndex((opt) => opt && opt.isCorrect);
    if (correctIndex < 0 && typeof answer.correctIndex === 'number') {
        correctIndex =
            options[answer.correctIndex] != null ? answer.correctIndex : correctIndex;
    }
    if (correctIndex < 0) {
        return null;
    }
    options.forEach((opt, index) => {
        if (opt && typeof opt === 'object') {
            opt.isCorrect = index === correctIndex;
        }
    });
    return {
        options,
        correctIndex,
        correctOption: options[correctIndex]
    };
}

async function pickConfusionOption({
    userId,
    correctConceptId,
    nonCorrect,
    questionIndex,
    exclude
}) {
    const normalizedCorrect = normalizeConceptId(correctConceptId);
    if (!normalizedCorrect || !nonCorrect.length) {
        return null;
    }
    let stats = null;
    try {
        stats = await getConfusionStatsForConcept(userId, normalizedCorrect, { limit: 1 });
    } catch (error) {
        console.warn('[distractor] failed to fetch confusion stats', error);
        return null;
    }
    const top = Array.isArray(stats) ? stats[0] : null;
    if (!top || typeof top.wrongConceptId === 'undefined') {
        return null;
    }
    const wrongConceptId = normalizeConceptId(top.wrongConceptId);
    if (!wrongConceptId) {
        return null;
    }
    if (hasRecentUsage(recentConfusionUsage, userId, wrongConceptId, questionIndex, CONFUSION_RECENT_WINDOW)) {
        return null;
    }
    const candidate = nonCorrect.find(
        (opt) =>
            opt &&
            opt.conceptId != null &&
            normalizeConceptId(opt.conceptId) === wrongConceptId &&
            !exclude.has(opt)
    );
    if (!candidate) {
        return null;
    }
    const score =
        typeof top.scoreCache === 'number'
            ? clamp(top.scoreCache, 0, 1)
            : 0;
    const probability = clamp(0.15 + 0.7 * score, 0, 0.75);
    if (Math.random() > probability) {
        return null;
    }
    recordHistory(
        recentConfusionUsage,
        userId,
        wrongConceptId,
        questionIndex,
        CONFUSION_RECENT_WINDOW,
        CONFUSION_HISTORY_LIMIT
    );
    exclude.add(candidate);
    return candidate;
}

function pickCoverageOption({ userId, nonCorrect, questionIndex, exclude }) {
    if (!nonCorrect.length) {
        return null;
    }
    const available = nonCorrect.filter((opt) => opt && !exclude.has(opt));
    if (!available.length) {
        return null;
    }
    const recentSet = getRecentConceptSet(
        recentCoverageUsage,
        userId,
        questionIndex,
        COVERAGE_RECENT_WINDOW
    );
    const novel = available.filter(
        (opt) =>
            opt &&
            opt.conceptId != null &&
            !recentSet.has(normalizeConceptId(opt.conceptId))
    );
    const pool = novel.length ? novel : available;
    const choice = pool[Math.floor(Math.random() * pool.length)];
    if (!choice) {
        return null;
    }
    if (choice.conceptId != null) {
        recordHistory(
            recentCoverageUsage,
            userId,
            choice.conceptId,
            questionIndex,
            COVERAGE_RECENT_WINDOW,
            COVERAGE_HISTORY_LIMIT
        );
    }
    exclude.add(choice);
    return choice;
}

function pickRandomOption(nonCorrect, exclude) {
    const pool = nonCorrect.filter((opt) => opt && !exclude.has(opt));
    if (!pool.length) {
        return null;
    }
    const choice = pool[Math.floor(Math.random() * pool.length)];
    if (choice) {
        exclude.add(choice);
    }
    return choice;
}

export async function applyDistractorStrategy(question, context) {
    if (!question || !context || !context.userId) {
        return question;
    }

    const answers = Array.isArray(question.answers) ? question.answers : [];
    if (!answers.length) {
        return question;
    }
    const userId = context.userId;
    const questionIndex = nextQuestionOrder(userId);

    for (const answer of answers) {
        const structure = resolveAnswerStructure(answer);
        if (!structure || !structure.correctOption) {
            continue;
        }
        const correctConcept = structure.correctOption.conceptId;
        const nonCorrect = structure.options.filter(
            (opt, idx) => idx !== structure.correctIndex && opt
        );
        if (!nonCorrect.length) {
            continue;
        }

        const takenOptions = new Set();
        const prioritized = [];

        const confusionOption = await pickConfusionOption({
            userId,
            correctConceptId: correctConcept,
            nonCorrect,
            questionIndex,
            exclude: takenOptions
        });
        if (confusionOption) {
            prioritized.push(confusionOption);
        }

        const coverageOption = pickCoverageOption({
            userId,
            nonCorrect,
            questionIndex,
            exclude: takenOptions
        });
        if (coverageOption) {
            prioritized.push(coverageOption);
        }

        const randomOption = pickRandomOption(nonCorrect, takenOptions);
        if (randomOption) {
            prioritized.push(randomOption);
        }

        const remaining = nonCorrect.filter((opt) => opt && !takenOptions.has(opt));
        const ordered = [structure.correctOption, ...prioritized, ...remaining];
        ordered.forEach((opt) => {
            if (opt && typeof opt === 'object') {
                opt.isCorrect = opt === structure.correctOption;
            }
        });

        const shuffledOptions = shuffle(ordered).map((opt) =>
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
