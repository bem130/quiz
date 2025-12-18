// js/session-core.js
import {
    createSessionRecord,
    completeSessionRecord,
    logAttemptRecord
} from './storage/session-store.js';

class SessionCore {
    constructor() {
        this.currentSession = null;
    }

    async startSession({
        userId,
        userName,
        quizId,
        quizTitle,
        mode,
        config,
        seed = null
    }) {
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
            config
        };
        return record;
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

    async finishSession(summary) {
        if (!this.currentSession) {
            return null;
        }
        const sessionId = this.currentSession.sessionId;
        this.currentSession = null;
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
