import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { conceptId, packageIdentity, parseSessionId, parseUserId, patternId, questionId } from '../../src/core/identity.ts';
import type { PackageId } from '../../src/core/identity.ts';
import { parseQuizJson, serializeQuiz } from '../../src/core/schema.ts';
import { prepareQuiz } from '../../src/core/quiz-engine.ts';
import { createSession } from '../../src/core/session.ts';
import { initialSchedule, updateSchedule } from '../../src/core/study.ts';
import { none, some } from '../../src/core/result.ts';
import type { Result } from '../../src/core/result.ts';
import type { CommitAnswer, PackageRecord } from '../../src/core/records.ts';
import { openQuizStorage } from '../../src/web/storage/database.ts';

function valueOf<T, E>(value: Result<T, E>): T { if (!value.ok) assert.fail(JSON.stringify(value.error)); return value.value; }
function quizJson(label = 'A'): string {
    return JSON.stringify({ version: 3, title: '同名題庫', description: '局所IDは出典ごとに分離する',
        table: [{ id: 'same-row', conceptId: 'same-concept', answer: label }, { id: 'other-row', conceptId: 'other-concept', answer: 'B' }],
        patterns: [{ id: 'same-pattern', tokens: [{ type: 'hide', id: 'h', value: [{ type: 'key', field: 'answer' }], answer: { mode: 'choice_from_entities' } }] }] });
}
async function fixture() {
    const storage = valueOf(await openQuizStorage('mixed-package-scope', new IDBFactory()));
    const userId = valueOf(parseUserId('user')); const sessionId = valueOf(parseSessionId('mixed-session'));
    valueOf(await storage.createUser({ id: userId, name: '利用者', createdAt: 0 }));
    const packages: (PackageRecord & Readonly<{ id: PackageId }>)[] = [];
    for (const source of ['https://first.example/data/quiz.json', 'https://second.example/data/quiz.json']) {
        const id = valueOf(packageIdentity({ kind: 'remote', url: source }));
        const json = serializeQuiz(valueOf(parseQuizJson(quizJson())));
        const saved = valueOf(await storage.replacePackage({ id, source, json, revision: json, updatedAt: 0 }, none));
        packages.push({ ...saved, id });
    }
    const candidates = packages.flatMap((record) => prepareQuiz(valueOf(parseQuizJson(record.json)), record.id, record.revision).candidates);
    const session = valueOf(createSession({ id: sessionId, userId, mode: 'study', completion: { kind: 'questions', count: 10 },
        candidates, allowedPatternIds: candidates.map((candidate) => candidate.patternId), seed: 'mixed-scope', now: 0, schedules: [], confusions: [], conceptStats: [] }));
    valueOf(await storage.startSession(session.record));
    for (const [index, record] of packages.entries()) {
        const now = (index + 1) * 10;
        const concept = conceptId(record.id, 'same-concept');
        const schedule = updateSchedule(initialSchedule({ userId, packageId: record.id, questionId: questionId(record.id, 'same-pattern', 'same-row'), patternId: patternId(record.id, 'same-pattern'), conceptId: concept }, 0), 'strong', 10, now, 42).schedule;
        const command: CommitAnswer = {
            attempt: { id: `answer-${index}`, sessionId, userId, packageId: record.id, questionId: schedule.questionId, patternId: schedule.patternId, conceptId: concept, chosenConceptId: some(concept), result: 'strong', answerMs: 10, answeredAt: now },
            schedule: some({ expectedVersion: 0, next: schedule }),
            confusion: [{ conceptId: concept, wrongConceptId: conceptId(record.id, 'other-concept'), shown: 1, chosen: 0, idkNear: 0 }],
            conceptStats: some({ conceptId: concept, uncertaintyMultiplier: 0.85, uncertaintyAdd: 0.1, recentIdkMultiplier: 0.7, recentIdkAdd: 0.05 })
        };
        valueOf(await storage.commitAnswer(command));
    }
    const [first, second] = packages; assert.ok(first); assert.ok(second);
    return { storage, first, second, session };
}

await test('同じ局所row/conceptの混合sessionで一方だけ更新しても他方の学習記録を保持する', async (context) => {
    const { storage, first, second, session } = await fixture(); context.after(() => storage.close());
    const before = valueOf(await storage.exportBackup());
    assert.equal(before.records.attempts.length, 2); assert.equal(before.records.schedule.length, 2);
    assert.equal(before.records.conceptStats.length, 2); assert.equal(before.records.confusion.length, 2);
    assert.notEqual(before.records.schedule.at(0)?.id, before.records.schedule.at(1)?.id);
    valueOf(await storage.replacePackage({ ...first, json: quizJson('更新したA'), updatedAt: 30 }, some(first.revision)));
    const after = valueOf(await storage.exportBackup());
    for (const name of ['attempts', 'schedule', 'confusion', 'conceptStats'] as const) {
        assert.deepEqual(after.records[name], before.records[name].filter((record) => record.packageId === second.id));
    }
    const retained = after.records.sessions.find((record) => record.id === session.record.id); assert.ok(retained);
    assert.deepEqual(retained.packageIds, [first.id, second.id]);
    assert.deepEqual(retained.endedAt, some(30));
    assert.deepEqual(retained.summary, some({ answered: 1, correct: 1, idk: 0, durationMs: 30 }));
    assert.deepEqual(retained.replay, session.record.replay);
    assert.equal(after.records.packages.find((record) => record.id === second.id)?.revision, second.revision);
});

await test('混合sessionの一題庫削除は他方の参照と集計を保ち、最後の題庫削除で孤立記録を残さない', async (context) => {
    const { storage, first, second, session } = await fixture(); context.after(() => storage.close());
    const before = valueOf(await storage.exportBackup());
    valueOf(await storage.deletePackage(first.id, 30));
    const partial = valueOf(await storage.exportBackup());
    for (const name of ['attempts', 'schedule', 'confusion', 'conceptStats'] as const) assert.deepEqual(partial.records[name], before.records[name].filter((record) => record.packageId === second.id));
    const retained = partial.records.sessions.find((record) => record.id === session.record.id); assert.ok(retained);
    assert.deepEqual(retained.packageIds, [second.id]); assert.deepEqual(retained.endedAt, some(30));
    assert.deepEqual(retained.summary, some({ answered: 1, correct: 1, idk: 0, durationMs: 30 }));
    valueOf(await storage.deletePackage(second.id, 40));
    const empty = valueOf(await storage.exportBackup());
    for (const name of ['packages', 'attempts', 'sessions', 'schedule', 'confusion', 'conceptStats'] as const) assert.deepEqual(empty.records[name], []);
    assert.equal(empty.records.users.length, 1);
});
