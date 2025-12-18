// js/storage/database.js
const DB_NAME = 'quiz-app-storage';
const DB_VERSION = 2;

let dbPromise = null;

function openDatabase() {
    if (!('indexedDB' in window)) {
        throw new Error('IndexedDB is not supported in this browser.');
    }

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const tx = event.target.transaction;

            createUsersStore(db);
            createPackagesStore(db);
            createQuestionsStore(db);
            createScheduleStore(db);
            createAttemptsStore(db);
            createSessionsStore(db);
            createConfusionStore(db, tx);
            createConceptStatsStore(db);
            createAppMetaStore(db);
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

function createUsersStore(db) {
    if (db.objectStoreNames.contains('users')) return;
    const store = db.createObjectStore('users', { keyPath: 'userId' });
    store.createIndex('byLastActiveAt', 'lastActiveAt', { unique: false });
}

function createPackagesStore(db) {
    if (db.objectStoreNames.contains('packages')) return;
    const store = db.createObjectStore('packages', { keyPath: 'packageId' });
    store.createIndex('bySubject', 'subject', { unique: false });
}

function createQuestionsStore(db) {
    if (db.objectStoreNames.contains('questions')) return;
    const store = db.createObjectStore('questions', { keyPath: 'qid' });
    store.createIndex('byPackage', 'packageId', { unique: false });
    store.createIndex('byConcept', 'conceptId', { unique: false });
}

function createScheduleStore(db) {
    if (db.objectStoreNames.contains('schedule')) return;
    const store = db.createObjectStore('schedule', {
        keyPath: ['userId', 'qid']
    });
    store.createIndex('byUserDue', ['userId', 'dueAt'], { unique: false });
    store.createIndex('byUserState', ['userId', 'state'], { unique: false });
}

function createAttemptsStore(db) {
    if (db.objectStoreNames.contains('attempts')) return;
    const store = db.createObjectStore('attempts', {
        keyPath: 'attemptId',
        autoIncrement: true
    });
    store.createIndex('byUserTime', ['userId', 'timestamp'], {
        unique: false
    });
    store.createIndex('byUserModeTime', ['userId', 'mode', 'timestamp'], {
        unique: false
    });
    store.createIndex('bySession', 'sessionId', { unique: false });
    store.createIndex('byUserQuestion', ['userId', 'qid'], { unique: false });
}

function createSessionsStore(db) {
    if (db.objectStoreNames.contains('sessions')) return;
    const store = db.createObjectStore('sessions', { keyPath: 'sessionId' });
    store.createIndex('byUserModeStart', ['userId', 'mode', 'startedAt'], {
        unique: false
    });
}

function createConfusionStore(db, transaction) {
    if (db.objectStoreNames.contains('confusion')) {
        if (transaction) {
            const store = transaction.objectStore('confusion');
            if (!store.indexNames.contains('byUser')) {
                store.createIndex('byUser', 'userId', { unique: false });
            }
            if (!store.indexNames.contains('byUserConcept')) {
                store.createIndex('byUserConcept', ['userId', 'conceptId'], {
                    unique: false
                });
            }
        }
        return;
    }
    const store = db.createObjectStore('confusion', {
        keyPath: ['userId', 'conceptId', 'wrongConceptId']
    });
    store.createIndex('byUser', 'userId', { unique: false });
    store.createIndex('byUserConcept', ['userId', 'conceptId'], {
        unique: false
    });
}

function createConceptStatsStore(db) {
    if (db.objectStoreNames.contains('concept_stats')) return;
    const store = db.createObjectStore('concept_stats', {
        keyPath: ['userId', 'conceptId']
    });
    store.createIndex('byUser', 'userId', { unique: false });
}

function createAppMetaStore(db) {
    if (db.objectStoreNames.contains('app_meta')) return;
    db.createObjectStore('app_meta', { keyPath: 'key' });
}

export function getDatabase() {
    if (!dbPromise) {
        dbPromise = openDatabase();
    }
    return dbPromise;
}

function wrapRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function getAll(storeName) {
    const db = await getDatabase();
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    return wrapRequest(store.getAll());
}

export async function putValue(storeName, value) {
    const db = await getDatabase();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(value);
    return wrapRequest(request);
}

export async function deleteValue(storeName, key) {
    const db = await getDatabase();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(key);
    return wrapRequest(request);
}

export async function getValue(storeName, key) {
    const db = await getDatabase();
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    return wrapRequest(request);
}

export async function setAppMeta(key, value) {
    return putValue('app_meta', { key, value, updatedAt: Date.now() });
}

export async function getAppMeta(key) {
    const record = await getValue('app_meta', key);
    return record ? record.value : null;
}

export async function clearStore(storeName) {
    const db = await getDatabase();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    return wrapRequest(store.clear());
}
