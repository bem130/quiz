import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { conceptId, packageIdentity, patternId, questionId, parseUserId, parseSessionId } from '../../src/core/identity.ts';
import { parseQuizJson, serializeQuiz } from '../../src/core/schema.ts';
import { none } from '../../src/core/result.ts';
import type { Result } from '../../src/core/result.ts';
import type { BackupSnapshot, SessionRecord } from '../../src/web/storage/types.ts';
import { openQuizStorage } from '../../src/web/storage/database.ts';
import { isStoreRecord } from '../../src/web/storage/validation.ts';

function userIdentity(value: string) { return valueOf(parseUserId(value)); }
function sessionIdentity(value: string) { return valueOf(parseSessionId(value)); }

function valueOf<T, E>(result: Result<T, E>): T {
    if (!result.ok) assert.fail(JSON.stringify(result.error));
    return result.value;
}

function replayFixture(sameAnswers = false) {
    const id = valueOf(packageIdentity({ kind: 'draft', id: 'replay-validation' }));
    const quiz = valueOf(parseQuizJson(JSON.stringify({
        version: 3, title: '再生の検証', description: '出題可能な候補だけを保存する',
        table: [{ id: 'a', term: 'A' }, { id: 'b', term: sameAnswers ? 'A' : 'B' }],
        patterns: [{ id: 'p', tokens: [{ type: 'hide', id: 'answer', value: [{ type: 'key', field: 'term' }], answer: { mode: 'choice_from_entities' } }] }]
    })));
    const revision = serializeQuiz(quiz);
    const session: SessionRecord = {
        id: sessionIdentity('session'), userId: userIdentity('user'), packageIds: [id], mode: 'test', startedAt: 0, endedAt: none, summary: none,
        replay: { version: 1, seed: 'seed', completion: { kind: 'questions', count: 1 },
            allowedPatternIds: [patternId(id, 'p')], questionIds: [questionId(id, 'p', 'a')],
            packages: [{ id, revision }], schedules: [], confusions: [], conceptStats: [] }
    };
    const backup: BackupSnapshot = { format: 'bem130-quiz-backup', version: 2, records: {
        users: [{ id: userIdentity('user'), name: '利用者', createdAt: 0 }], drafts: [],
        packages: [{ id, source: 'replay-validation', json: revision, revision, updatedAt: 0 }],
        sessions: [session], attempts: [], schedule: [], confusion: [], conceptStats: [], settings: [], assets: []
    } };
    return { id, session, backup };
}

await test('schema上存在しても出題不能なquestionを含むbackupは既存データを置換しない', async (context) => {
    const storage = valueOf(await openQuizStorage('unplayable-replay', new IDBFactory()));
    context.after(() => storage.close());
    valueOf(await storage.saveDraft({ id: 'keep.json', text: '消してはならない編集中の内容', updatedAt: 1, expectedVersion: 0 }));
    const before = valueOf(await storage.exportBackup());
    const malformed = replayFixture(true);
    assert.equal(isStoreRecord('sessions', malformed.session), false);
    assert.equal((await storage.restoreBackup(malformed.backup)).ok, false);
    assert.deepEqual(valueOf(await storage.exportBackup()), before);
});

await test('実在する別questionもsessionの再生範囲外ならbackup復元を拒否する', async (context) => {
    const storage = valueOf(await openQuizStorage('out-of-scope-replay', new IDBFactory()));
    context.after(() => storage.close());
    const { id, backup } = replayFixture();
    valueOf(await storage.restoreBackup(backup));
    const before = valueOf(await storage.exportBackup());
    const attempt = { id: 'outside', sessionId: sessionIdentity('session'), userId: userIdentity('user'), packageId: id,
        questionId: questionId(id, 'p', 'b'), patternId: patternId(id, 'p'), conceptId: conceptId(id, 'b'),
        chosenConceptId: none, result: 'timeout', answerMs: 10, answeredAt: 10 };
    const malformed = { ...backup, records: { ...backup.records, attempts: [attempt] } };
    assert.equal((await storage.restoreBackup(malformed)).ok, false);
    assert.deepEqual(valueOf(await storage.exportBackup()), before);
});

await test('同じrevisionの複数sessionは候補索引を共有し、異なるrevisionは別に検証する', () => {
    const cache = new Map<string, ReadonlySet<string>>();
    const valid = replayFixture();
    assert.equal(isStoreRecord('sessions', valid.session, cache), true);
    const firstCandidates = [...cache.values()].at(0);
    assert.equal(isStoreRecord('sessions', { ...valid.session, id: 'second' }, cache), true);
    assert.equal(cache.size, 1);
    assert.equal([...cache.values()].at(0), firstCandidates);
    assert.equal(isStoreRecord('sessions', replayFixture(true).session, cache), false);
    assert.equal(cache.size, 2);
});
