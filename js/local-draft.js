// js/local-draft.js
import { buildDefinitionFromQuizFile, validateDefinition } from './quiz-model.js';
import { getDraft, saveDraft, deleteDraft } from './db.js';

export const LOCAL_DRAFT_ENTRY_URL = '__local_draft__';
export const DEFAULT_DRAFT_PATH = 'drafts/local-draft.json';

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

export async function loadLocalDraftEntry() {
    try {
        const storedPath =
            typeof window !== 'undefined' && window.localStorage
                ? window.localStorage.getItem('draftEditorPath') || DEFAULT_DRAFT_PATH
                : DEFAULT_DRAFT_PATH;
        const stored = await getDraft(storedPath);
        const rawData = stored ? (stored.data || stored.content) : null;
        if (!rawData) {
            return buildEmptyDraftEntry();
        }

        const parsed = JSON.parse(rawData);
        const definition = buildDefinitionFromQuizFile(parsed, 'draft', {
            title: parsed.title || 'Local Draft',
            description: parsed.description || ''
        });

        validateDefinition(definition);
        return buildDraftEntryFromDefinition(definition, stored.updatedAt);
    } catch (error) {
        console.warn('[local-draft] Stored draft is invalid or load failed:', error);
        return buildEmptyDraftEntry();
    }
}

export async function updateLocalDraftFromText(text) {
    if (!text || typeof text !== 'string') {
        throw new Error('Content is empty.');
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error('Invalid JSON format.');
    }

    const definition = buildDefinitionFromQuizFile(parsed, 'draft', {
        title: parsed.title || 'Local Draft',
        description: parsed.description || ''
    });

    const path =
        typeof window !== 'undefined' && window.localStorage
            ? window.localStorage.getItem('draftEditorPath') || DEFAULT_DRAFT_PATH
            : DEFAULT_DRAFT_PATH;
    const payload = {
        path,
        data: text,
        updatedAt: new Date().toISOString()
    };

    await saveDraft(payload);
    return buildDraftEntryFromDefinition(definition, payload.updatedAt);
}

export async function clearLocalDraft() {
    const path =
        typeof window !== 'undefined' && window.localStorage
            ? window.localStorage.getItem('draftEditorPath') || DEFAULT_DRAFT_PATH
            : DEFAULT_DRAFT_PATH;
    await deleteDraft(path);
}
