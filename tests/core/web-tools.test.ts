import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { openQuizStorage } from '../../src/web/storage/database.ts';
import { importDraft } from '../../src/web/draft-import.ts';
import { cachePrefix, clearAppCache } from '../../src/web/cache-reset.ts';
import { editorFilesFromEntry, editorFilesFromSetting, folderKeys, vscodeLink } from '../../src/web/source-tools.ts';
import { shareUrl, sharedEntries } from '../../src/web/sharing.ts';

await test('clipboard相当のv3取込は不正値と既存path上書きを拒否する', async (context) => {
    const result = await openQuizStorage('import-tools', new IDBFactory());
    if (!result.ok) assert.fail(result.error.message);
    const storage = result.value; context.after(() => storage.close());
    const text = JSON.stringify({ version: 3, title: '取込', description: '新規のみ', table: [{ id: 'a', t: 'A' }, { id: 'b', t: 'B' }], patterns: [{ id: 'p', tokens: [{ type: 'hide', id: 'h', value: [{ type: 'key', field: 't' }], answer: { mode: 'choice_from_entities' } }] }] });
    assert.equal((await importDraft(storage, 'imports/a', text, 1)).ok, true);
    assert.equal((await importDraft(storage, 'imports/a.json', text.replace('新規のみ', '上書き禁止'), 2)).ok, false);
    assert.equal((await importDraft(storage, '../escape', text, 2)).ok, false);
    assert.equal((await importDraft(storage, 'bad', '{}', 2)).ok, false);
    const saved = await storage.listDrafts(); if (!saved.ok) assert.fail(saved.error.message);
    assert.equal(saved.value.length, 1); assert.equal(saved.value.at(0)?.text, text);
});

await test('外部editorはentryで列挙した相対fileだけを絶対localbaseへ対応させる', () => {
    const files = editorFilesFromEntry(JSON.stringify({ editorBasePath: 'C:\\quiz project' }), 'https://example.com/entry.json', ['data/a.json', '../secret.json', 'https://other.test/x.json', '%2e%2e/escape.json']);
    if (!files.ok) assert.fail(files.error);
    assert.deepEqual(files.value, [{ source: 'https://example.com/data/a.json', localPath: 'C:/quiz project/data/a.json' }]);
    assert.equal(vscodeLink('https://example.com/data/a.json', files.value).kind, 'some');
    assert.equal(vscodeLink('https://example.com/other.json', files.value).kind, 'none');
    for (const editorBasePath of ['javascript:alert(1)', '//server/share', '/tmp/../secret', '/tmp/a\n']) assert.equal(editorFilesFromEntry(JSON.stringify({ editorBasePath }), 'https://example.com/entry.json', ['a.json']).ok, false);
    assert.deepEqual(editorFilesFromSetting('[{"source":"https://example.com/a","localPath":"javascript:alert(1)"}]'), []);
});

await test('folder範囲と共有の新規URLは完全出典とpercentを保持する', () => {
    assert.deepEqual(folderKeys('https://example.com/data/a%20b/quiz.json'), ['https://example.com/data/', 'https://example.com/data/a%20b/']);
    assert.deepEqual(folderKeys('drafts/folder/a.json'), ['draft:/drafts/', 'draft:/drafts/folder/']);
    const entries = ['https://example.com/entry%20file.json'];
    const url = new URL(shareUrl('https://bem130.github.io/quiz/', ['pattern'], entries));
    assert.deepEqual(sharedEntries(url.searchParams, url.href), entries);
    assert.deepEqual(sharedEntries(new URLSearchParams('entries=["javascript:alert(1)"]'), url.href), []);
});

await test('cache削除は完全一致scopeのworkerとprefixだけを扱い、失敗を成功扱いしない', async () => {
    const scope = 'https://example.com/quiz/'; const own = `${cachePrefix(scope)}static:v1`; const foreign = 'quiz-web:%2Fother%2F:static:v1';
    const deleted: string[] = []; const unregistered: string[] = [];
    const result = await clearAppCache(scope, { keys: () => Promise.resolve([own, foreign]), delete: (name) => { deleted.push(name); return Promise.resolve(true); } }, { getRegistrations: () => Promise.resolve([
        { scope, unregister: () => { unregistered.push(scope); return Promise.resolve(true); } },
        { scope: 'https://example.com/other/', unregister: () => { unregistered.push('foreign'); return Promise.resolve(true); } }
    ]) });
    assert.deepEqual(result, { ok: true, value: 1 }); assert.deepEqual(deleted, [own]); assert.deepEqual(unregistered, [scope]);
    const failed = await clearAppCache(scope, { keys: () => Promise.resolve([own]), delete: () => Promise.resolve(false) }, { getRegistrations: () => Promise.resolve([]) });
    assert.equal(failed.ok, false);
});
