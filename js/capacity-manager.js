import { loadQuizDefinitionFromQuizEntry } from './quiz-model.js';
import { QuizEngine } from './quiz-engine.js';

/**
 * Build version of capacity-manager module for runtime compatibility checks.
 */
export const CAPACITY_MANAGER_VERSION = '2024.07.01-1';
const quizCapacityCache = new Map();
const entryCapacityCache = new Map();
const pendingQuizTasks = new Set();
const pendingEntryTasks = new Set();
const capacityTaskQueue = [];
let renderCallback = null;
let workerRunning = false;

export function setCapacityRenderCallback(callback) {
    renderCallback = typeof callback === 'function' ? callback : null;
}

export function estimateQuizCapacity(definition) {
    if (!definition || !Array.isArray(definition.modes)) {
        return 0;
    }

    const engine = new QuizEngine(definition);
    const patternCaps = engine.getAllPatternCapacities();
    const quizPatternIds = new Set();

    for (const mode of definition.modes) {
        if (!mode || !Array.isArray(mode.patternWeights)) {
            continue;
        }
        for (const pw of mode.patternWeights) {
            if (!pw || !pw.patternId) {
                continue;
            }
            if ((patternCaps.get(pw.patternId) || 0) > 0) {
                quizPatternIds.add(pw.patternId);
            }
        }
    }

    let total = 0;
    for (const id of quizPatternIds) {
        total += patternCaps.get(id) || 0;
    }
    return total;
}

export function enqueueQuizCapacityTask(entry, quiz) {
    if (!entry || !quiz || !entry.url || !quiz.id) {
        return;
    }

    const cacheKey = `${entry.url}::${quiz.id}`;
    if (quizCapacityCache.has(cacheKey)) {
        quiz._capacity = quizCapacityCache.get(cacheKey);
        quiz._capacityStatus = 'done';
        if (renderCallback) {
            renderCallback();
        }
        enqueueEntryCapacityTask(entry, { allowCached: true });
        return;
    }

    if (pendingQuizTasks.has(cacheKey)) {
        return;
    }

    quiz._capacityStatus = 'pending';
    pendingQuizTasks.add(cacheKey);
    capacityTaskQueue.push({ type: 'quiz', entry, quiz, cacheKey });
    startCapacityWorkerIfNeeded();
}

export function enqueueEntryCapacityTask(entry, options = {}) {
    if (!entry || !entry.url) {
        return;
    }

    const useCache = options.allowCached !== false;
    if (entryCapacityCache.has(entry.url) && useCache) {
        entry._capacity = entryCapacityCache.get(entry.url);
        entry._capacityStatus = 'done';
        if (renderCallback) {
            renderCallback();
        }
        return;
    }

    if (pendingEntryTasks.has(entry.url)) {
        return;
    }

    entry._capacityStatus = entry._capacityStatus === 'done' ? 'done' : 'pending';
    pendingEntryTasks.add(entry.url);
    capacityTaskQueue.push({ type: 'entry', entry });
    startCapacityWorkerIfNeeded();
}

function startCapacityWorkerIfNeeded() {
    if (workerRunning) {
        return;
    }
    scheduleNextCapacityWork();
}

function scheduleNextCapacityWork() {
    if (workerRunning || capacityTaskQueue.length === 0) {
        return;
    }

    const scheduler = typeof requestIdleCallback === 'function'
        ? requestIdleCallback
        : (cb) => setTimeout(cb, 16);

    scheduler(runCapacityWorker);
}

function runCapacityWorker(deadline) {
    if (workerRunning) {
        return;
    }

    workerRunning = true;
    const hasIdleTime = () =>
        deadline && typeof deadline.timeRemaining === 'function'
            ? deadline.timeRemaining() > 0
            : false;

    const processNext = () => {
        if (capacityTaskQueue.length === 0) {
            workerRunning = false;
            return;
        }

        const task = capacityTaskQueue.shift();
        Promise.resolve(handleCapacityTask(task))
            .catch((error) => {
                console.error('[capacity] task failed', error);
            })
            .finally(() => {
                if (renderCallback) {
                    renderCallback();
                }

                if (hasIdleTime()) {
                    processNext();
                    return;
                }

                if (capacityTaskQueue.length > 0) {
                    workerRunning = false;
                    scheduleNextCapacityWork();
                } else {
                    workerRunning = false;
                }
            });
    };

    processNext();
}

async function handleCapacityTask(task) {
    if (!task || !task.type) {
        return;
    }

    if (task.type === 'quiz') {
        await handleQuizCapacityTask(task);
        return;
    }

    if (task.type === 'entry') {
        handleEntryCapacityTask(task);
    }
}

async function handleQuizCapacityTask(task) {
    const { entry, quiz, cacheKey } = task;
    if (!entry || !quiz) {
        return;
    }

    try {
        const def = await loadQuizDefinitionFromQuizEntry(quiz);
        const capacity = estimateQuizCapacity(def.definition);
        quiz._capacity = capacity;
        quiz._capacityStatus = 'done';
        quizCapacityCache.set(cacheKey, capacity);
        entryCapacityCache.delete(entry.url);
    } catch (error) {
        console.error('[capacity] quiz failed', quiz.id, error);
        quiz._capacity = 0;
        quiz._capacityStatus = 'error';
        quizCapacityCache.set(cacheKey, 0);
        entryCapacityCache.delete(entry.url);
    } finally {
        pendingQuizTasks.delete(cacheKey);
        enqueueEntryCapacityTask(entry);
    }
}

function handleEntryCapacityTask(task) {
    const { entry } = task;
    if (!entry) {
        return;
    }

    const quizzes = Array.isArray(entry.quizzes) ? entry.quizzes : [];
    const completed = quizzes.every((quiz) =>
        quiz && (quiz._capacityStatus === 'done' || quiz._capacityStatus === 'error')
    );

    const total = quizzes.reduce((sum, quiz) => {
        if (quiz && typeof quiz._capacity === 'number') {
            return sum + quiz._capacity;
        }
        return sum;
    }, 0);

    entry._capacity = total;
    entry._capacityStatus = completed ? 'done' : 'pending';
    if (completed) {
        entryCapacityCache.set(entry.url, total);
    } else {
        entryCapacityCache.delete(entry.url);
    }
    pendingEntryTasks.delete(entry.url);
}
