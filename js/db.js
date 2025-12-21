export const DB_NAME = 'QuizDraftDB';
export const DB_VERSION = 1;
export const STORE_NAME = 'drafts';

const memoryStore = new Map();

function hasIndexedDb() {
    return typeof indexedDB !== 'undefined';
}

function openDB() {
    if (!hasIndexedDb()) {
        return Promise.resolve(null);
    }
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error('[db] IndexedDB open error:', event.target.error);
            reject(event.target.error);
        };

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                // keyPath is "id" for backward compatibility. Use "path" as the logical identifier.
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}

export async function saveDraft(draft) {
    if (!draft || typeof draft !== 'object') {
        return;
    }
    const path = draft.path || draft.id || 'draft:default';
    const record = {
        id: path,
        path,
        data: draft.data || draft.content || '',
        updatedAt: draft.updatedAt || new Date().toISOString()
    };

    if (!hasIndexedDb()) {
        memoryStore.set(path, { ...record });
        return;
    }

    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(record);

        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
    });
}

export async function getDraft(id) {
    const key = id || 'draft:default';
    if (!hasIndexedDb()) {
        return memoryStore.get(key) || null;
    }

    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

export async function getAllDrafts() {
    if (!hasIndexedDb()) {
        return Array.from(memoryStore.values());
    }

    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

export async function deleteDraft(id) {
    const key = id || 'draft:default';
    if (!hasIndexedDb()) {
        memoryStore.delete(key);
        return;
    }

    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
    });
}
