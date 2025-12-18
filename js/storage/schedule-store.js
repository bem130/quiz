// js/storage/schedule-store.js
import { getDatabase } from './database.js';

const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_EASE = 2.8;
const LEARNING_STEPS = [120, 900, 86400]; // 2m -> 15m -> 1d
const RELEARNING_STEPS = [600, 86400]; // 10m -> 1d

export function makeQuestionKey(quizId, questionId) {
    const quizPart = quizId || 'default';
    const questionPart = questionId || 'unknown';
    return `${quizPart}::${questionPart}`;
}

function nowMs() {
    return Date.now();
}

function defaultScheduleRecord(userId, quizId, questionId) {
    const key = makeQuestionKey(quizId, questionId);
    const timestamp = nowMs();
    return {
        userId,
        quizId: quizId || null,
        questionId,
        qid: key,
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
        createdAt: timestamp
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

export async function ensureScheduleEntry(userId, quizId, questionId) {
    if (!userId || !questionId) return null;
    const db = await getDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('schedule', 'readwrite');
        const store = tx.objectStore('schedule');
        const key = makeQuestionKey(quizId, questionId);
        const request = store.get([userId, key]);
        let resultRecord = null;

        request.onsuccess = () => {
            const existing = request.result;
            if (existing) {
                resultRecord = existing;
            } else {
                const record = defaultScheduleRecord(userId, quizId, questionId);
                store.put(record);
                resultRecord = record;
            }
        };

        tx.oncomplete = () => resolve(resultRecord);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
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
    const db = await getDatabase();
    await new Promise((resolve, reject) => {
        const tx = db.transaction('schedule', 'readwrite');
        const store = tx.objectStore('schedule');
        store.delete([userId, questionKey]);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

export async function updateScheduleAfterResult({
    userId,
    quizId,
    questionId,
    resultType,
    answerMs
}) {
    if (!userId || !questionId) return;
    const db = await getDatabase();
    await new Promise((resolve, reject) => {
        const tx = db.transaction('schedule', 'readwrite');
        const store = tx.objectStore('schedule');
        const key = [userId, makeQuestionKey(quizId, questionId)];
        const request = store.get(key);

        request.onsuccess = () => {
            let entry = request.result;
            if (!entry) {
                entry = defaultScheduleRecord(userId, quizId, questionId);
            }

            entry.lastAnswerMs = typeof answerMs === 'number' ? answerMs : entry.lastAnswerMs;
            entry.quizId = quizId || entry.quizId || null;
            entry.questionId = questionId || entry.questionId;

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

            store.put(entry);
        };

        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
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

function resolveKeyRangeFactory() {
    if (typeof IDBKeyRange !== 'undefined') {
        return IDBKeyRange;
    }
    if (typeof window !== 'undefined' && window.IDBKeyRange) {
        return window.IDBKeyRange;
    }
    if (typeof self !== 'undefined' && self.IDBKeyRange) {
        return self.IDBKeyRange;
    }
    return null;
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
    const upperBound = now + lookaheadMs;

    const db = await getDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('schedule', 'readonly');
        let index;
        try {
            index = tx.objectStore('schedule').index('byUserDue');
        } catch (error) {
            resolve({ learning: [], relearning: [], review: [] });
            tx.abort();
            return;
        }
        const keyRangeFactory = resolveKeyRangeFactory();
        if (!keyRangeFactory) {
            resolve({ learning: [], relearning: [], review: [] });
            tx.abort();
            return;
        }

        const lower = [userId, 0];
        const upper = [userId, upperBound];
        const range = keyRangeFactory.bound(lower, upper);
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

        const request = index.openCursor(range);
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
                return;
            }
            const value = cursor.value;
            if (!value) {
                cursor.continue();
                return;
            }
            if (quizId && value.quizId && value.quizId !== quizId) {
                cursor.continue();
                return;
            }

            const stateRaw = typeof value.state === 'string' ? value.state.toUpperCase() : '';
            if (statesFilter && !statesFilter.has(stateRaw)) {
                cursor.continue();
                return;
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
                cursor.continue();
                return;
            }

            if (results[bucket].length < limits[bucket]) {
                results[bucket].push(value);
            }
            cursor.continue();
        };

        request.onerror = () => reject(request.error);
        tx.oncomplete = () => resolve(results);
        tx.onabort = () => reject(tx.error);
    });
}

function fetchEntriesByState(db, userId, state, quizId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('schedule', 'readonly');
        const store = tx.objectStore('schedule');
        const index = store.index('byUserState');
        const range = typeof IDBKeyRange !== 'undefined'
            ? IDBKeyRange.only([userId, state])
            : self.IDBKeyRange.only([userId, state]);
        const list = [];

        const request = index.openCursor(range);
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
                return;
            }
            const value = cursor.value;
            if (!quizId || value.quizId === quizId) {
                list.push(value);
            }
            cursor.continue();
        };

        request.onerror = () => reject(request.error);
        tx.oncomplete = () => resolve(list);
        tx.onabort = () => reject(tx.error);
    });
}

export async function listScheduleEntriesForQuiz(userId, quizId) {
    if (!userId) return { learning: [], relearning: [], review: [], fresh: [] };
    const db = await getDatabase();
    const [learning, relearning, review] = await Promise.all([
        fetchEntriesByState(db, userId, 'LEARNING', quizId),
        fetchEntriesByState(db, userId, 'RELEARNING', quizId),
        fetchEntriesByState(db, userId, 'REVIEW', quizId)
    ]);

    return {
        learning,
        relearning,
        review
    };
}
