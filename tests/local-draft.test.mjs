import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import {
    clearLocalDraft,
    loadLocalDraftEntry,
    updateLocalDraftFromText
} from '../js/local-draft.js';

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

beforeEach(async () => {
    await clearLocalDraft();
});

test('updateLocalDraftFromText saves valid clipboard content', async () => {
    const draftJson = JSON.stringify(buildValidDraft());

    const entry = await updateLocalDraftFromText(draftJson);
    const { LOCAL_DRAFT_ENTRY_URL } = await import('../js/local-draft.js');
    assert.equal(entry.url, LOCAL_DRAFT_ENTRY_URL);
    assert.equal(entry.hasDraftData, true);
    assert.equal(entry.tree.length, 1);
    assert.ok(entry.tree[0].inlineDefinition);

    const loaded = await loadLocalDraftEntry();
    assert.equal(loaded.available, true);
    assert.equal(loaded.tree[0].label, entry.label);
});

test('loadLocalDraftEntry returns empty entry when storage is missing', async () => {
    const loaded = await loadLocalDraftEntry();
    assert.equal(loaded.hasDraftData, false);
    assert.equal(loaded.available, false);
});

test('updateLocalDraftFromText rejects invalid JSON', async () => {
    await assert.rejects(
        () => updateLocalDraftFromText('not-json'),
        /Invalid JSON format/
    );
});
