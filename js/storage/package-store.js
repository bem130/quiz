// js/storage/package-store.js
import { getDatabase } from './database.js';

function normalizeFileKey(path) {
    if (!path) return '';
    const normalized = String(path).replace(/\\/g, '/').replace(/^\.?\//, '');
    return normalized.replace(/\.json$/i, '');
}

function stableStringify(value) {
    if (value == null) {
        return 'null';
    }
    if (typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(',')}}`;
}

function hashString(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) + hash) + text.charCodeAt(i);
        hash &= 0xffffffff;
    }
    return (hash >>> 0).toString(16);
}

function resolveConceptIdFromRow(row) {
    if (!row) return null;
    if (row.conceptId != null) return row.conceptId;
    if (row.meta && row.meta.conceptId != null) return row.meta.conceptId;
    if (row.entityId != null) return row.entityId;
    if (row.id != null) return row.id;
    return null;
}

function buildPatternIds(patterns, fileKey) {
    const list = Array.isArray(patterns) ? patterns : [];
    return list.map((pattern, index) => {
        const localId = pattern && pattern.id ? String(pattern.id) : `p_${index}`;
        return `${fileKey}::${localId}`;
    });
}

function buildRowHashes(table) {
    const rows = Array.isArray(table) ? table : [];
    const map = {};
    rows.forEach((row) => {
        if (!row || row.id == null) return;
        const rowId = String(row.id);
        map[rowId] = hashString(stableStringify(row));
    });
    return map;
}

function buildRowConceptMap(table) {
    const rows = Array.isArray(table) ? table : [];
    const map = {};
    rows.forEach((row) => {
        if (!row || row.id == null) return;
        const rowId = String(row.id);
        const conceptId = resolveConceptIdFromRow(row);
        map[rowId] = conceptId != null ? String(conceptId) : null;
    });
    return map;
}

function questionMatchesFile(questionId, fileKey) {
    return typeof questionId === 'string' && questionId.startsWith(`${fileKey}::`);
}

function questionMatchesRow(questionId, fileKey, rowId) {
    if (typeof questionId !== 'string') return false;
    return questionId.startsWith(`${fileKey}::`) && questionId.endsWith(`::${rowId}`);
}

function patternMatchesFile(patternId, fileKey) {
    return typeof patternId === 'string' && patternId.startsWith(`${fileKey}::`);
}

async function purgePackageData({
    fileKey,
    rowIds,
    conceptIds,
    resetAll = false
}) {
    if (!fileKey) return;
    const rowIdSet = new Set(rowIds || []);
    const rowIdList = Array.from(rowIdSet);
    const conceptIdSet = new Set(conceptIds || []);
    const db = await getDatabase();
    const scheduleTable = db.table('schedule');
    const attemptsTable = db.table('attempts');
    const questionsTable = db.table('questions');
    const confusionTable = db.table('confusion');
    const conceptStatsTable = db.table('concept_stats');
    const sessionsTable = db.table('sessions');

    await db.transaction(
        'rw',
        scheduleTable,
        attemptsTable,
        questionsTable,
        confusionTable,
        conceptStatsTable,
        sessionsTable,
        async () => {
            const scheduleKeys = [];
            await scheduleTable.each((entry) => {
                if (!entry) return;
                const match = resetAll
                    ? questionMatchesFile(entry.questionId, fileKey) ||
                        patternMatchesFile(entry.patternId, fileKey)
                    : rowIdList.some((rowId) =>
                        questionMatchesRow(entry.questionId, fileKey, rowId)
                    );
                if (match) {
                    scheduleKeys.push([entry.userId, entry.qid]);
                }
            });
            if (scheduleKeys.length) {
                await scheduleTable.bulkDelete(scheduleKeys);
            }

            const attemptIds = [];
            const sessionIds = new Set();
            await attemptsTable.each((entry) => {
                if (!entry) return;
                const match = resetAll
                    ? questionMatchesFile(entry.questionId, fileKey) ||
                        patternMatchesFile(entry.patternId, fileKey)
                    : rowIdList.some((rowId) =>
                        questionMatchesRow(entry.questionId, fileKey, rowId)
                    );
                if (match) {
                    if (entry.attemptId != null) {
                        attemptIds.push(entry.attemptId);
                    }
                    if (entry.sessionId) {
                        sessionIds.add(entry.sessionId);
                    }
                }
            });
            if (attemptIds.length) {
                await attemptsTable.bulkDelete(attemptIds);
            }

            const questionKeys = [];
            await questionsTable.each((entry) => {
                if (!entry) return;
                const match = resetAll
                    ? questionMatchesFile(entry.questionId, fileKey) ||
                        patternMatchesFile(entry.patternId, fileKey)
                    : rowIdList.some((rowId) =>
                        questionMatchesRow(entry.questionId, fileKey, rowId)
                    );
                if (match && entry.qid) {
                    questionKeys.push(entry.qid);
                }
            });
            if (questionKeys.length) {
                await questionsTable.bulkDelete(questionKeys);
            }

            if (conceptIdSet.size) {
                const confusionKeys = [];
                await confusionTable.each((entry) => {
                    if (!entry || entry.conceptId == null || entry.wrongConceptId == null) return;
                    if (conceptIdSet.has(String(entry.conceptId))) {
                        confusionKeys.push([entry.userId, entry.conceptId, entry.wrongConceptId]);
                    }
                });
                if (confusionKeys.length) {
                    await confusionTable.bulkDelete(confusionKeys);
                }

                const conceptKeys = [];
                await conceptStatsTable.each((entry) => {
                    if (!entry || entry.conceptId == null) return;
                    if (conceptIdSet.has(String(entry.conceptId))) {
                        conceptKeys.push([entry.userId, entry.conceptId]);
                    }
                });
                if (conceptKeys.length) {
                    await conceptStatsTable.bulkDelete(conceptKeys);
                }
            }

            if (sessionIds.size) {
                await sessionsTable.bulkDelete(Array.from(sessionIds));
            }
        }
    );
}

export async function updatePackageRevision({ filePath, json, source = null }) {
    if (!filePath || !json || typeof json !== 'object') {
        return null;
    }
    const fileKey = normalizeFileKey(filePath);
    if (!fileKey) return null;
    const patterns = Array.isArray(json.patterns) ? json.patterns : [];
    const table = Array.isArray(json.table) ? json.table : [];
    const patternHash = hashString(stableStringify(patterns));
    const rowHashes = buildRowHashes(table);
    const rowConcepts = buildRowConceptMap(table);
    const patternIds = buildPatternIds(patterns, fileKey);
    const contentHash = hashString(
        stableStringify({ patterns, table })
    );

    const db = await getDatabase();
    const packagesTable = db.table('packages');
    const existing = await packagesTable.get(fileKey);
    const previousRowHashes = existing && existing.rowHashes ? existing.rowHashes : {};
    const previousConcepts = existing && existing.rowConcepts ? existing.rowConcepts : {};
    const previousPatternIds = existing && Array.isArray(existing.patternIds)
        ? existing.patternIds
        : [];

    let resetAll = false;
    const changedRowIds = new Set();

    if (existing) {
        if (existing.patternHash && existing.patternHash !== patternHash) {
            resetAll = true;
            Object.keys(previousRowHashes || {}).forEach((rowId) => {
                changedRowIds.add(String(rowId));
            });
        } else {
            Object.entries(previousRowHashes || {}).forEach(([rowId, hash]) => {
                const nextHash = rowHashes[rowId];
                if (!nextHash || nextHash !== hash) {
                    changedRowIds.add(String(rowId));
                }
            });
        }
    }

    if (existing && (resetAll || changedRowIds.size)) {
        const conceptIds = [];
        if (resetAll) {
            Object.values(previousConcepts || {}).forEach((value) => {
                if (value != null) {
                    conceptIds.push(String(value));
                }
            });
        } else {
            changedRowIds.forEach((rowId) => {
                const conceptId = previousConcepts ? previousConcepts[rowId] : null;
                if (conceptId != null) {
                    conceptIds.push(String(conceptId));
                }
            });
        }
        await purgePackageData({
            fileKey,
            rowIds: Array.from(changedRowIds),
            conceptIds,
            resetAll
        });
    }

    const record = {
        packageId: fileKey,
        contentHash,
        patternHash,
        rowHashes,
        rowConcepts,
        patternIds,
        updatedAt: Date.now()
    };
    if (source) {
        record.source = source;
    }
    await packagesTable.put(record);
    return {
        fileKey,
        resetAll,
        changedRowIds: Array.from(changedRowIds),
        previousPatternIds,
        patternIds
    };
}
