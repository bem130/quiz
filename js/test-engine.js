import {
    listQuestionsForQuiz,
    saveQuestionSnapshot
} from './storage/question-store.js';
function tagQuestionStage(question, stage = 'TEST') {
    if (!question || typeof question !== 'object') {
        return;
    }
    try {
        Object.defineProperty(question, '__sessionStage', {
            value: stage,
            writable: true,
            configurable: true,
            enumerable: false
        });
    } catch (error) {
        question.__sessionStage = stage;
    }
}
// js/test-engine.js
class SeededRandom {
    constructor(seedValue) {
        this.state = this._hashSeed(seedValue);
    }

    _hashSeed(seedValue) {
        const str = String(seedValue || '');
        let hash = 0;
        for (let i = 0; i < str.length; i += 1) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }
        if (hash === 0) {
            hash = 0x1234567;
        }
        return hash >>> 0;
    }

    next() {
        this.state = (1664525 * this.state + 1013904223) >>> 0;
        return this.state / 0x100000000;
    }
}

export class TestSessionRunner {
    constructor(options) {
        this.baseEngine = options.engine;
        this.resolveQuestionId =
            typeof options.resolveQuestionId === 'function'
                ? options.resolveQuestionId
                : () => null;
        this.seenQuestionIds = new Set();
        this.questionCount = 0;
        this.random = null;
        this.quizId = null;
        this.cachedQuestions = [];
    }

    async start(config) {
        this.questionCount = config.questionCount || 10;
        this.seenQuestionIds.clear();
        this.quizId = config.quizId || null;
        const seed = config.seed || Date.now().toString(36);
        this.random = new SeededRandom(seed);
        this.cachedQuestions = [];
        if (this.quizId) {
            try {
                const stored = await listQuestionsForQuiz(this.quizId, {
                    limit: this.questionCount * 3
                });
                if (stored && stored.length) {
                    this.cachedQuestions = this._shuffleStoredQuestions(stored);
                }
            } catch (error) {
                console.warn('[test-engine] failed to read stored questions', error);
            }
        }
    }

    _shuffleStoredQuestions(list) {
        const entries = Array.isArray(list) ? [...list] : [];
        for (let i = entries.length - 1; i > 0; i -= 1) {
            const j = Math.floor(this.random.next() * (i + 1));
            const temp = entries[i];
            entries[i] = entries[j];
            entries[j] = temp;
        }
        return entries;
    }

    _generateQuestion() {
        if (!this.random) {
            return this.baseEngine.generateQuestion();
        }
        const originalRandom = Math.random;
        Math.random = () => this.random.next();
        try {
            return this.baseEngine.generateQuestion();
        } finally {
            Math.random = originalRandom;
        }
    }

    async nextQuestion() {
        while (this.cachedQuestions.length > 0) {
            const entry = this.cachedQuestions.pop();
            if (!entry || !entry.question) {
                continue;
            }
            const questionId = this.resolveQuestionId(entry.question);
            if (questionId && this.seenQuestionIds.has(questionId)) {
                continue;
            }
            if (questionId) {
                this.seenQuestionIds.add(questionId);
            }
            tagQuestionStage(entry.question, 'TEST');
            return entry.question;
        }

        for (let attempt = 0; attempt < 120; attempt += 1) {
            const question = this._generateQuestion();
            if (!question) continue;
            const questionId = this.resolveQuestionId(question);
            if (!questionId || !this.seenQuestionIds.has(questionId)) {
                if (questionId) {
                    this.seenQuestionIds.add(questionId);
                    if (this.quizId) {
                        saveQuestionSnapshot(this.quizId, questionId, question).catch(
                            (error) => {
                                console.warn('[test-engine] failed to save question snapshot', error);
                            }
                        );
                    }
                }
                tagQuestionStage(question, 'TEST');
                return question;
            }
        }
        const fallback = this._generateQuestion();
        tagQuestionStage(fallback, 'TEST');
        return fallback;
    }

    async recordResult() {
        // Test mode does not alter schedules.
    }

    getQueueOverview() {
        return null;
    }
}
