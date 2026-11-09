import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import type { Result } from '../../src/core/result.ts';
import { openQuizStorage } from '../../src/web/storage/database.ts';

function valueOf<T, E>(result: Result<T, E>): T {
    if (!result.ok) assert.fail(JSON.stringify(result.error));
    return result.value;
}

await test('削除後の同名再作成は旧タブの保存・削除・移動を拒否する', async (context) => {
    const factory = new IDBFactory();
    const first = valueOf(await openQuizStorage('draft-aba', factory));
    const second = valueOf(await openQuizStorage('draft-aba', factory));
    context.after(() => { first.close(); second.close(); });
    const old = valueOf(await first.saveDraft({ id: 'x.json', text: 'old', updatedAt: 0, expectedVersion: 0 }));
    valueOf(await second.deleteDraft(old.id, old.version));
    const recreated = valueOf(await second.saveDraft({ id: old.id, text: 'new', updatedAt: 1, expectedVersion: 0 }));
    assert.ok(recreated.version > old.version);
    assert.equal((await first.saveDraft({ id: old.id, text: 'stale', updatedAt: 2, expectedVersion: old.version })).ok, false);
    assert.equal((await first.deleteDraft(old.id, old.version)).ok, false);
    assert.equal((await first.moveDraft(old.id, 'lost.json', old.version, 2)).ok, false);
    assert.deepEqual(valueOf(await second.listDrafts()), [recreated]);
    second.close();
    const reopened = valueOf(await openQuizStorage('draft-aba', factory));
    context.after(() => reopened.close());
    valueOf(await reopened.deleteDraft(recreated.id, recreated.version));
    assert.ok(valueOf(await reopened.saveDraft({ id: old.id, text: 'third', updatedAt: 3, expectedVersion: 0 })).version > recreated.version);
});

await test('移動先の再利用とフォルダ削除後の再作成でも旧versionを再利用しない', async (context) => {
    const storage = valueOf(await openQuizStorage('move-aba', new IDBFactory()));
    context.after(() => storage.close());
    const previous = valueOf(await storage.saveDraft({ id: 'target', text: 'previous', updatedAt: 0, expectedVersion: 0 }));
    valueOf(await storage.deleteDraft(previous.id, previous.version));
    const source = valueOf(await storage.saveDraft({ id: 'source', text: 'source', updatedAt: 0, expectedVersion: 0 }));
    const moved = valueOf(await storage.moveDraft(source.id, previous.id, source.version, 1));
    assert.ok(moved.version > source.version);
    assert.equal((await storage.deleteDraft(moved.id, previous.version)).ok, false);
    const folder = valueOf(await storage.saveDraft({ id: 'a/', text: '', updatedAt: 0, expectedVersion: 0 }));
    const child = valueOf(await storage.saveDraft({ id: 'a/file', text: 'child', updatedAt: 0, expectedVersion: 0 }));
    const tree = valueOf(await storage.moveDraftTree('a/', 'b/', [folder, child], 1));
    assert.ok(tree.every((draft) => draft.version > child.version));
    valueOf(await storage.deleteDraftTree('b/', tree));
    const recreated = valueOf(await storage.saveDraft({ id: 'b/file', text: 'new', updatedAt: 2, expectedVersion: 0 }));
    assert.ok(tree.every((draft) => recreated.version > draft.version));
    const oldChild = tree.find((draft) => draft.id === recreated.id);
    assert.ok(oldChild);
    assert.equal((await storage.saveDraft({ ...recreated, text: 'stale', expectedVersion: oldChild.version })).ok, false);
});

await test('backupはcounterを公開せず、復元した最大versionから採番し旧接続を拒否する', async (context) => {
    const factory = new IDBFactory();
    const storage = valueOf(await openQuizStorage('restore-counter', factory));
    const stale = valueOf(await openQuizStorage('restore-counter', factory));
    context.after(() => { storage.close(); stale.close(); });
    const empty = valueOf(await storage.exportBackup());
    assert.equal(empty.records.settings.some((setting) => setting.id.startsWith('__')), false);
    const backup = { ...empty, records: { ...empty.records, drafts: [{ id: 'restored', text: 'large-version', version: 9000, updatedAt: 0 }] } };
    valueOf(await storage.restoreBackup(backup));
    const next = valueOf(await storage.saveDraft({ id: 'new', text: 'new', expectedVersion: 0, updatedAt: 1 }));
    assert.ok(next.version > 9000);
    assert.equal((await stale.saveDraft({ id: 'stale', text: 'stale', expectedVersion: 0, updatedAt: 1 })).ok, false);
    for (const id of ['__draft-version', '__storage-generation']) {
        assert.equal((await storage.setSetting({ id, value: '0' })).ok, false);
        assert.equal((await storage.restoreBackup({ ...empty, records: { ...empty.records, settings: [{ id, value: '0' }] } })).ok, false);
    }
    assert.equal(valueOf(await storage.exportBackup()).records.settings.some((setting) => setting.id.startsWith('__')), false);
});
