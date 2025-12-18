// js/storage/schedule-store.js
import { getDatabase } from './database.js';

const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_EASE = 2.8;
const LEARNING_STEPS = [120, 900, 86400]; // 2m -> 15m -> 1d
const RELEARNING_STEPS = [600, 86400]; // 10m -> 1d

function normalizePatternId(patternId) {
    if (patternId == null) {
        return null;
    }
    try {
        return String(patternId);
    } catch (error) {
        return null;
    }
}

export function makeQuestionKey(quizId, questionId) {
    const quizPart = quizId || 'default';
    const questionPart = questionId || 'unknown';
    return `${quizPart}::${questionPart}`;
}

export function makeScheduleKey(quizId, questionId, patternId) {
    const quizPart = quizId || 'default';
    const patternPart = normalizePatternId(patternId) || 'global';
    const questionPart = questionId || 'unknown';
    return `${quizPart}::${patternPart}::${questionPart}`;
}

function nowMs() {
    return Date.now();
}

async function getScheduleTable() {
    const db = await getDatabase();
    return db.table('schedule');
}

function defaultScheduleRecord(userId, quizId, questionId, patternId = null) {
    const scheduleKey = makeScheduleKey(quizId, questionId, patternId);
    const questionKey = makeQuestionKey(quizId, questionId);
    const timestamp = nowMs();
    const normalizedPattern = normalizePatternId(patternId);
    return {
        userId,
        quizId: quizId || null,
        questionId,
        qid: scheduleKey,
        questionKey,
        state: 'NEW',
        dueAt: timestamp,
        dueAtFuzzed: 1,
        intervalSec: 0,
        ease: DEFAULT_EASE,
        stepIndex: 0,
        streak: 0,
        lapses: 0,
        lastAnswerMs: null,
        lastSeenAt: null,
        createdAt: timestamp,
        patternId: normalizedPattern
    };
}

function applyFuzz(intervalSec) {
    if (intervalSec < 86400) {
        return { dueAt: nowMs() + intervalSec * 1000, fuzz: 1 };
    }
    const range = 0.05;
    const epsilon = 0.05;
    let fuzz = 1;
    if (Math.random() >= epsilon) {
        const random = Math.random(); // eslint-disable-line no-restricted-globals
        fuzz = 1 + (random * 2 * range - range);
    }
    return {
        dueAt: nowMs() + intervalSec * 1000 * fuzz,
        fuzz
    };
}

function deriveQuestionKeyFromSchedule(entry, quizId, questionId) {
    if (entry.questionKey) {
        return entry.questionKey;
    }
    return makeQuestionKey(
        entry.quizId || quizId,
        entry.questionId || questionId
    );
}

async function migrateLegacyScheduleEntry(scheduleTable, entry, userId, quizId, questionId, patternId) {
    const normalizedPattern = normalizePatternId(patternId);
    const scheduleKey = makeScheduleKey(quizId, questionId, normalizedPattern);
    const legacyKey = [userId, entry.qid];
    await scheduleTable.delete(legacyKey);
    entry.qid = scheduleKey;
    entry.questionKey = deriveQuestionKeyFromSchedule(entry, quizId, questionId);
    if (normalizedPattern) {
        entry.patternId = normalizedPattern;
    }
    await scheduleTable.put(entry);
    return entry;
}

export async function ensureScheduleEntry(userId, quizId, questionId, patternId = null) {
    if (!userId || !questionId) return null;
    const db = await getDatabase();
    const scheduleTable = db.table('schedule');
    return db.transaction('rw', scheduleTable, async () => {
        const scheduleKey = makeScheduleKey(quizId, questionId, patternId);
        const key = [userId, scheduleKey];
        const existing = await scheduleTable.get(key);
        if (existing) {
            existing.questionKey =
                existing.questionKey ||
                deriveQuestionKeyFromSchedule(existing, quizId, questionId);
            if (patternId && !existing.patternId) {
                existing.patternId = normalizePatternId(patternId);
                await scheduleTable.put(existing);
            }
            return existing;
        }
        const legacyKey = [userId, makeQuestionKey(quizId, questionId)];
        const legacy = await scheduleTable.get(legacyKey);
        if (legacy) {
            const migrated = await migrateLegacyScheduleEntry(
                scheduleTable,
                legacy,
                userId,
                quizId,
                questionId,
                patternId
            );
            if (migrated) {
                return migrated;
            }
        }
        const record = defaultScheduleRecord(userId, quizId, questionId, patternId);
        await scheduleTable.put(record);
        return record;
    });
}

function clampEase(value) {
    if (value < MIN_EASE) return MIN_EASE;
    if (value > MAX_EASE) return MAX_EASE;
    return Number(value.toFixed(4));
}

function scheduleInterval(entry, intervalSec) {
    const normalized = Math.max(30, Number(intervalSec) || 0);
    const { dueAt, fuzz } = applyFuzz(normalized);
    entry.intervalSec = Math.max(30, Math.round(normalized));
    entry.dueAt = dueAt;
    entry.dueAtFuzzed = fuzz;
    entry.lastSeenAt = nowMs();
}

function handleStrong(entry) {
    if (entry.state === 'NEW') {
        entry.state = 'LEARNING';
        entry.stepIndex = 0;
        scheduleInterval(entry, LEARNING_STEPS[0]);
        return;
    }

    if (entry.state === 'LEARNING') {
        entry.stepIndex += 1;
        if (entry.stepIndex < LEARNING_STEPS.length) {
            scheduleInterval(entry, LEARNING_STEPS[entry.stepIndex]);
            return;
        }
        entry.state = 'REVIEW';
        entry.stepIndex = 0;
    }

    entry.ease = clampEase(entry.ease + 0.02);
    entry.streak = (entry.streak || 0) + 1;
    let nextInterval =
        entry.intervalSec > 0 ? entry.intervalSec * entry.ease : 86400;
    if (entry.streak < 2) {
        nextInterval = Math.min(nextInterval, 86400);
    }
    scheduleInterval(entry, nextInterval);
}

function handleWeak(entry) {
    entry.ease = clampEase(entry.ease - 0.02);
    entry.state = 'REVIEW';
    entry.stepIndex = 0;
    entry.streak = (entry.streak || 0) + 1;
    const multiplier = Math.max(1.2, 0.7 * entry.ease);
    const base = entry.intervalSec > 0 ? entry.intervalSec : 3600;
    let interval = base * multiplier;
    if (entry.streak < 2) {
        interval = Math.min(interval, 86400);
    }
    scheduleInterval(entry, interval);
}

function handleWrong(entry) {
    entry.ease = clampEase(entry.ease - 0.08);
    entry.state = 'RELEARNING';
    entry.stepIndex = 0;
    entry.streak = 0;
    entry.lapses = (entry.lapses || 0) + 1;
    const base = entry.intervalSec > 0 ? entry.intervalSec * 0.2 : RELEARNING_STEPS[0];
    scheduleInterval(entry, Math.max(60, base));
}

function handleIdk(entry) {
    entry.ease = clampEase(entry.ease - 0.04);
    entry.state = 'RELEARNING';
    entry.stepIndex = 0;
    entry.streak = 0;
    const base = entry.intervalSec > 0 ? entry.intervalSec * 0.35 : RELEARNING_STEPS[0];
    scheduleInterval(entry, Math.max(60, base));
}

export async function deleteScheduleEntryByKey(userId, questionKey) {
    if (!userId || !questionKey) return;
    const table = await getScheduleTable();
    await table.delete([userId, questionKey]);
}

export async function updateScheduleAfterResult({
    userId,
    quizId,
    questionId,
    resultType,
    answerMs,
    patternId = null
}) {
    if (!userId || !questionId) return;
    const db = await getDatabase();
    const scheduleTable = db.table('schedule');
    await db.transaction('rw', scheduleTable, async () => {
        const normalizedPattern = normalizePatternId(patternId);
        const scheduleKey = makeScheduleKey(quizId, questionId, normalizedPattern);
        const key = [userId, scheduleKey];
        let entry = await scheduleTable.get(key);
        if (!entry) {
            const legacyKey = [userId, makeQuestionKey(quizId, questionId)];
            const legacy = await scheduleTable.get(legacyKey);
            if (legacy) {
                entry = await migrateLegacyScheduleEntry(
                    scheduleTable,
                    legacy,
                    userId,
                    quizId,
                    questionId,
                    normalizedPattern
                );
            }
        }
        if (!entry) {
            entry = defaultScheduleRecord(userId, quizId, questionId, normalizedPattern);
        }

        entry.lastAnswerMs = typeof answerMs === 'number' ? answerMs : entry.lastAnswerMs;
        entry.quizId = quizId || entry.quizId || null;
        entry.questionId = questionId || entry.questionId;
        if (normalizedPattern && !entry.patternId) {
            entry.patternId = normalizedPattern;
        }

        switch (resultType) {
            case 'correct':
            case 'strong':
                handleStrong(entry);
                break;
            case 'weak':
                handleWeak(entry);
                break;
            case 'wrong':
                handleWrong(entry);
                break;
            case 'idk':
                handleIdk(entry);
                break;
            default:
                handleWrong(entry);
                break;
        }

        entry.questionKey =
            entry.questionKey ||
            deriveQuestionKeyFromSchedule(entry, quizId, questionId);
        await scheduleTable.put(entry);
    });
}

function normalizeStatesFilter(states) {
    if (!Array.isArray(states) || !states.length) {
        return null;
    }
    return new Set(
        states
            .map((state) =>
                typeof state === 'string' ? state.toUpperCase() : String(state)
            )
            .filter(Boolean)
    );
}

function normalizePatternFilter(patternIds) {
    if (!Array.isArray(patternIds) || !patternIds.length) {
        return null;
    }
    const set = new Set();
    patternIds.forEach((value) => {
        if (value == null) {
            return;
        }
        try {
            set.add(String(value));
        } catch (error) {
            // ignore invalid values
        }
    });
    return set.size ? set : null;
}

export async function listDueScheduleEntries(userId, quizId, options = {}) {
    if (!userId) {
        return {
            learning: [],
            relearning: [],
            review: []
        };
    }

    const now =
        typeof options.now === 'number' && Number.isFinite(options.now)
            ? options.now
            : Date.now();
    const lookaheadMs =
        typeof options.lookaheadMs === 'number' && Number.isFinite(options.lookaheadMs)
            ? Math.max(0, options.lookaheadMs)
            : 0;
    const perStateLimit =
        typeof options.perStateLimit === 'number' && options.perStateLimit > 0
            ? Math.floor(options.perStateLimit)
            : 80;
    const statesFilter = normalizeStatesFilter(options.states);
    const patternFilter = normalizePatternFilter(options.patternIds);
    const upperBound = now + lookaheadMs;

    const table = await getScheduleTable();
    const range = table
        .where('[userId+dueAt]')
        .between([userId, 0], [userId, upperBound]);
    const results = {
        learning: [],
        relearning: [],
        review: []
    };
    const limits = {
        learning: perStateLimit,
        relearning: perStateLimit,
        review: perStateLimit
    };

    const entries = await range.toArray();
    for (const value of entries) {
        if (!value) {
            continue;
        }
        if (quizId && value.quizId && value.quizId !== quizId) {
            continue;
        }
        if (patternFilter) {
            const patternId =
                typeof value.patternId === 'string'
                    ? value.patternId
                    : value.patternId != null
                        ? String(value.patternId)
                        : null;
            if (patternId && !patternFilter.has(patternId)) {
                continue;
            }
        }
        if (!value.questionKey) {
            value.questionKey = deriveQuestionKeyFromSchedule(value, quizId, value.questionId);
        }
        const stateRaw = typeof value.state === 'string' ? value.state.toUpperCase() : '';
        if (statesFilter && !statesFilter.has(stateRaw)) {
            continue;
        }
        const bucket =
            stateRaw === 'LEARNING'
                ? 'learning'
                : stateRaw === 'RELEARNING'
                    ? 'relearning'
                    : stateRaw === 'REVIEW'
                        ? 'review'
                        : null;
        if (!bucket) {
            continue;
        }
        if (results[bucket].length < limits[bucket]) {
            results[bucket].push(value);
        }
        const allFilled = Object.keys(results).every(
            (key) => results[key].length >= limits[key]
        );
        if (allFilled) {
            break;
        }
    }
    return results;
}

async function fetchEntriesByState(userId, state, quizId) {
    const table = await getScheduleTable();
    const entries = await table
        .where('[userId+state]')
        .equals([userId, state])
        .toArray();
    if (!quizId) {
        return entries;
    }
    return entries.filter((entry) => entry && entry.quizId === quizId);
}

export async function listScheduleEntriesForQuiz(userId, quizId) {
    if (!userId) return { learning: [], relearning: [], review: [], fresh: [] };
    const [learning, relearning, review] = await Promise.all([
        fetchEntriesByState(userId, 'LEARNING', quizId),
        fetchEntriesByState(userId, 'RELEARNING', quizId),
        fetchEntriesByState(userId, 'REVIEW', quizId)
    ]);

    return {
        learning,
        relearning,
        review,
        fresh: []
    };
}
