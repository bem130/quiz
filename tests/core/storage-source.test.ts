import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { packageIdentity } from '../../src/core/identity.ts';
import type { PackageRecord } from '../../src/core/records.ts';
import { none } from '../../src/core/result.ts';
import type { Result } from '../../src/core/result.ts';
import { parseQuiz, serializeQuiz } from '../../src/core/schema.ts';
import { openQuizStorage } from '../../src/web/storage/database.ts';
import { isStoreRecord } from '../../src/web/storage/validation.ts';

function valueOf<T, E>(result: Result<T, E>): T {
    if (!result.ok) assert.fail(JSON.stringify(result.error));
    return result.value;
}
const revision = serializeQuiz(valueOf(parseQuiz({ title: '出典の検証', description: '完全URLの保存境界',
    table: [{ id: 'a', term: 'A' }, { id: 'b', term: 'B' }],
    patterns: [{ id: 'p', tokens: [{ type: 'hide', id: 'h', value: [{ type: 'key', field: 'term' }],
        answer: { mode: 'choice_from_entities' } }] }]
})));
function remoteRecord(source: string): PackageRecord {
    // 外部DTOには意図的に未検証の文字列を入れ、保存境界の再検証を通す。
    return { id: JSON.stringify(['remote', source]), source, json: revision, revision, updatedAt: 1 };
}

await test('非canonical・不正なremote出典の保存と復元を拒否し既存データを変えない', async (context) => {
    const storage = valueOf(await openQuizStorage('source-boundary', new IDBFactory()));
    context.after(() => storage.close());
    valueOf(await storage.saveDraft({ id: 'keep.json', text: '未完成の草稿を保持', updatedAt: 1, expectedVersion: 0 }));
    valueOf(await storage.setSetting({ id: 'preserve', value: '設定も保持' }));
    valueOf(await storage.replacePackage(remoteRecord('https://safe.example/data/quiz.json'), none));
    const before = valueOf(await storage.exportBackup());
    const invalidSources = [
        'https://EXAMPLE.com:443', 'https://example.com:999999/data/quiz.json',
        'https://EXAMPLE.com/data/quiz.json', 'https://example.com:443/data/quiz.json',
        'http://example.com:80/data/quiz.json', 'https://example.com/../data/quiz.json',
        'https://example.com/data/quiz.json#fragment', 'https://user:secret@example.com/data/quiz.json',
        'https://例え.テスト/data/quiz.json', 'https://example.com\\data\\quiz.json',
        './data/quiz.json', '//example.com/data/quiz.json', 'file:///data/quiz.json'
    ];
    for (const source of invalidSources) {
        const record = remoteRecord(source);
        assert.equal(isStoreRecord('packages', record), false, source);
        const saved = await storage.replacePackage(record, none);
        assert.equal(saved.ok, false, source);
        assert.deepEqual(valueOf(await storage.exportBackup()), before, `save changed state: ${source}`);
        const restored = await storage.restoreBackup({ ...before, records: {
            ...before.records, packages: [...before.records.packages, record]
        } });
        assert.equal(restored.ok, false, source);
        assert.deepEqual(valueOf(await storage.exportBackup()), before, `restore changed state: ${source}`);
    }
});

await test('canonicalな2originの同名題庫とdraft出典を区別してbackup往復する', async (context) => {
    const factory = new IDBFactory();
    const original = valueOf(await openQuizStorage('source-original', factory));
    const fresh = valueOf(await openQuizStorage('source-fresh', factory));
    context.after(() => { original.close(); fresh.close(); });
    const sources = ['https://one.example/data/quiz.json?version=1', 'https://two.example/data/quiz.json?version=1'];
    for (const source of sources) {
        const record = remoteRecord(source);
        assert.equal(record.id, valueOf(packageIdentity({ kind: 'remote', url: source })));
        assert.equal(isStoreRecord('packages', record), true);
        valueOf(await original.replacePackage(record, none));
    }
    const draftSource = 'drafts/日本語.json';
    const draft: PackageRecord = { id: valueOf(packageIdentity({ kind: 'draft', id: draftSource })),
        source: draftSource, json: revision, revision, updatedAt: 1 };
    assert.equal(isStoreRecord('packages', draft), true);
    valueOf(await original.replacePackage(draft, none));
    const backup = valueOf(await original.exportBackup());
    assert.equal(new Set(backup.records.packages.map((record) => record.id)).size, 3);
    valueOf(await fresh.restoreBackup(backup));
    assert.deepEqual(valueOf(await fresh.exportBackup()), backup);
    assert.deepEqual(valueOf(await fresh.listPackages()), valueOf(await original.listPackages()));
});
