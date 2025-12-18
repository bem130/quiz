// js/storage/confusion-store.js
import { getDatabase } from './database.js';

const PRIOR_A = 1;
const PRIOR_B = 3;
const IDK_WEIGHT = 0.25;

function computeScore(record) {
    const shown = record.shownCount || 0;
    const chosen = record.chosenCount || 0;
    const idkNear = record.idkNearCount || 0;
    return (
        (chosen + idkNear * IDK_WEIGHT + PRIOR_A) /
        (shown + PRIOR_A + PRIOR_B)
    );
}

export async function updateConfusionFromAttempt(userId, snapshot) {
    if (!userId || !snapshot) return;
    const options = Array.isArray(snapshot.options) ? snapshot.options : [];
    if (!options.length) return;
    const correctConceptId = snapshot.correctConceptId;
    if (!correctConceptId) return;
    const selectedConceptId =
        typeof snapshot.selectedIndex === 'number' &&
        snapshot.options[snapshot.selectedIndex]
            ? snapshot.options[snapshot.selectedIndex].conceptId
            : null;
    const nearestConceptId =
        snapshot.resultType === 'idk' &&
        typeof snapshot.nearestOptionIndex === 'number' &&
        snapshot.options[snapshot.nearestOptionIndex]
            ? snapshot.options[snapshot.nearestOptionIndex].conceptId
            : null;

    const db = await getDatabase();

    await new Promise((resolve, reject) => {
        const tx = db.transaction('confusion', 'readwrite');
        const store = tx.objectStore('confusion');
        const timestamp = Date.now();

        options.forEach((option) => {
            const wrongConceptId = option.conceptId;
            if (!wrongConceptId || wrongConceptId === correctConceptId) {
                return;
            }

            const key = [userId, correctConceptId, wrongConceptId];
            const getRequest = store.get(key);
            getRequest.onsuccess = () => {
                const existing = getRequest.result || {
                    userId,
                    conceptId: correctConceptId,
                    wrongConceptId,
                    shownCount: 0,
                    chosenCount: 0,
                    idkNearCount: 0,
                    recentSessions: 0,
                    scoreCache: 0,
                    lastShownAt: 0
                };

                existing.shownCount += 1;
                if (
                    snapshot.resultType !== 'idk' &&
                    selectedConceptId != null &&
                    selectedConceptId === wrongConceptId
                ) {
                    existing.chosenCount += 1;
                }

                if (
                    snapshot.resultType === 'idk' &&
                    nearestConceptId != null &&
                    nearestConceptId === wrongConceptId
                ) {
                    existing.idkNearCount += 1;
                }

                existing.lastShownAt = timestamp;
                existing.scoreCache = computeScore(existing);
                store.put(existing);
            };
        });

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

export async function getConfusionStatsForConcept(userId, conceptId, options = {}) {
    if (!userId || conceptId == null) {
        return [];
    }
    const limit = typeof options.limit === 'number' ? options.limit : 3;
    const db = await getDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction('confusion', 'readonly');
            const store = tx.objectStore('confusion');
            let index;
            try {
                index = store.index('byUserConcept');
            } catch (error) {
                resolve([]);
                tx.abort();
                return;
            }
            const rangeFactory =
                typeof IDBKeyRange !== 'undefined'
                    ? IDBKeyRange
                    : typeof window !== 'undefined' && window.IDBKeyRange
                        ? window.IDBKeyRange
                        : typeof self !== 'undefined' && self.IDBKeyRange
                            ? self.IDBKeyRange
                            : null;
            if (!rangeFactory) {
                resolve([]);
                tx.abort();
                return;
            }
            const keyRange = rangeFactory.only([userId, conceptId]);
            const results = [];

            const request = index.openCursor(keyRange);
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (!cursor) {
                    return;
                }
                if (cursor.value) {
                    results.push(cursor.value);
                }
                cursor.continue();
            };
            request.onerror = () => reject(request.error);

            tx.oncomplete = () => {
                results.sort(
                    (a, b) => (b.scoreCache || 0) - (a.scoreCache || 0)
                );
                resolve(results.slice(0, limit));
            };
            tx.onabort = () => resolve([]);
        });
    } catch (error) {
        console.warn('[confusion] failed to read confusion stats', error);
        return [];
    }
}

export async function getTopConfusionPairs(userId, options = {}) {
    if (!userId) {
        return [];
    }
    const minScore =
        typeof options.minScore === 'number' ? options.minScore : 0.6;
    const limit =
        typeof options.limit === 'number' && options.limit > 0
            ? Math.floor(options.limit)
            : 5;
    const maxRecentSessions =
        typeof options.maxRecentSessions === 'number'
            ? options.maxRecentSessions
            : 2;
    const db = await getDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('confusion', 'readonly');
        let index;
        try {
            index = tx.objectStore('confusion').index('byUser');
        } catch (error) {
            resolve([]);
            tx.abort();
            return;
        }
        const keyRangeFactory =
            typeof IDBKeyRange !== 'undefined'
                ? IDBKeyRange
                : typeof window !== 'undefined' && window.IDBKeyRange
                    ? window.IDBKeyRange
                    : typeof self !== 'undefined' && self.IDBKeyRange
                        ? self.IDBKeyRange
                        : null;
        if (!keyRangeFactory) {
            resolve([]);
            tx.abort();
            return;
        }
        const range = keyRangeFactory.only(userId);
        const results = [];
        const request = index.openCursor(range);
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
                return;
            }
            const value = cursor.value;
            const score =
                typeof value.scoreCache === 'number'
                    ? value.scoreCache
                    : computeScore(value);
            const recent = Number(value.recentSessions || 0);
            if (
                score >= minScore &&
                recent < maxRecentSessions &&
                typeof value.conceptId !== 'undefined' &&
                typeof value.wrongConceptId !== 'undefined'
            ) {
                results.push({
                    ...value,
                    scoreCache: score
                });
            }
            cursor.continue();
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => {
            results.sort((a, b) => (b.scoreCache || 0) - (a.scoreCache || 0));
            resolve(results.slice(0, limit));
        };
        tx.onabort = () => resolve([]);
    });
}

export async function markConfusionPairScheduled(userId, conceptId, wrongConceptId) {
    if (!userId || conceptId == null || wrongConceptId == null) {
        return;
    }
    const db = await getDatabase();
    await new Promise((resolve, reject) => {
        const tx = db.transaction('confusion', 'readwrite');
        const store = tx.objectStore('confusion');
        const key = [userId, conceptId, wrongConceptId];
        const request = store.get(key);
        request.onsuccess = () => {
            const record = request.result;
            if (!record) {
                return;
            }
            const currentScore =
                typeof record.scoreCache === 'number'
                    ? record.scoreCache
                    : computeScore(record);
            record.scoreCache = Number((currentScore * 0.9).toFixed(4));
            record.recentSessions = (record.recentSessions || 0) + 1;
            store.put(record);
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
    });
}

export async function decayConfusionRecentSessions(userId, factor = 0.8) {
    if (!userId) {
        return;
    }
    const clampedFactor =
        typeof factor === 'number' && factor >= 0 && factor <= 1
            ? factor
            : 0.8;
    const db = await getDatabase();
    await new Promise((resolve, reject) => {
        const tx = db.transaction('confusion', 'readwrite');
        let index;
        try {
            index = tx.objectStore('confusion').index('byUser');
        } catch (error) {
            tx.abort();
            resolve();
            return;
        }
        const keyRangeFactory =
            typeof IDBKeyRange !== 'undefined'
                ? IDBKeyRange
                : typeof window !== 'undefined' && window.IDBKeyRange
                    ? window.IDBKeyRange
                    : typeof self !== 'undefined' && self.IDBKeyRange
                        ? self.IDBKeyRange
                        : null;
        if (!keyRangeFactory) {
            resolve();
            tx.abort();
            return;
        }
        const range = keyRangeFactory.only(userId);
        const request = index.openCursor(range);
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
                return;
            }
            const value = cursor.value;
            value.recentSessions = Number(
                ((value.recentSessions || 0) * clampedFactor).toFixed(4)
            );
            cursor.update(value);
            cursor.continue();
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
    });
}
