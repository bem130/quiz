// js/storage/session-store.js
import { getDatabase } from './database.js';

function generateId(prefix) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
}

export async function createSessionRecord({
    userId,
    userName,
    quizId,
    quizTitle,
    mode,
    modeId = null,
    config,
    seed = null
}) {
    const sessionId = generateId('session');
    const record = {
        sessionId,
        userId,
        userName,
        quizId,
        quizTitle,
        mode: mode || 'learn',
        modeId: modeId || null,
        config: config || {},
        seed,
        startedAt: Date.now(),
        endedAt: null,
        summary: null
    };

    const db = await getDatabase();
    await db.table('sessions').put(record);

    return record;
}

export async function completeSessionRecord(sessionId, summary) {
    const db = await getDatabase();
    const table = db.table('sessions');
    await db.transaction('rw', table, async () => {
        const record = await table.get(sessionId);
        if (!record) {
            return;
        }
        record.endedAt = Date.now();
        record.summary = summary || null;
        await table.put(record);
    });
}

export async function logAttemptRecord(attempt) {
    const { attemptId, ...attemptWithoutId } = attempt || {};
    const record = {
        ...attemptWithoutId,
        timestamp: attemptWithoutId.timestamp || Date.now()
    };
    if (!record.userId || !record.sessionId || !record.quizId) {
        console.warn('[session][attempt] missing key fields', record);
    }
    const db = await getDatabase();
    try {
        await db.table('attempts').put(record);
    } catch (error) {
        console.error('[session][attempt] failed before put', record, error);
    }
}

export async function getUserStats(userId) {
    if (!userId) {
        return {
            totalAttempts: 0,
            correctAttempts: 0,
            weakAttempts: 0,
            idkCount: 0
        };
    }
    const db = await getDatabase();
    const stats = {
        totalAttempts: 0,
        correctAttempts: 0,
        weakAttempts: 0,
        idkCount: 0
    };
    const collection = db
        .table('attempts')
        .where('[userId+timestamp]')
        .between([userId, 0], [userId, Number.MAX_SAFE_INTEGER]);
    await collection.each((value) => {
        if (!value) {
            return;
        }
        stats.totalAttempts += 1;
        if (value.correct) {
            stats.correctAttempts += 1;
        }
        if (value.resultType === 'weak') {
            stats.weakAttempts += 1;
        }
        if (value.resultType === 'idk') {
            stats.idkCount += 1;
        }
    });
    return stats;
}
