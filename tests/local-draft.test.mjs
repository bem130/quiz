import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';

function createMockStorage() {
    const store = new Map();
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        },
        clear() {
            store.clear();
        }
    };
}

function buildValidDraft() {
    return {
        version: 2,
        dataSets: {
            sample: {
                type: 'table',
                data: [
                    { id: 'r1', text: 'Hello' },
                    { id: 'r2', text: 'World' }
                ]
            }
        },
        questionRules: {
            patterns: [
                {
                    id: 'p1',
                    dataSet: 'sample',
                    tokens: [
                        {
                            type: 'hide',
                            value: { type: 'key', field: 'text' },
                            answer: { mode: 'choice_from_entities' }
                        }
                    ]
                }
            ]
        }
    };
}

beforeEach(() => {
    globalThis.localStorage = createMockStorage();
});

test('updateLocalDraftFromText saves valid clipboard content', async () => {
    const { loadLocalDraftEntry, updateLocalDraftFromText, LOCAL_DRAFT_ENTRY_URL } = await import('../js/local-draft.js');
    const draftJson = JSON.stringify(buildValidDraft());

    const entry = updateLocalDraftFromText(draftJson);
    assert.equal(entry.url, LOCAL_DRAFT_ENTRY_URL);
    assert.equal(entry.hasDraftData, true);
    assert.ok(entry.quizzes[0].inlineDefinition);

    const loaded = loadLocalDraftEntry();
    assert.equal(loaded.available, true);
    assert.equal(loaded.quizzes[0].title, entry.label);
});

test('loadLocalDraftEntry returns empty entry when storage is missing', async () => {
    const { loadLocalDraftEntry } = await import('../js/local-draft.js');
    const loaded = loadLocalDraftEntry();
    assert.equal(loaded.hasDraftData, false);
    assert.equal(loaded.available, false);
});

test('updateLocalDraftFromText rejects invalid JSON', async () => {
    const { updateLocalDraftFromText } = await import('../js/local-draft.js');
    assert.throws(
        () => updateLocalDraftFromText('not-json'),
        /JSON形式ではありません/
    );
});
