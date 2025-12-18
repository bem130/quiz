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
    await new Promise((resolve, reject) => {
        const tx = db.transaction('sessions', 'readwrite');
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
        tx.objectStore('sessions').put(record);
    });

    return record;
}

export async function completeSessionRecord(sessionId, summary) {
    const db = await getDatabase();
    await new Promise((resolve, reject) => {
        const tx = db.transaction('sessions', 'readwrite');
        const store = tx.objectStore('sessions');
        const request = store.get(sessionId);

        request.onsuccess = () => {
            const record = request.result;
            if (!record) {
                resolve();
                return;
            }
            record.endedAt = Date.now();
            record.summary = summary || null;
            store.put(record);
        };

        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
    });
}

export async function logAttemptRecord(attempt) {
    const db = await getDatabase();
    const { attemptId, ...attemptWithoutId } = attempt || {};
    const record = {
        ...attemptWithoutId,
        timestamp: attemptWithoutId.timestamp || Date.now()
    };
    if (!record.userId || !record.sessionId || !record.quizId) {
        console.warn('[session][attempt] missing key fields', record);
    }

    await new Promise((resolve, reject) => {
        const tx = db.transaction('attempts', 'readwrite');
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
        try {
            tx.objectStore('attempts').put(record);
        } catch (error) {
            console.error('[session][attempt] failed before put', record, error);
            tx.abort();
        }
    });
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
    return new Promise((resolve, reject) => {
        const tx = db.transaction('attempts', 'readonly');
        const store = tx.objectStore('attempts');
        const index = store.index('byUserTime');

        const lower = [userId, 0];
        const upper = [userId, Number.MAX_SAFE_INTEGER];
        const keyRangeFactory =
            typeof IDBKeyRange !== 'undefined'
                ? IDBKeyRange
                : typeof self !== 'undefined' && self.IDBKeyRange
                    ? self.IDBKeyRange
                    : null;
        if (!keyRangeFactory) {
            reject(new Error('IDBKeyRange is not available.'));
            return;
        }
        const range = keyRangeFactory.bound(lower, upper);

        const stats = {
            totalAttempts: 0,
            correctAttempts: 0,
            weakAttempts: 0,
            idkCount: 0
        };

        const cursorRequest = index.openCursor(range);
        cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
                return;
            }
            const value = cursor.value;
            stats.totalAttempts += 1;
            if (value && value.correct) {
                stats.correctAttempts += 1;
            }
            if (value && value.resultType === 'weak') {
                stats.weakAttempts += 1;
            }
            if (value && value.resultType === 'idk') {
                stats.idkCount += 1;
            }
            cursor.continue();
        };

        cursorRequest.onerror = () => {
            reject(cursorRequest.error);
        };

        tx.oncomplete = () => {
            resolve(stats);
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}
