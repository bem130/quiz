// js/session-core.js
import {
    createSessionRecord,
    completeSessionRecord,
    logAttemptRecord
} from './storage/session-store.js';
import { decayConfusionRecentSessions } from './storage/confusion-store.js';
import { StudySessionRunner } from './study-engine.js';
import { TestSessionRunner } from './test-engine.js';

const SHORT_RETRY_DELAY = { min: 3, max: 7 };
const MAX_RUNNER_ATTEMPTS = 120;

function randomInt(min, max) {
    const lower = Math.ceil(min);
    const upper = Math.floor(max);
    return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

function defaultResolveQuestionId(question) {
    if (!question) return null;
    if (question.id) return question.id;
    if (question.meta && (question.meta.questionId || question.meta.id)) {
        return question.meta.questionId || question.meta.id;
    }
    return null;
}

class SessionCore {
    constructor() {
        this.currentSession = null;
        this.runner = null;
        this.sessionMeta = null;
        this.retryQueue = [];
        this.resolveQuestionId = defaultResolveQuestionId;
    }

    _clearRuntimeState() {
        this.runner = null;
        this.sessionMeta = null;
        this.retryQueue = [];
        this.resolveQuestionId = defaultResolveQuestionId;
    }

    _setResolveQuestionId(fn) {
        if (typeof fn === 'function') {
            this.resolveQuestionId = fn;
        } else {
            this.resolveQuestionId = defaultResolveQuestionId;
        }
    }

    async startSession({
        userId,
        userName,
        quizId,
        quizTitle,
        mode,
        config,
        seed = null,
        engine = null,
        quizDefinition = null,
        modeBehavior = 'study',
        questionCount = null,
        resolveQuestionId: resolver = null
    }) {
        if (!engine) {
            throw new Error('SessionCore requires an engine instance to start.');
        }

        if (this.currentSession) {
            await this.finishSession();
        }
        this._clearRuntimeState();
        const record = await createSessionRecord({
            userId,
            userName,
            quizId,
            quizTitle,
            mode,
            config,
            seed
        });
        this.currentSession = {
            sessionId: record.sessionId,
            userId,
            userName,
            quizId,
            quizTitle,
            mode,
            config,
            modeBehavior
        };

        this._setResolveQuestionId(resolver);
        const totalQuestions =
            questionCount ||
            (config && (config.questionCount || config.totalQuestions)) ||
            10;

        if (modeBehavior === 'test') {
            this.runner = new TestSessionRunner({
                engine,
                resolveQuestionId: this.resolveQuestionId
            });
        } else {
            this.runner = new StudySessionRunner({
                engine,
                resolveQuestionId: this.resolveQuestionId,
                quizDefinition
            });
        }

        await this.runner.start({
            userId,
            quizId,
            modeId: mode,
            questionCount: totalQuestions,
            seed
        });

        this.sessionMeta = {
            questionCount: totalQuestions,
            quizId,
            userId,
            modeBehavior
        };
        return record;
    }

    hasActiveRunner() {
        return Boolean(this.runner);
    }

    _dueRetryQuestionIds(currentIndex) {
        if (!Array.isArray(this.retryQueue) || this.retryQueue.length === 0) {
            return [];
        }
        return this.retryQueue
            .filter((item) => item && typeof item.availableAt === 'number' && item.availableAt <= currentIndex)
            .map((item) => item.questionId);
    }

    _consumeRetryQuestion(questionId) {
        if (!questionId || !this.retryQueue.length) {
            return;
        }
        this.retryQueue = this.retryQueue.filter(
            (item) => item && item.questionId !== questionId
        );
    }

    scheduleRetry(questionId, questionIndex) {
        if (!questionId || typeof questionIndex !== 'number') {
            return;
        }
        const stringId = String(questionId);
        const existing = this.retryQueue.find(
            (item) => item && item.questionId === stringId
        );
        const delay = randomInt(SHORT_RETRY_DELAY.min, SHORT_RETRY_DELAY.max);
        const availableAt = questionIndex + delay;
        if (existing) {
            existing.availableAt = Math.min(
                existing.availableAt,
                availableAt
            );
            return;
        }
        this.retryQueue.push({
            questionId: stringId,
            availableAt
        });
    }

    async nextQuestion({ currentIndex = 0 } = {}) {
        if (!this.runner) {
            return null;
        }
        const dueRetryIds = this._dueRetryQuestionIds(currentIndex);
        for (let attempt = 0; attempt < MAX_RUNNER_ATTEMPTS; attempt += 1) {
            const question = await this.runner.nextQuestion();
            if (!question) {
                continue;
            }
            const qid = this.resolveQuestionId(question);
            if (dueRetryIds.length > 0) {
                if (!qid || !dueRetryIds.includes(String(qid))) {
                    continue;
                }
                this._consumeRetryQuestion(String(qid));
            }
            return question;
        }

        if (dueRetryIds.length > 0) {
            // Drop the oldest retry to avoid deadlock and try again.
            this.retryQueue.shift();
            return this.nextQuestion({ currentIndex });
        }
        return null;
    }

    async recordAttempt(attempt) {
        if (!this.currentSession) {
            return null;
        }
        const payload = {
            ...attempt,
            sessionId: this.currentSession.sessionId,
            userId: this.currentSession.userId,
            mode: this.currentSession.mode,
            quizId: this.currentSession.quizId
        };
        if (!payload.userId || !payload.sessionId) {
            console.warn('[session][recordAttempt] missing session info', payload);
        }
        return logAttemptRecord(payload);
    }

    async submitAnswer({ questionId, resultType, answerMs, questionIndex }) {
        if (!this.runner || !questionId) {
            return;
        }
        try {
            await this.runner.recordResult({
                questionId,
                resultType,
                answerMs
            });
        } catch (error) {
            console.warn('[session][submitAnswer] runner update failed', error);
        }

        if (
            this.currentSession &&
            this.currentSession.modeBehavior !== 'test' &&
            typeof questionIndex === 'number' &&
            (resultType === 'wrong' || resultType === 'idk')
        ) {
            this.scheduleRetry(questionId, questionIndex);
        }
    }

    async finishSession(summary) {
        if (!this.currentSession) {
            this._clearRuntimeState();
            return null;
        }
        const { sessionId, userId } = this.currentSession;
        this.currentSession = null;
        this._clearRuntimeState();
        if (userId) {
            try {
                await decayConfusionRecentSessions(userId);
            } catch (error) {
                console.warn('[session] failed to decay confusion stats', error);
            }
        }
        return completeSessionRecord(sessionId, summary || null);
    }

    getSessionId() {
        return this.currentSession ? this.currentSession.sessionId : null;
    }

    getCurrentSession() {
        return this.currentSession;
    }
}

export const sessionCore = new SessionCore();
