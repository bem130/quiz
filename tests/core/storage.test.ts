import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { conceptId, packageIdentity, parsePackageId, patternId, questionId, parseUserId, parseSessionId } from '../../src/core/identity.ts';
import { none } from '../../src/core/result.ts';
import type { Result } from '../../src/core/result.ts';
import type { CommitAnswer, PackageRecord, SessionRecord } from '../../src/core/records.ts';
import { openQuizStorage } from '../../src/web/storage/database.ts';
import { STORE_NAMES, storageKey } from '../../src/web/storage/types.ts';
import { parseQuizJson, serializeQuiz } from '../../src/core/schema.ts';
import { prepareQuiz } from '../../src/core/quiz-engine.ts';
import { answerSession, confirmAnswer, createSession, nextQuestion } from '../../src/core/session.ts';

function userIdentity(value: string) { return valueOf(parseUserId(value)); }
function sessionIdentity(value: string) { return valueOf(parseSessionId(value)); }

function valueOf<T, E>(result: Result<T, E>): T {
    if (!result.ok) assert.fail(JSON.stringify(result.error));
    return result.value;
}

function quizJson(term = 'A'): string {
    return JSON.stringify({
        version: 3, title: '保存テスト', description: '保存の整合性を検証する題庫',
        table: [{ id: 'a', term }, { id: 'b', term: 'B' }],
        patterns: [{ id: 'p', tokens: [{ type: 'hide', id: 'answer', value: [{ type: 'key', field: 'term' }], answer: { mode: 'choice_from_entities' } }] }]
    });
}

async function fixture() {
    const factory = new IDBFactory();
    const storage = valueOf(await openQuizStorage('storage-test', factory));
    const id = valueOf(packageIdentity({ kind: 'draft', id: 'math' }));
    const packageRecord: PackageRecord = { id, source: 'math', json: quizJson(), revision: serializeQuiz(valueOf(parseQuizJson(quizJson()))), updatedAt: 0 };
    valueOf(await storage.createUser({ id: userIdentity('user'), name: '利用者', createdAt: 0 }));
    const savedPackage = valueOf(await storage.replacePackage(packageRecord, none));
    const session: SessionRecord = {
        id: sessionIdentity('session'), userId: userIdentity('user'), packageIds: [id], mode: 'study', startedAt: 0, endedAt: none, summary: none,
        replay: { version: 1, seed: 'storage-test', completion: { kind: 'questions', count: 10 },
            allowedPatternIds: [patternId(id, 'p')], questionIds: [questionId(id, 'p', 'a'), questionId(id, 'p', 'b')],
            packages: [{ id, revision: savedPackage.revision }], schedules: [], confusions: [], conceptStats: [] }
    };
    valueOf(await storage.startSession(session));
    const concept = conceptId(id, 'a');
    const question = questionId(id, 'p', 'a');
    const command: CommitAnswer = {
        attempt: {
            id: 'answer', sessionId: sessionIdentity('session'), userId: userIdentity('user'), packageId: id,
            questionId: question, patternId: patternId(id, 'p'), conceptId: concept,
            chosenConceptId: { kind: 'some', value: concept }, result: 'strong', answerMs: 10, answeredAt: 10
        },
        schedule: { kind: 'some', value: {
            expectedVersion: 0,
            next: {
                id: storageKey('user', question), userId: userIdentity('user'), packageId: id, questionId: question,
                patternId: patternId(id, 'p'), conceptId: concept, state: 'LEARNING', dueAt: 30_010,
                intervalSec: 30, ease: 2.5, stepIndex: 0, streak: 1, lapses: 0, version: 1,
                lastAnsweredAt: { kind: 'some', value: 10 }
            }
        } },
        confusion: [{ conceptId: concept, wrongConceptId: conceptId(id, 'b'), shown: 1, chosen: 0, idkNear: 0 }],
        conceptStats: { kind: 'some', value: { conceptId: concept, uncertaintyMultiplier: 0.85, uncertaintyAdd: 0, recentIdkMultiplier: 0.7, recentIdkAdd: 0 } }
    };
    return { factory, storage, id, packageRecord: savedPackage, session, command };
}

function replayQuestions(record: SessionRecord) {
    const replay = record.replay;
    const available = replay.packages.flatMap((entry) => prepareQuiz(valueOf(parseQuizJson(entry.revision)), valueOf(parsePackageId(entry.id)), entry.revision).candidates);
    const byId = new Map(available.map((entry) => [String(entry.id), entry]));
    const candidates = replay.questionIds.map((id) => {
        const candidate = byId.get(id);
        if (!candidate) assert.fail('保存された候補をrevisionから復元できない。');
        return candidate;
    });
    let state = valueOf(createSession({ id: record.id, userId: record.userId, mode: record.mode,
        completion: replay.completion, candidates, allowedPatternIds: replay.allowedPatternIds,
        seed: replay.seed, now: record.startedAt, schedules: replay.schedules, confusions: replay.confusions, conceptStats: replay.conceptStats }));
    const questions = [];
    for (let index = 0; index < 2; index += 1) {
        const now = record.startedAt + index * 100;
        state = valueOf(nextQuestion(state, now));
        if (state.phase.kind !== 'question') assert.fail('問題を再生できない。');
        questions.push({ id: state.phase.question.id, options: state.phase.question.options.map((option) => option.id) });
        const operationId = `replay-${index}`;
        state = valueOf(answerSession(state, { operationId, selection: { kind: 'option', optionId: state.phase.question.correctOptionId }, now: now + 10 }));
        state = valueOf(confirmAnswer(state, operationId));
    }
    return questions;
}

await test('API不存在は起動失敗の値として返る', async () => {
    const result = await openQuizStorage();
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, 'unavailable');
});

await test('草稿は不正JSONも保持し、同時保存・移動・削除の競合で内容を失わない', async (context) => {
    const { factory, storage } = await fixture();
    const other = valueOf(await openQuizStorage('storage-test', factory));
    context.after(() => { storage.close(); other.close(); });
    const first = valueOf(await storage.saveDraft({ id: 'a.json', text: '{編集中', updatedAt: 1, expectedVersion: 0 }));
    const results = await Promise.all([
        storage.saveDraft({ id: 'a.json', text: 'saved A', updatedAt: 2, expectedVersion: first.version }),
        other.saveDraft({ id: 'a.json', text: 'saved B', updatedAt: 2, expectedVersion: first.version })
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    const draft = valueOf(await storage.listDrafts()).find((entry) => entry.id === 'a.json');
    assert.ok(draft);
    assert.equal(draft.version, 2);
    assert.equal((await storage.deleteDraft('a.json', 1)).ok, false);
    valueOf(await storage.saveDraft({ id: 'target.json', text: 'target', updatedAt: 3, expectedVersion: 0 }));
    assert.equal((await storage.moveDraft('a.json', 'target.json', 2, 4)).ok, false);
    assert.equal(valueOf(await storage.listDrafts()).length, 2);
    const moved = valueOf(await storage.moveDraft('a.json', 'moved.json', 2, 4));
    assert.equal(moved.text, draft.text);
    assert.equal(valueOf(await storage.listDrafts()).some((entry) => entry.id === 'a.json'), false);
    valueOf(await storage.deleteDraft('moved.json', moved.version));
});

await test('回答・調度・統計は一度だけ同時に保存され、同じ回答の再送は成功する', async (context) => {
    const { storage, command } = await fixture();
    context.after(() => storage.close());
    assert.deepEqual(valueOf(await storage.commitAnswer(command)), { duplicate: false });
    assert.deepEqual(valueOf(await storage.commitAnswer(command)), { duplicate: true });
    assert.equal(valueOf(await storage.listAttempts()).length, 1);
    assert.equal(valueOf(await storage.listSchedule()).length, 1);
    assert.equal(valueOf(await storage.listConfusion()).at(0)?.shown, 1);
    assert.equal(valueOf(await storage.listConceptStats()).length, 1);
    assert.equal((await storage.commitAnswer({ ...command, attempt: { ...command.attempt, result: 'wrong' } })).ok, false);
});

await test('同じ題庫内でもsession候補範囲外の回答は保存しない', async (context) => {
    const { storage, session, command } = await fixture();
    context.after(() => storage.close());
    valueOf(await storage.startSession({ ...session, id: sessionIdentity('subset'), replay: { ...session.replay, questionIds: [questionId(valueOf(parsePackageId(command.attempt.packageId)), 'p', 'b')] } }));
    const before = valueOf(await storage.exportBackup());
    const rejected = await storage.commitAnswer({ ...command, attempt: { ...command.attempt, sessionId: sessionIdentity('subset') } });
    assert.equal(rejected.ok, false);
    assert.deepEqual(valueOf(await storage.exportBackup()), before);
});

await test('調度の競合は先行したattempt書き込みもrollbackする', async (context) => {
    const { storage, command } = await fixture();
    context.after(() => storage.close());
    assert.equal(command.schedule.kind, 'some');
    if (command.schedule.kind !== 'some') assert.fail('fixture requires a schedule');
    const result = await storage.commitAnswer({
        ...command,
        schedule: { kind: 'some', value: { expectedVersion: 1, next: { ...command.schedule.value.next, version: 2 } } }
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, 'conflict');
    assert.deepEqual(valueOf(await storage.listAttempts()), []);
    assert.deepEqual(valueOf(await storage.listSchedule()), []);
    assert.deepEqual(valueOf(await storage.listConfusion()), []);
});

await test('別タブからの回答競合でも調度versionの上書きと部分保存を防ぐ', async (context) => {
    const { storage, factory, command } = await fixture();
    const other = valueOf(await openQuizStorage('storage-test', factory));
    context.after(() => { storage.close(); other.close(); });
    const results = await Promise.all([
        storage.commitAnswer(command), other.commitAnswer({ ...command, attempt: { ...command.attempt, id: 'other-answer' } })
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(valueOf(await storage.listAttempts()).length, 1);
    assert.equal(valueOf(await storage.listConfusion()).at(0)?.shown, 1);
});

await test('session終了は保存済みの回答と整合し、終了後の新しい回答を拒否する', async (context) => {
    const { storage, command } = await fixture();
    context.after(() => storage.close());
    assert.equal((await storage.finishSession('session', { answered: 1, correct: 1, idk: 0, durationMs: 20 }, 20)).ok, false);
    valueOf(await storage.commitAnswer(command));
    const ended = valueOf(await storage.finishSession('session', { answered: 1, correct: 1, idk: 0, durationMs: 20 }, 20));
    assert.equal(ended.endedAt.kind, 'some');
    assert.equal((await storage.commitAnswer({ ...command, attempt: { ...command.attempt, id: 'late' } })).ok, false);
    assert.deepEqual(valueOf(await storage.commitAnswer(command)), { duplicate: true });
});

await test('テストmodeの回答は学習調度や統計を変更できない', async (context) => {
    const { storage, command, session } = await fixture();
    context.after(() => storage.close());
    valueOf(await storage.startSession({ ...session, id: sessionIdentity('test'), mode: 'test' }));
    const testCommand = { ...command, attempt: { ...command.attempt, sessionId: sessionIdentity('test') } };
    assert.equal((await storage.commitAnswer(testCommand)).ok, false);
    valueOf(await storage.commitAnswer({ ...testCommand, schedule: none, confusion: [], conceptStats: none }));
    assert.deepEqual(valueOf(await storage.listSchedule()), []);
});

await test('無効な題庫更新は履歴を保持し、有効な更新は孤立sessionを残さない', async (context) => {
    const { storage, command, packageRecord } = await fixture();
    context.after(() => storage.close());
    valueOf(await storage.commitAnswer(command));
    assert.equal((await storage.replacePackage({ ...packageRecord, json: '{}' }, { kind: 'some', value: packageRecord.revision })).ok, false);
    assert.equal(valueOf(await storage.listAttempts()).length, 1);
    valueOf(await storage.replacePackage({ ...packageRecord, json: quizJson('改訂'), updatedAt: 30 }, { kind: 'some', value: packageRecord.revision }));
    assert.deepEqual(valueOf(await storage.listAttempts()), []);
    assert.deepEqual(valueOf(await storage.listSchedule()), []);
    const session = valueOf(await storage.listSessions()).at(0);
    assert.ok(session);
    assert.equal(session.endedAt.kind, 'some');
    if (session.summary.kind === 'some') assert.equal(session.summary.value.answered, 0);
    valueOf(await storage.exportBackup());
    assert.equal((await storage.commitAnswer({ ...command, attempt: { ...command.attempt, id: 'stale-package' } })).ok, false);
});

await test('ユーザー削除は紐付く記録を同時削除し、同IDの再作成に履歴を継承しない', async (context) => {
    const { storage, command } = await fixture();
    context.after(() => storage.close());
    valueOf(await storage.commitAnswer(command));
    valueOf(await storage.deleteUser('user'));
    valueOf(await storage.createUser({ id: userIdentity('user'), name: '新規利用者', createdAt: 100 }));
    assert.deepEqual(valueOf(await storage.listAttempts()), []);
    assert.deepEqual(valueOf(await storage.listSessions()), []);
    assert.deepEqual(valueOf(await storage.listSchedule()), []);
    assert.deepEqual(valueOf(await storage.listConfusion()), []);
    assert.deepEqual(valueOf(await storage.listConceptStats()), []);
    valueOf(await storage.exportBackup());
});

await test('全データをsnapshotで往復し、不正参照の復元では既存データを変更しない', async (context) => {
    const { storage, command } = await fixture();
    const fresh = valueOf(await openQuizStorage('restore-test', new IDBFactory()));
    context.after(() => { storage.close(); fresh.close(); });
    valueOf(await storage.commitAnswer(command));
    valueOf(await storage.saveDraft({ id: 'draft', text: '{未完了', updatedAt: 3, expectedVersion: 0 }));
    valueOf(await storage.setSetting({ id: 'theme', value: 'dark' }));
    const backup = valueOf(await storage.exportBackup());
    const parsed: unknown = JSON.parse(JSON.stringify(backup));
    valueOf(await fresh.restoreBackup(parsed));
    assert.deepEqual(valueOf(await fresh.exportBackup()), backup);
    const invalid = { ...backup, records: { ...backup.records, users: [] } };
    assert.equal((await fresh.restoreBackup(invalid)).ok, false);
    assert.deepEqual(valueOf(await fresh.exportBackup()), backup);
    valueOf(await fresh.restoreBackup(parsed));
    assert.deepEqual(valueOf(await fresh.exportBackup()), backup);
});

await test('復元後は別タブの古い状態からの保存を拒否する', async (context) => {
    const { storage, factory } = await fixture();
    const other = valueOf(await openQuizStorage('storage-test', factory));
    context.after(() => { storage.close(); other.close(); });
    const backup = valueOf(await storage.exportBackup());
    valueOf(await storage.restoreBackup(backup));
    const stale = await other.saveDraft({ id: 'stale', text: 'old', updatedAt: 4, expectedVersion: 0 });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.error.kind, 'conflict');
    assert.deepEqual(valueOf(await storage.listDrafts()), []);
});

await test('復元途中の容量エラーを模擬しても全storeの変更をrollbackする', async (context) => {
    const { storage } = await fixture();
    context.after(() => storage.close());
    const before = valueOf(await storage.exportBackup());
    const backup = { ...before, records: { ...before.records, drafts: [{ id: 'quota', text: 'large', updatedAt: 4, version: 1 }] } };
    const descriptor = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'put');
    assert.ok(descriptor);
    const original: PropertyDescriptor = descriptor;
    function limitedPut(this: IDBObjectStore, value: unknown, key?: IDBValidKey): IDBRequest<IDBValidKey> {
        if (this.name === 'drafts') throw new DOMException('容量不足を模擬', 'QuotaExceededError');
        Object.defineProperty(IDBObjectStore.prototype, 'put', original);
        try {
            return key === undefined ? this.put(value) : this.put(value, key);
        } finally {
            Object.defineProperty(IDBObjectStore.prototype, 'put', { ...original, value: limitedPut });
        }
    }
    Object.defineProperty(IDBObjectStore.prototype, 'put', { ...original, value: limitedPut });
    try {
        assert.equal((await storage.restoreBackup(backup)).ok, false);
    } finally {
        Object.defineProperty(IDBObjectStore.prototype, 'put', original);
    }
    assert.deepEqual(valueOf(await storage.exportBackup()), before);
});

await test('遅れて届いた旧題庫はrevision比較で拒否される', async (context) => {
    const { storage, packageRecord } = await fixture();
    context.after(() => storage.close());
    const next = valueOf(await storage.replacePackage({ ...packageRecord, json: quizJson('新版'), updatedAt: 10 }, { kind: 'some', value: packageRecord.revision }));
    const stale = await storage.replacePackage({ ...packageRecord, updatedAt: 20 }, { kind: 'some', value: packageRecord.revision });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.error.kind, 'conflict');
    assert.deepEqual(valueOf(await storage.listPackages()), [next]);
});

await test('フォルダ操作は対象集合の追加・変更を検出し、一括移動と削除を確定する', async (context) => {
    const { storage } = await fixture();
    context.after(() => storage.close());
    const folder = valueOf(await storage.saveDraft({ id: 'a/', text: '', updatedAt: 0, expectedVersion: 0 }));
    const child = valueOf(await storage.saveDraft({ id: 'a/child', text: 'content', updatedAt: 0, expectedVersion: 0 }));
    assert.equal((await storage.deleteDraftTree('a/', [folder])).ok, false);
    assert.equal((await storage.moveDraftTree('a/', 'a/b/', [folder, child], 1)).ok, false);
    valueOf(await storage.saveDraft({ id: 'target/child', text: 'do not overwrite', updatedAt: 0, expectedVersion: 0 }));
    assert.equal((await storage.moveDraftTree('a/', 'target/', [folder, child], 1)).ok, false);
    assert.equal(valueOf(await storage.listDrafts()).length, 3);
    const moved = valueOf(await storage.moveDraftTree('a/', 'renamed/', [folder, child], 1));
    assert.deepEqual(moved.map((entry) => entry.id), ['renamed/', 'renamed/child']);
    assert.equal(valueOf(await storage.listDrafts()).some((entry) => entry.id.startsWith('a/')), false);
    valueOf(await storage.deleteDraftTree('renamed/', moved));
    assert.deepEqual(valueOf(await storage.listDrafts()).map((entry) => entry.id), ['target/child']);
});

await test('sessionの初期入力を保存し、題庫更新とbackup復元後も同じ問題と選択肢を再生する', async (context) => {
    const { storage, session, packageRecord, command } = await fixture();
    const fresh = valueOf(await openQuizStorage('replay-test', new IDBFactory()));
    context.after(() => { storage.close(); fresh.close(); });
    if (command.schedule.kind !== 'some') assert.fail('fixture requires a schedule');
    const initialSchedule = { ...command.schedule.value.next, state: 'REVIEW', dueAt: 0, lastAnsweredAt: none } as const;
    const replayRecord: SessionRecord = {
        ...session, id: sessionIdentity('replay-session'), replay: {
            ...session.replay, schedules: [initialSchedule],
            confusions: command.confusion.map((entry) => ({ conceptId: entry.conceptId, wrongConceptId: entry.wrongConceptId, score: 0.8 })),
            conceptStats: [{ id: storageKey(session.userId, packageRecord.id, command.attempt.conceptId), userId: session.userId,
                packageId: packageRecord.id, conceptId: command.attempt.conceptId, uncertainty: 0.8, recentIdk: 1 }]
        }
    };
    valueOf(await storage.startSession(replayRecord));
    const expected = replayQuestions(replayRecord);
    valueOf(await storage.replacePackage({ ...packageRecord, json: quizJson('更新後'), updatedAt: 100 }, { kind: 'some', value: packageRecord.revision }));
    const backup = valueOf(await storage.exportBackup());
    const wireBackup: unknown = JSON.parse(JSON.stringify(backup));
    valueOf(await fresh.restoreBackup(wireBackup));
    const restored = valueOf(await fresh.listSessions()).find((entry) => entry.id === replayRecord.id);
    assert.ok(restored);
    assert.deepEqual(restored.replay, replayRecord.replay);
    assert.deepEqual(replayQuestions(restored), expected);
    const invalid = { ...backup, records: { ...backup.records, sessions: [{ ...restored, replay: { ...restored.replay, questionIds: ['missing'] } }] } };
    assert.equal((await fresh.restoreBackup(invalid)).ok, false);
    assert.deepEqual(valueOf(await fresh.exportBackup()), backup);
});

await test('新サイトDBのschema1からassets storeを追加しても既存の草稿とユーザーを保持する', async (context) => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
        const opened = factory.open('schema-upgrade', 1);
        opened.onupgradeneeded = () => {
            for (const store of STORE_NAMES.filter((name) => name !== 'assets')) opened.result.createObjectStore(store, { keyPath: 'id' });
        };
        opened.onerror = () => reject(new Error('旧schema fixtureを作成できない。'));
        opened.onsuccess = () => {
            const database = opened.result;
            const transaction = database.transaction(['users', 'drafts'], 'readwrite');
            transaction.objectStore('users').put({ id: 'retained-user', name: '保持する利用者', createdAt: 0 });
            transaction.objectStore('drafts').put({ id: 'retained-draft', text: '{編集中', updatedAt: 0, version: 1 });
            transaction.oncomplete = () => { database.close(); resolve(); };
            transaction.onabort = () => { database.close(); reject(new Error('旧schema fixtureの保存が失敗した。')); };
        };
    });
    const storage = valueOf(await openQuizStorage('schema-upgrade', factory));
    context.after(() => storage.close());
    assert.equal(valueOf(await storage.listUsers()).at(0)?.id, 'retained-user');
    assert.equal(valueOf(await storage.listDrafts()).at(0)?.text, '{編集中');
    assert.ok(valueOf(await storage.saveDraft({ id: 'after-upgrade', text: 'new', updatedAt: 1, expectedVersion: 0 })).version > 1);
    assert.deepEqual(valueOf(await storage.listAssets()), []);
    assert.equal(valueOf(await storage.exportBackup()).version, 2);
});

await test('取得済みSVG原文を完全backupへ含め、復元後に同じ要求URLから取得できる', async (context) => {
    const { storage } = await fixture();
    const fresh = valueOf(await openQuizStorage('asset-restore', new IDBFactory()));
    context.after(() => { storage.close(); fresh.close(); });
    const asset = { id: 'https://example.test/figures/circle.svg?revision=2', text: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="2"/></svg>', updatedAt: 10 };
    valueOf(await storage.saveAsset(asset));
    assert.deepEqual(valueOf(await storage.getAsset(asset.id)), { kind: 'some', value: asset });
    assert.equal((await storage.saveAsset({ ...asset, text: '<old/>', updatedAt: 1 })).ok, false);
    const backup = valueOf(await storage.exportBackup());
    assert.deepEqual(backup.records.assets, [asset]);
    valueOf(await fresh.restoreBackup(backup));
    assert.deepEqual(valueOf(await fresh.getAsset(asset.id)), { kind: 'some', value: asset });
    const invalid = { ...backup, records: { ...backup.records, assets: [{ ...asset, id: 'javascript:alert(1)' }] } };
    assert.equal((await fresh.restoreBackup(invalid)).ok, false);
    assert.deepEqual(valueOf(await fresh.exportBackup()), backup);
});

await test('資産のURL・UTF8バイト上限を保存境界で検証し、全削除時にも残さない', async (context) => {
    const { storage } = await fixture();
    context.after(() => storage.close());
    const asset = { id: 'https://example.test/a.svg', text: '<svg/>', updatedAt: 1 };
    for (const id of ['data:image/svg+xml,<svg/>', 'https://user:pass@example.test/a.svg', 'https://example.test/a.svg#x']) {
        assert.equal((await storage.saveAsset({ ...asset, id })).ok, false);
    }
    assert.equal((await storage.saveAsset({ ...asset, text: 'あ'.repeat(666_667) })).ok, false);
    assert.deepEqual(valueOf(await storage.listAssets()), []);
    valueOf(await storage.saveAsset(asset));
    valueOf(await storage.clearAll());
    assert.deepEqual(valueOf(await storage.listAssets()), []);
});
