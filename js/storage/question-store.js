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
    await db.table('questions').put(record);
    return record;
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
    const record = await db.table('questions').get(questionKey);
    if (!record || !record.payload) {
        return null;
    }
    return clonePayload(record.payload);
}

export async function deleteQuestionSnapshot(quizId, questionId) {
    if (!quizId || !questionId) {
        return;
    }
    const db = await getDatabase();
    await db.table('questions').delete(makeQuestionKey(quizId, questionId));
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
    const table = db.table('questions');
    const seenKeys = new Set();
    let collection;
    if (quizId) {
        collection = table
            .where('[packageId+conceptId]')
            .equals([quizId, normalizedConcept]);
    } else {
        collection = table.where('conceptId').equals(normalizedConcept);
    }
    const fetchLimit = Math.max(limit * 3, limit);
    const candidates = await collection.limit(fetchLimit).toArray();
    const results = [];
    for (const value of candidates) {
        if (
            value &&
            value.payload &&
            !seenKeys.has(value.qid) &&
            (!quizId || value.quizId === quizId)
        ) {
            seenKeys.add(value.qid);
            results.push({
                questionKey: value.qid,
                questionId: value.questionId || null,
                question: clonePayload(value.payload)
            });
        }
        if (results.length >= limit) {
            break;
        }
    }
    return results;
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
    const table = db.table('questions');
    const entries = await table.where('packageId').equals(quizId).limit(limit).toArray();
    return entries
        .filter((entry) => entry && entry.payload)
        .map((value) => ({
            questionKey: value.qid,
            questionId: value.questionId || null,
            question: clonePayload(value.payload)
        }));
}
