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
        title: 'Draft Quiz',
        description: 'Draft description',
        version: 3,
        table: [
            { id: 'r1', text: 'Hello' },
            { id: 'r2', text: 'World' }
        ],
        patterns: [
            {
                id: 'p1',
                tokens: [
                    {
                        type: 'hide',
                        id: 'h1',
                        value: [{ type: 'key', field: 'text' }],
                        answer: { mode: 'choice_from_entities' }
                    }
                ]
            }
        ]
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
    assert.equal(entry.tree.length, 1);
    assert.ok(entry.tree[0].inlineDefinition);

    const loaded = loadLocalDraftEntry();
    assert.equal(loaded.available, true);
    assert.equal(loaded.tree[0].label, entry.label);
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
