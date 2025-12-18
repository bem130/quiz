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
    const normalizedCorrect = String(correctConceptId);
    let nearestConceptId = null;
    if (snapshot.resultType === 'idk') {
        if (snapshot.idkNearestConceptId != null) {
            nearestConceptId = snapshot.idkNearestConceptId;
        } else if (
            typeof snapshot.nearestConceptId !== 'undefined' &&
            snapshot.nearestConceptId !== null
        ) {
            nearestConceptId = snapshot.nearestConceptId;
        } else if (
            typeof snapshot.nearestOptionIndex === 'number' &&
            options[snapshot.nearestOptionIndex]
        ) {
            nearestConceptId = options[snapshot.nearestOptionIndex].conceptId;
        }
    }
    const selectedConceptId =
        snapshot.selectedConceptId != null
            ? String(snapshot.selectedConceptId)
            : typeof snapshot.selectedIndex === 'number' &&
                snapshot.options[snapshot.selectedIndex] &&
                snapshot.options[snapshot.selectedIndex].conceptId != null
                ? String(snapshot.options[snapshot.selectedIndex].conceptId)
                : null;
    const normalizedNearestConceptId =
        nearestConceptId != null ? String(nearestConceptId) : null;

    const db = await getDatabase();
    const table = db.table('confusion');
    const timestamp = Date.now();
    await db.transaction('rw', table, async () => {
        for (const option of options) {
            const wrongConceptId = option && option.conceptId;
            if (!wrongConceptId) {
                continue;
            }
            const normalizedWrong = String(wrongConceptId);
            if (normalizedWrong === normalizedCorrect) {
                continue;
            }
            const key = [userId, normalizedCorrect, normalizedWrong];
            const existing =
                (await table.get(key)) || {
                    userId,
                    conceptId: normalizedCorrect,
                    wrongConceptId: normalizedWrong,
                    shownCount: 0,
                    chosenCount: 0,
                    idkNearCount: 0,
                    recentSessions: 0,
                    scoreCache: 0,
                    lastShownAt: 0,
                    lastUpdatedAt: 0
                };
            existing.shownCount += 1;
            if (
                snapshot.resultType !== 'idk' &&
                selectedConceptId != null &&
                selectedConceptId === normalizedWrong
            ) {
                existing.chosenCount += 1;
            }

            if (
                snapshot.resultType === 'idk' &&
                normalizedNearestConceptId != null &&
                normalizedNearestConceptId === normalizedWrong
            ) {
                existing.idkNearCount += 1;
            }

            existing.lastShownAt = timestamp;
            existing.lastUpdatedAt = timestamp;
            existing.scoreCache = computeScore(existing);
            await table.put(existing);
        }
    });
}

export async function getConfusionStatsForConcept(userId, conceptId, options = {}) {
    if (!userId || conceptId == null) {
        return [];
    }
    const limit = typeof options.limit === 'number' ? options.limit : 3;
    const db = await getDatabase();
    try {
        const results = await db
            .table('confusion')
            .where('[userId+conceptId]')
            .equals([userId, conceptId])
            .toArray();
        results.sort((a, b) => (b.scoreCache || 0) - (a.scoreCache || 0));
        return results.slice(0, limit);
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
    const collection = db.table('confusion').where('userId').equals(userId);
    const items = await collection
        .filter((value) => {
            if (!value) {
                return false;
            }
            const score =
                typeof value.scoreCache === 'number'
                    ? value.scoreCache
                    : computeScore(value);
            const recent = Number(value.recentSessions || 0);
            const eligible =
                score >= minScore &&
                recent < maxRecentSessions &&
                typeof value.conceptId !== 'undefined' &&
                typeof value.wrongConceptId !== 'undefined';
            if (eligible) {
                value.scoreCache = score;
            }
            return eligible;
        })
        .toArray();
    items.sort((a, b) => (b.scoreCache || 0) - (a.scoreCache || 0));
    return items.slice(0, limit);
}

export async function markConfusionPairScheduled(userId, conceptId, wrongConceptId) {
    if (!userId || conceptId == null || wrongConceptId == null) {
        return;
    }
    const db = await getDatabase();
    const table = db.table('confusion');
    await db.transaction('rw', table, async () => {
        const record = await table.get([userId, conceptId, wrongConceptId]);
        if (!record) {
            return;
        }
        const currentScore =
            typeof record.scoreCache === 'number'
                ? record.scoreCache
                : computeScore(record);
        record.scoreCache = Number((currentScore * 0.9).toFixed(4));
        record.recentSessions = (record.recentSessions || 0) + 1;
        record.lastUpdatedAt = Date.now();
        await table.put(record);
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
    await db
        .table('confusion')
        .where('userId')
        .equals(userId)
        .modify((value) => {
            value.recentSessions = Number(
                ((value.recentSessions || 0) * clampedFactor).toFixed(4)
            );
            value.lastUpdatedAt = Date.now();
        });
}
