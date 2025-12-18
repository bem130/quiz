// js/storage/database.js
import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.mjs';

const DB_NAME = 'quiz-app-storage';
const DB_VERSION = 3;

const db = new Dexie(DB_NAME);

// Version 2 mirrors the legacy IndexedDB schema so existing data survives the migration.
db.version(2).stores({
    users: '&userId,lastActiveAt',
    packages: '&packageId,subject',
    questions: '&qid,packageId,conceptId',
    schedule: '[userId+qid],[userId+dueAt],[userId+state]',
    attempts:
        '++attemptId,[userId+timestamp],[userId+mode+timestamp],sessionId,[userId+qid]',
    sessions: '&sessionId,[userId+mode+startedAt]',
    confusion: '[userId+conceptId+wrongConceptId],userId,[userId+conceptId]',
    concept_stats: '[userId+conceptId],userId',
    app_meta: '&key'
});

// Version 3 adds the composite index for packageId+conceptId and a userId index on schedule.
db.version(DB_VERSION)
    .stores({
        users: '&userId,lastActiveAt',
        packages: '&packageId,subject',
        questions:
            '&qid,packageId,conceptId,[packageId+conceptId]',
        schedule: '[userId+qid],[userId+dueAt],[userId+state],userId',
        attempts:
            '++attemptId,[userId+timestamp],[userId+mode+timestamp],sessionId,[userId+qid]',
        sessions: '&sessionId,[userId+mode+startedAt]',
        confusion: '[userId+conceptId+wrongConceptId],userId,[userId+conceptId]',
        concept_stats: '[userId+conceptId],userId',
        app_meta: '&key'
    })
    .upgrade(() => {
        // No data migration needed; new indexes are added automatically.
    });

const dbReady = db.open().then(async () => {
    try {
        await db.table('app_meta').put({
            key: 'dbVersion',
            value: DB_VERSION,
            updatedAt: Date.now()
        });
    } catch (error) {
        console.warn('[storage] failed to persist dbVersion meta', error);
    }
    return db;
});

export async function getDatabase() {
    await dbReady;
    return db;
}

export async function getAll(storeName) {
    const database = await getDatabase();
    return database.table(storeName).toArray();
}

export async function putValue(storeName, value) {
    const database = await getDatabase();
    return database.table(storeName).put(value);
}

export async function deleteValue(storeName, key) {
    const database = await getDatabase();
    return database.table(storeName).delete(key);
}

export async function getValue(storeName, key) {
    const database = await getDatabase();
    return database.table(storeName).get(key);
}

export async function clearStore(storeName) {
    const database = await getDatabase();
    return database.table(storeName).clear();
}

export async function setAppMeta(key, value) {
    return putValue('app_meta', { key, value, updatedAt: Date.now() });
}

export async function getAppMeta(key) {
    const record = await getValue('app_meta', key);
    return record ? record.value : null;
}

function resolveExportTables(database, options) {
    if (options && Array.isArray(options.tables) && options.tables.length) {
        const allowed = new Set(options.tables);
        return database.tables.filter((table) => allowed.has(table.name));
    }
    return database.tables;
}

export async function exportDatabase(options = {}) {
    const database = await getDatabase();
    const snapshot = {
        version: DB_VERSION,
        exportedAt: Date.now(),
        tables: {}
    };
    const tables = resolveExportTables(database, options);
    for (const table of tables) {
        try {
            snapshot.tables[table.name] = await table.toArray();
        } catch (error) {
            console.warn('[storage][export] failed to dump table', table.name, error);
        }
    }
    const json = JSON.stringify(snapshot);
    await setAppMeta('lastExportAt', snapshot.exportedAt);
    return new Blob([json], { type: 'application/json' });
}

async function readBlobAsText(blob) {
    if (typeof blob.text === 'function') {
        return blob.text();
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
    });
}

export async function importDatabase(blob, options = {}) {
    if (!(blob instanceof Blob)) {
        throw new Error('importDatabase expects a Blob input.');
    }
    const text = await readBlobAsText(blob);
    let payload = null;
    try {
        payload = JSON.parse(text);
    } catch (error) {
        throw new Error('Invalid backup file.');
    }
    if (!payload || typeof payload !== 'object' || !payload.tables) {
        throw new Error('Invalid backup payload.');
    }
    const tablesData = payload.tables || {};
    const database = await getDatabase();
    await database.transaction('rw', database.tables, async () => {
        for (const table of database.tables) {
            const data = tablesData[table.name];
            if (!Array.isArray(data)) {
                continue;
            }
            if (options.clearTablesBeforeImport !== false) {
                await table.clear();
            }
            if (data.length) {
                await table.bulkPut(data);
            }
        }
    });
    await setAppMeta('lastImportAt', Date.now());
}
