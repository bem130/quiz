// js/storage/concept-stats.js
import { getDatabase } from './database.js';

export async function updateConceptStatsFromAttempt(userId, snapshot) {
    if (!userId || !snapshot) return;
    const conceptId = snapshot.correctConceptId;
    if (!conceptId) return;

    const db = await getDatabase();

    await new Promise((resolve, reject) => {
        const tx = db.transaction('concept_stats', 'readwrite');
        const store = tx.objectStore('concept_stats');
        const key = [userId, conceptId];
        const request = store.get(key);

        request.onsuccess = () => {
            const now = Date.now();
            const record = request.result || {
                userId,
                conceptId,
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
            store.put(record);
        };

        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

export async function getConceptStatsMap(userId, conceptIds) {
    if (!userId || !Array.isArray(conceptIds) || conceptIds.length === 0) {
        return new Map();
    }
    const uniqueIds = Array.from(
        new Set(conceptIds.map((cid) => String(cid)))
    );
    const db = await getDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('concept_stats', 'readonly');
        const store = tx.objectStore('concept_stats');
        const results = new Map();

        uniqueIds.forEach((conceptId) => {
            const request = store.get([userId, conceptId]);
            request.onsuccess = () => {
                if (request.result) {
                    results.set(String(conceptId), request.result);
                }
            };
        });

        tx.oncomplete = () => resolve(results);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}
