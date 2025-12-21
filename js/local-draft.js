// js/local-draft.js
import { buildDefinitionFromQuizFile, validateDefinition } from './quiz-model.js';

export const LOCAL_DRAFT_STORAGE_KEY = 'quizLocalDraft.v3';
export const LOCAL_DRAFT_ENTRY_URL = '__local_draft__';

function getStorage() {
    if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage;
    }
    if (typeof localStorage !== 'undefined') {
        return localStorage;
    }
    return null;
}

function readDraftFromStorage() {
    const storage = getStorage();
    if (!storage) {
        return null;
    }
    try {
        const raw = storage.getItem(LOCAL_DRAFT_STORAGE_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !parsed.definition) {
            return null;
        }
        return parsed;
    } catch (error) {
        console.warn('[local-draft] Failed to parse draft from storage:', error);
        return null;
    }
}

function writeDraftToStorage(draft) {
    const storage = getStorage();
    if (!storage) {
        throw new Error('localStorage is not available.');
    }
    storage.setItem(LOCAL_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

function deriveMeta(definition) {
    const meta = definition && definition.meta ? definition.meta : {};
    const id = meta.id || meta.title || 'local-draft';
    const title = meta.title || meta.id || 'Local draft';
    const description = meta.description || '';
    return { id, title, description };
}

function cloneDefinition(definition) {
    if (!definition) {
        return definition;
    }
    return JSON.parse(JSON.stringify(definition));
}

function buildDraftEntryFromDefinition(definition, updatedAt) {
    const meta = deriveMeta(definition);
    const quizEntry = {
        id: `file:local-draft`,
        key: `file:local-draft`,
        type: 'file',
        label: meta.title,
        description: meta.description,
        inlineDefinition: cloneDefinition(definition),
        isLocalDraft: true
    };

    return {
        url: LOCAL_DRAFT_ENTRY_URL,
        label: meta.title,
        builtIn: true,
        available: true,
        tree: [quizEntry],
        nodeMap: new Map([[quizEntry.key, quizEntry]]),
        isLocal: true,
        hasDraftData: true,
        updatedAt
    };
}

function buildEmptyDraftEntry() {
    return {
        url: LOCAL_DRAFT_ENTRY_URL,
        label: 'Local draft',
        builtIn: true,
        available: false,
        tree: [],
        nodeMap: new Map(),
        isLocal: true,
        hasDraftData: false
    };
}

export function loadLocalDraftEntry() {
    const stored = readDraftFromStorage();
    if (!stored || !stored.definition) {
        return buildEmptyDraftEntry();
    }

    try {
        validateDefinition(stored.definition);
        return buildDraftEntryFromDefinition(stored.definition, stored.updatedAt);
    } catch (error) {
        console.warn('[local-draft] Stored draft is invalid, ignoring:', error);
        return buildEmptyDraftEntry();
    }
}

export function updateLocalDraftFromText(text) {
    if (!text || typeof text !== 'string') {
        throw new Error('クリップボードの内容が空です。');
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error('JSON形式ではありません。');
    }

    const definition = buildDefinitionFromQuizFile(parsed, 'draft', {
        title: parsed.title,
        description: parsed.description
    });

    const payload = {
        definition,
        updatedAt: new Date().toISOString()
    };
    writeDraftToStorage(payload);
    return buildDraftEntryFromDefinition(definition, payload.updatedAt);
}

export function clearLocalDraft() {
    const storage = getStorage();
    if (!storage) {
        return;
    }
    storage.removeItem(LOCAL_DRAFT_STORAGE_KEY);
}
