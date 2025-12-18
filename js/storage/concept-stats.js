// js/storage/concept-stats.js
import { getDatabase } from './database.js';

export async function updateConceptStatsFromAttempt(userId, snapshot) {
    if (!userId || !snapshot) return;
    const conceptId = snapshot.correctConceptId;
    if (!conceptId) return;

    const db = await getDatabase();
    const table = db.table('concept_stats');
    await db.transaction('rw', table, async () => {
        const key = [userId, String(conceptId)];
        const now = Date.now();
        const record =
            (await table.get(key)) || {
                userId,
                conceptId: String(conceptId),
                uncertaintyEma: 0,
                recentIdk: 0,
                lastUpdatedAt: 0
            };

        let ema = Number(record.uncertaintyEma) || 0;
        let recentIdk = Number(record.recentIdk) || 0;

        if (snapshot.resultType === 'idk') {
            ema = ema * 0.9 + 0.1;
            recentIdk = recentIdk * 0.8 + 1;
        } else if (!snapshot.correct) {
            ema = ema * 0.92 + 0.08;
            recentIdk = recentIdk * 0.8;
        } else {
            ema = ema * 0.85;
            recentIdk = recentIdk * 0.7;
        }

        record.uncertaintyEma = Number(ema.toFixed(4));
        record.recentIdk = Number(recentIdk.toFixed(4));
        record.lastUpdatedAt = now;
        await table.put(record);
    });
}

export async function getConceptStatsMap(userId, conceptIds) {
    if (!userId || !Array.isArray(conceptIds) || conceptIds.length === 0) {
        return new Map();
    }
    const uniqueIds = Array.from(new Set(conceptIds.map((cid) => String(cid))));
    const db = await getDatabase();
    const table = db.table('concept_stats');
    const keys = uniqueIds.map((conceptId) => [userId, conceptId]);
    const records = await table.bulkGet(keys);
    const results = new Map();
    records.forEach((record) => {
        if (record && record.conceptId != null) {
            results.set(String(record.conceptId), record);
        }
    });
    return results;
}

export async function getUncertainConcepts(userId, options = {}) {
    if (!userId) {
        return [];
    }
    const minScore =
        typeof options.minScore === 'number' ? options.minScore : 0.6;
    const limit =
        typeof options.limit === 'number' && options.limit > 0
            ? Math.floor(options.limit)
            : 5;
    const db = await getDatabase();
    const table = db.table('concept_stats');
    const raw = await table
        .where('userId')
        .equals(userId)
        .filter(
            (value) =>
                value &&
                typeof value.uncertaintyEma === 'number' &&
                value.uncertaintyEma >= minScore
        )
        .toArray();
    raw.sort((a, b) => (b.uncertaintyEma || 0) - (a.uncertaintyEma || 0));
    return raw.slice(0, limit);
}
