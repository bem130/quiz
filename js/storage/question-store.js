// js/storage/question-store.js
import { getDatabase } from './database.js';
import { makeQuestionKey } from './schedule-store.js';

function clonePayload(payload) {
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(payload);
        } catch (error) {
            // structuredClone failed (e.g., contains functions); fallback to JSON
        }
    }
    return JSON.parse(JSON.stringify(payload));
}

function resolveConceptId(option) {
    if (!option) {
        return null;
    }
    if (option.conceptId != null) {
        return option.conceptId;
    }
    if (option.meta && option.meta.conceptId != null) {
        return option.meta.conceptId;
    }
    if (option.entityId != null) {
        return option.entityId;
    }
    return null;
}

function deriveConceptMetadata(question) {
    const answers = Array.isArray(question && question.answers)
        ? question.answers
        : [];
    const firstAnswer = answers[0] || null;
    const options = Array.isArray(firstAnswer && firstAnswer.options)
        ? firstAnswer.options
        : [];
    const correctIndex =
        firstAnswer && typeof firstAnswer.correctIndex === 'number'
            ? firstAnswer.correctIndex
            : null;

    const result = {
        conceptId: null,
        optionConceptIds: []
    };

    options.forEach((option, index) => {
        const conceptId = resolveConceptId(option);
        if (conceptId == null) {
            return;
        }
        const normalized = String(conceptId);
        result.optionConceptIds.push(normalized);
        if (
            result.conceptId == null &&
            (index === correctIndex || option.isCorrect)
        ) {
            result.conceptId = normalized;
        }
    });

    result.optionConceptIds = Array.from(
        new Set(result.optionConceptIds)
    );
    return result;
}

export async function saveQuestionSnapshot(quizId, questionId, question) {
    if (!quizId || !questionId || !question) {
        return null;
    }
    const payload = clonePayload(question);
    const conceptMeta = deriveConceptMetadata(payload);
    const record = {
        qid: makeQuestionKey(quizId, questionId),
        quizId,
        packageId: quizId,
        questionId,
        payload,
        conceptId: conceptMeta.conceptId || null,
        optionConceptIds: conceptMeta.optionConceptIds || [],
        savedAt: Date.now()
    };
    const db = await getDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('questions', 'readwrite');
        const store = tx.objectStore('questions');
        store.put(record);
        tx.oncomplete = () => resolve(record);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

export async function getQuestionSnapshot(quizId, questionId) {
    if (!quizId || !questionId) {
        return null;
    }
    return getQuestionSnapshotByKey(makeQuestionKey(quizId, questionId));
}

export async function getQuestionSnapshotByKey(questionKey) {
    if (!questionKey) {
        return null;
    }
    const db = await getDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('questions', 'readonly');
        const store = tx.objectStore('questions');
        const request = store.get(questionKey);
        request.onsuccess = () => {
            const record = request.result;
            if (!record || !record.payload) {
                resolve(null);
                return;
            }
            resolve(clonePayload(record.payload));
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => {};
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

export async function deleteQuestionSnapshot(quizId, questionId) {
    if (!quizId || !questionId) {
        return;
    }
    const db = await getDatabase();
    await new Promise((resolve, reject) => {
        const tx = db.transaction('questions', 'readwrite');
        const store = tx.objectStore('questions');
        store.delete(makeQuestionKey(quizId, questionId));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

export async function findQuestionsByConcept(quizId, conceptId, options = {}) {
    if (conceptId == null) {
        return [];
    }
    const limit =
        typeof options.limit === 'number' && options.limit > 0
            ? Math.floor(options.limit)
            : 5;
    const normalizedConcept = String(conceptId);
    const db = await getDatabase();
    return new Promise((resolve, reject) => {
        let index;
        const tx = db.transaction('questions', 'readonly');
        try {
            index = tx.objectStore('questions').index('byConcept');
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
        const range = keyRangeFactory.only(normalizedConcept);
        const results = [];
        const seenKeys = new Set();

        const request = index.openCursor(range);
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
                return;
            }
            const value = cursor.value;
            if (
                value &&
                (!quizId || value.quizId === quizId) &&
                value.payload &&
                !seenKeys.has(value.qid)
            ) {
                seenKeys.add(value.qid);
                results.push({
                    questionKey: value.qid,
                    question: clonePayload(value.payload)
                });
            }
            if (results.length < limit) {
                cursor.continue();
            }
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => {
            resolve(results.slice(0, limit));
        };
        tx.onabort = () => resolve(results.slice(0, limit));
    });
}

export async function listQuestionsForQuiz(quizId, options = {}) {
    if (!quizId) {
        return [];
    }
    const limit =
        typeof options.limit === 'number' && options.limit > 0
            ? Math.floor(options.limit)
            : 100;
    const db = await getDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('questions', 'readonly');
        let index;
        try {
            index = tx.objectStore('questions').index('byPackage');
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
        const range = keyRangeFactory.only(quizId);
        const results = [];
        const request = index.openCursor(range);
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
                return;
            }
            const value = cursor.value;
            if (value && value.payload) {
                results.push({
                    questionKey: value.qid,
                    question: clonePayload(value.payload)
                });
            }
            cursor.continue();
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => {
            resolve(results.slice(0, limit));
        };
        tx.onabort = () => resolve(results.slice(0, limit));
    });
}
