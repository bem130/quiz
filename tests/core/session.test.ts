import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packageIdentity, parsePackageId, parseUserId, parseSessionId } from '../../src/core/identity.ts';
import { prepareQuiz } from '../../src/core/quiz-engine.ts';
import type { Question } from '../../src/core/quiz-engine.ts';
import { parseQuiz, parseQuizJson, serializeQuiz } from '../../src/core/schema.ts';
import { answerSession, confirmAnswer, createSession, finishSession, nextQuestion, retryCandidates } from '../../src/core/session.ts';
import type { AnswerInput, SessionConfig, SessionState } from '../../src/core/session.ts';
import { initialSchedule } from '../../src/core/study.ts';
import type { ScheduleRecord } from '../../src/core/study.ts';
import type { Result } from '../../src/core/result.ts';

function userIdentity(value: string) { return valueOf(parseUserId(value)); }
function sessionIdentity(value: string) { return valueOf(parseSessionId(value)); }

function valueOf<T, E>(result: Result<T, E>): T {
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
}
const packageId = valueOf(packageIdentity({ kind: 'draft', id: 'sample' }));
const quiz = valueOf(parseQuiz({ title: '題庫', description: '説明', table: [
    { id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }
], patterns: ['first', 'second'].map((id) => ({ id, tokens: [{ type: 'hide', id: 'answer',
    value: [{ type: 'key', field: 'label' }], answer: { mode: 'choice_from_entities' } }] })) }));
const prepared = prepareQuiz(quiz, packageId, serializeQuiz(quiz));
function session(overrides: Partial<SessionConfig> = {}): SessionState {
    return valueOf(createSession({ id: sessionIdentity('session-1'), userId: userIdentity('guest'), mode: 'test',
        completion: { kind: 'questions', count: 20 }, candidates: prepared.candidates,
        allowedPatternIds: [...new Set(prepared.candidates.map((candidate) => candidate.patternId))],
        seed: 'fixed', now: 0, schedules: [], confusions: [], conceptStats: [], ...overrides }));
}
function question(state: SessionState): Question {
    assert.equal(state.phase.kind, 'question');
    if (state.phase.kind !== 'question') throw new Error('Expected question phase');
    return state.phase.question;
}
function saveCorrect(state: SessionState, now: number): SessionState {
    const current = question(state);
    const pending = valueOf(answerSession(state, { operationId: `answer-${state.attempts.length}`,
        selection: { kind: 'option', optionId: current.correctOptionId }, now }));
    assert.equal(pending.phase.kind, 'saving');
    return valueOf(confirmAnswer(pending, `answer-${state.attempts.length}`));
}

await test('選択pattern範囲を守り、テストで既出を返さず枯渇時は正常終了する', () => {
    const first = prepared.candidates.at(0);
    assert.ok(first);
    let state = session({ allowedPatternIds: [first.patternId] });
    const seen = new Set<string>();
    for (let index = 0; index < 3; index += 1) {
        state = valueOf(nextQuestion(state, index * 100));
        const current = question(state);
        assert.equal(current.patternId, first.patternId);
        assert.ok(!seen.has(current.id));
        seen.add(current.id);
        const pending = valueOf(answerSession(state, { operationId: `a${index}`,
            selection: { kind: 'option', optionId: current.correctOptionId }, now: index * 100 + 1 }));
        if (pending.phase.kind !== 'saving') throw new Error('Expected saving');
        assert.deepEqual(pending.phase.commit.schedule, { kind: 'none' });
        assert.deepEqual(pending.phase.commit.confusion, []);
        assert.deepEqual(pending.phase.commit.conceptStats, { kind: 'none' });
        state = valueOf(confirmAnswer(pending, `a${index}`));
    }
    state = valueOf(nextQuestion(state, 400));
    assert.equal(state.phase.kind, 'finished');
    if (state.phase.kind === 'finished') assert.equal(state.phase.reason, 'exhausted');
    assert.equal(state.attempts.length, 3);
});

await test('保存待ちは次問と中断を拒否し、同一操作の再送は固定DTOを保持する', () => {
    const current = valueOf(nextQuestion(session(), 100));
    const input: AnswerInput = { operationId: 'operation-1', selection: { kind: 'option', optionId: question(current).correctOptionId }, now: 200 };
    const pending = valueOf(answerSession(current, input));
    assert.equal(nextQuestion(pending, 300).ok, false);
    assert.equal(finishSession(pending, 300).ok, false);
    assert.equal(valueOf(answerSession(pending, input)), pending);
    assert.equal(confirmAnswer(pending, 'other-operation').ok, false);
    assert.equal(answerSession(pending, { ...input, now: 201 }).ok, false);
    const confirmed = valueOf(confirmAnswer(pending, input.operationId));
    assert.equal(confirmed.phase.kind, 'answered');
    assert.equal(confirmed.attempts.at(0)?.questionId, question(current).id);
    assert.equal(confirmed.attempts.at(0)?.sessionId, 'session-1');
    assert.equal(confirmed.history.at(0)?.question, question(current));
    assert.equal(confirmed.history.at(0)?.attempt, confirmed.attempts.at(0));
    assert.equal(confirmAnswer(confirmed, input.operationId).ok, false);
});

await test('学習は同じ問題のdue到来で再出題し、dueまでは待機状態を返す', () => {
    const first = prepared.candidates.at(0);
    assert.ok(first);
    let state = session({ mode: 'study', candidates: [first], completion: { kind: 'questions', count: 3 } });
    state = valueOf(nextQuestion(state, 0));
    state = saveCorrect(state, 1);
    state = valueOf(nextQuestion(state, 2));
    assert.equal(state.phase.kind, 'waiting');
    if (state.phase.kind !== 'waiting') throw new Error('Expected waiting');
    const dueAt = state.phase.dueAt;
    assert.equal(valueOf(nextQuestion(state, dueAt - 1)).phase.kind, 'waiting');
    state = valueOf(nextQuestion(state, dueAt));
    assert.equal(question(state).id, first.id);
});

await test('drainは将来dueの問題を待たず、対象範囲のdueを解消した時点で終了する', () => {
    const first = prepared.candidates.at(0);
    assert.ok(first);
    const schedule = { ...initialSchedule({ userId: userIdentity('guest'), packageId, questionId: first.id,
        patternId: first.patternId, conceptId: first.conceptId }, 0), state: 'RELEARNING' as const, dueAt: 0 };
    let state = session({ mode: 'study', candidates: [first], schedules: [schedule], completion: { kind: 'drain' } });
    state = valueOf(nextQuestion(state, 0));
    state = saveCorrect(state, 1);
    state = valueOf(nextQuestion(state, 2));
    assert.equal(state.phase.kind, 'finished');
    if (state.phase.kind === 'finished') assert.equal(state.phase.reason, 'drained');
});

await test('時間切れ後の正答クリックもTimeoutとして保存し、確定後に終了する', () => {
    let state = session({ mode: 'study', completion: { kind: 'time', durationMs: 10 } });
    state = valueOf(nextQuestion(state, 0));
    state = saveCorrect(state, 11);
    assert.equal(state.attempts.at(0)?.result, 'timeout');
    state = valueOf(nextQuestion(state, 11));
    assert.equal(state.phase.kind, 'finished');
    if (state.phase.kind === 'finished') assert.equal(state.phase.reason, 'time');
});

await test('IDKの任意選択は正誤に影響せず、補助混同情報だけを記録する', () => {
    const state = valueOf(nextQuestion(session({ mode: 'study' }), 0));
    const nearest = question(state).options.find((option) => !option.isCorrect);
    assert.ok(nearest);
    const pending = valueOf(answerSession(state, { operationId: 'idk', now: 10,
        selection: { kind: 'idk', nearestOptionId: { kind: 'some', value: nearest.id } } }));
    assert.equal(pending.phase.kind, 'saving');
    if (pending.phase.kind !== 'saving') throw new Error('Expected saving');
    assert.equal(pending.phase.commit.attempt.result, 'idk');
    assert.ok(pending.phase.commit.confusion.some((delta) => delta.wrongConceptId === nearest.conceptId && delta.idkNear === 1 && delta.chosen === 0));
    assert.equal(pending.phase.commit.schedule.kind, 'some');
    if (pending.phase.commit.schedule.kind === 'some') assert.equal(pending.phase.commit.schedule.value.next.lapses, 0);
});

await test('誤答再挑戦は元sessionの記録先を使い回さず、新しいsessionへ同じ題目を渡す', () => {
    let state = valueOf(nextQuestion(session(), 0));
    const wrong = question(state).options.find((option) => !option.isCorrect);
    assert.ok(wrong);
    state = valueOf(answerSession(state, { operationId: 'wrong', now: 1, selection: { kind: 'option', optionId: wrong.id } }));
    state = valueOf(confirmAnswer(state, 'wrong'));
    const retry = retryCandidates(state);
    assert.equal(retry.length, 1);
    const second = valueOf(nextQuestion(session({ id: sessionIdentity('session-2'), candidates: retry }), 2));
    const answered = saveCorrect(second, 3);
    assert.equal(answered.attempts.at(0)?.sessionId, 'session-2');
});

await test('同じseed・定義・設定で問題列と選択肢順を完全に再現する', () => {
    const run = (): readonly string[] => {
        let state = session();
        const sequence: string[] = [];
        for (let index = 0; index < prepared.capacity; index += 1) {
            state = valueOf(nextQuestion(state, index * 10));
            sequence.push(JSON.stringify([question(state).id, question(state).options.map((option) => option.id)]));
            state = saveCorrect(state, index * 10 + 1);
        }
        return sequence;
    };
    assert.deepEqual(run(), run());
});

await test('期限に達した復習も常に現在の選択範囲で絞り込む', () => {
    const first = prepared.candidates.at(0);
    const outside = prepared.candidates.find((candidate) => candidate.patternId !== first?.patternId);
    assert.ok(first);
    assert.ok(outside);
    const schedules = [first, outside].map((candidate) => ({
        ...initialSchedule({ userId: userIdentity('guest'), packageId, questionId: candidate.id,
            patternId: candidate.patternId, conceptId: candidate.conceptId }, 0), state: 'REVIEW' as const
    }));
    let state = session({ mode: 'study', allowedPatternIds: [first.patternId], schedules, completion: { kind: 'drain' } });
    state = valueOf(nextQuestion(state, 0));
    assert.equal(question(state).id, first.id);
    assert.equal(state.schedules.length, 1);
});

await test('混同補修は同じペアを一会話で2回まで扱い、残りは新規出題へ戻る', () => {
    const first = prepared.candidates.at(0);
    const other = prepared.candidates.find((candidate) => candidate.conceptId !== first?.conceptId);
    assert.ok(first);
    assert.ok(other);
    let state = session({ mode: 'study', confusions: [{ conceptId: first.conceptId, wrongConceptId: other.conceptId, score: 0.9 }] });
    let repaired = 0;
    for (let index = 0; index < prepared.capacity; index += 1) {
        state = valueOf(nextQuestion(state, index * 10));
        assert.equal(state.phase.kind, 'question');
        if (state.phase.kind === 'question' && state.phase.stage === 'repair') repaired += 1;
        assert.ok(repaired <= 2);
        state = saveCorrect(state, index * 10 + 1);
    }
    assert.equal(repaired, 2);
});

await test('高い不確実度は補修とWeak判定へ反映し、ユーザーをまたがない', () => {
    const first = prepared.candidates.at(0);
    assert.ok(first);
    const stats = { id: 'stat', userId: userIdentity('guest'), packageId, conceptId: first.conceptId, uncertainty: 0.8, recentIdk: 3 };
    let state = session({ mode: 'study', conceptStats: [stats] });
    state = valueOf(nextQuestion(state, 0));
    assert.equal(state.phase.kind, 'question');
    if (state.phase.kind === 'question') assert.equal(state.phase.stage, 'repair');
    assert.equal(question(state).conceptId, first.conceptId);
    state = saveCorrect(state, 1);
    assert.equal(state.attempts.at(0)?.result, 'weak');
    const different = valueOf(nextQuestion(session({ mode: 'study', conceptStats: [{ ...stats, userId: userIdentity('other') }] }), 0));
    if (different.phase.kind === 'question') assert.equal(different.phase.stage, 'new');
});

await test('誤答の短期リトライは3〜7題後に同じ題目を再生成する', () => {
    const larger = valueOf(parseQuiz({ title: '多い題庫', description: '遅延リトライ',
        table: Array.from({ length: 12 }, (_, index) => ({ id: `r${index}`, label: `L${index}` })),
        patterns: [{ id: 'p', tokens: [{ type: 'hide', id: 'answer', value: [{ type: 'key', field: 'label' }],
            answer: { mode: 'choice_from_entities' } }] }] }));
    const largerPrepared = prepareQuiz(larger, packageId, serializeQuiz(larger));
    let state = session({ mode: 'study', candidates: largerPrepared.candidates,
        allowedPatternIds: [...new Set(largerPrepared.candidates.map((candidate) => candidate.patternId))] });
    state = valueOf(nextQuestion(state, 0));
    const original = question(state);
    const wrong = original.options.find((option) => !option.isCorrect);
    assert.ok(wrong);
    state = valueOf(answerSession(state, { operationId: 'initial-wrong', now: 1,
        selection: { kind: 'option', optionId: wrong.id } }));
    state = valueOf(confirmAnswer(state, 'initial-wrong'));
    const retry = state.retries.at(0);
    assert.ok(retry);
    assert.ok(retry.availableAfter >= 4 && retry.availableAfter <= 8);
    while (state.attempts.length < retry.availableAfter) {
        const now = state.attempts.length * 10;
        state = valueOf(nextQuestion(state, now));
        assert.notEqual(question(state).id, original.id);
        state = saveCorrect(state, now + 1);
    }
    state = valueOf(nextQuestion(state, 100));
    assert.equal(question(state).id, original.id);
    if (state.phase.kind === 'question') assert.equal(state.phase.stage, 'retry');
});

await test('目標到達と中断は保存済み回答数を分母にし、時計の逆行を拒否する', () => {
    let state = valueOf(nextQuestion(session({ completion: { kind: 'questions', count: 1 } }), 5));
    state = saveCorrect(state, 10);
    assert.equal(nextQuestion(state, 9).ok, false);
    state = valueOf(nextQuestion(state, 11));
    assert.equal(state.phase.kind, 'finished');
    if (state.phase.kind === 'finished') {
        assert.equal(state.phase.reason, 'target');
        assert.equal(state.phase.summary.answered, 1);
    }
    const interrupted = valueOf(finishSession(session(), 50));
    if (interrupted.phase.kind === 'finished') {
        assert.equal(interrupted.phase.reason, 'interrupted');
        assert.equal(interrupted.phase.summary.answered, 0);
    }
});

await test('保存したreplay descriptorだけから候補subset・順序・選択肢を再構築できる', () => {
    const canonical = serializeQuiz(quiz);
    const source = prepareQuiz(quiz, packageId, canonical);
    const subset = source.candidates.filter((candidate) => candidate.row.id === 'a');
    const original = session({ candidates: [...subset].reverse(), completion: { kind: 'questions', count: 2 } });
    const savedRecord = structuredClone(original.record);
    const all = savedRecord.replay.packages.flatMap((entry) => {
        const parsed = valueOf(parseQuizJson(entry.revision));
        return prepareQuiz(parsed, valueOf(parsePackageId(entry.id)), entry.revision).candidates;
    });
    const reconstructed = savedRecord.replay.questionIds.map((id) => {
        const found = all.find((candidate) => candidate.id === id);
        assert.ok(found);
        return found;
    });
    const replayed = valueOf(createSession({ id: savedRecord.id, userId: savedRecord.userId,
        mode: savedRecord.mode, candidates: reconstructed, seed: savedRecord.replay.seed,
        completion: savedRecord.replay.completion, retry: savedRecord.replay.retry, allowedPatternIds: savedRecord.replay.allowedPatternIds,
        now: savedRecord.startedAt, schedules: savedRecord.replay.schedules,
        confusions: savedRecord.replay.confusions, conceptStats: savedRecord.replay.conceptStats }));
    assert.deepEqual(replayed.config.candidates.map((candidate) => candidate.id), original.config.candidates.map((candidate) => candidate.id));
    assert.deepEqual(question(valueOf(nextQuestion(replayed, 0))), question(valueOf(nextQuestion(original, 0))));
    assert.equal(replayed.config.candidates.length, 2);
});

await test('明示的な学習再挑戦は未来の調度を保持したまま候補を即時一巡し、replayから同じ順序を再現する', () => {
    const candidates = prepared.candidates.filter(candidate => candidate.pattern.id === 'first');
    const schedules = candidates.map(candidate => ({ ...initialSchedule({
        userId: userIdentity('guest'), packageId: candidate.packageId, questionId: candidate.id,
        patternId: candidate.patternId, conceptId: candidate.conceptId
    }, 0), state: 'RELEARNING', version: 8, intervalSec: 120, dueAt: 120_000 } as const));
    const original = session({ mode: 'study', retry: true, completion: { kind: 'questions', count: candidates.length }, candidates, schedules });
    assert.equal(original.config.retry, true); assert.equal(original.record.replay.retry, true);
    assert.deepEqual(original.schedules, schedules);
    const replay = original.record.replay;
    const restored = valueOf(createSession({ id: original.record.id, userId: original.record.userId,
        mode: original.record.mode, retry: replay.retry, completion: replay.completion,
        candidates, allowedPatternIds: replay.allowedPatternIds, seed: replay.seed, now: original.record.startedAt,
        schedules: replay.schedules, confusions: replay.confusions, conceptStats: replay.conceptStats }));
    const run = (start: SessionState): readonly string[] => {
        let current = start;
        const ids: string[] = [];
        for (let index = 0; index < candidates.length; index += 1) {
            // 一問目の更新後はdueを大幅に越えても、その候補を繰り返さない。
            const now = index * 1_000_000;
            current = valueOf(nextQuestion(current, now));
            const selected = question(current); ids.push(selected.id);
            assert.equal(current.phase.kind === 'question' ? current.phase.stage : '', 'retry');
            const pending = valueOf(answerSession(current, { operationId: `retry-${index}`, selection: { kind: 'option', optionId: selected.correctOptionId }, now: now + 1 }));
            if (pending.phase.kind !== 'saving' || pending.phase.commit.schedule.kind !== 'some') assert.fail('Schedule update missing');
            assert.equal(pending.phase.commit.schedule.value.expectedVersion, 8);
            assert.equal(pending.phase.commit.schedule.value.next.version, 9);
            current = valueOf(confirmAnswer(pending, `retry-${index}`));
        }
        assert.equal(new Set(ids).size, candidates.length);
        current = valueOf(nextQuestion(current, candidates.length * 1_000_000));
        assert.equal(current.phase.kind === 'finished' ? current.phase.reason : '', 'target');
        return ids;
    };
    assert.deepEqual(run(original), run(restored));
    assert.equal(createSession({ ...original.config, completion: { kind: 'questions', count: 1 } }).ok, false);
    assert.equal(createSession({ ...original.config, completion: { kind: 'time', durationMs: 60_000 } }).ok, false);
    assert.equal(session().config.retry, false); assert.equal(session().record.replay.retry, false);
});

await test('候補数とschedule数が増えても開始と次問のschedule参照回数は線形である', () => {
    const large = valueOf(parseQuiz({ title: '索引', description: '作業量の回帰検証',
        table: Array.from({ length: 1000 }, (_, index) => ({ id: `r${index}`, label: `L${index}` })),
        patterns: [{ id: 'p', tokens: [{ type: 'hide', id: 'h', value: [{ type: 'key', field: 'label' }],
            answer: { mode: 'choice_from_entities' } }] }] }));
    const candidates = prepareQuiz(large, packageId, serializeQuiz(large)).candidates;
    let reads = 0;
    const schedules = candidates.map<ScheduleRecord>((candidate) => ({ ...initialSchedule({
        userId: userIdentity('guest'), packageId, questionId: candidate.id, patternId: candidate.patternId,
        conceptId: candidate.conceptId
    }, 0), state: 'REVIEW', get questionId() { reads += 1; return candidate.id; } }));
    const state = session({ mode: 'study', candidates, schedules,
        allowedPatternIds: [...new Set(candidates.map((candidate) => candidate.patternId))] });
    assert.ok(reads <= candidates.length * 2, `createSession schedule reads: ${reads}`);
    reads = 0;
    const next = valueOf(nextQuestion(state, 100));
    assert.equal(next.phase.kind, 'question');
    assert.ok(reads <= candidates.length * 2, `nextQuestion schedule reads: ${reads}`);
});

await test('質問とwaitingへの遷移後も時計の逆行を拒否し、論理時刻は保存DTOへ含めない', () => {
    const first = prepared.candidates.at(0);
    assert.ok(first);
    let state = valueOf(nextQuestion(session({ mode: 'study', candidates: [first] }), 100));
    assert.equal(finishSession(state, 99).ok, false);
    assert.equal(answerSession(state, { operationId: 'backwards', now: 99, selection: { kind: 'timeout' } }).ok, false);
    state = saveCorrect(state, 101);
    state = valueOf(nextQuestion(state, 200));
    assert.equal(state.phase.kind, 'waiting');
    assert.equal(nextQuestion(state, 199).ok, false);
    assert.equal(finishSession(state, 199).ok, false);
    const finished = valueOf(finishSession(state, 201));
    assert.equal(finished.clockAt, 201);
    assert.equal('clockAt' in finished.record, false);
    assert.equal('clockAt' in finished.record.replay, false);
});

await test('無関係な不確実度補修では混同ペアの補修予算を消費しない', () => {
    const large = valueOf(parseQuiz({ title: '補修', description: '混同と不確実度の併存',
        table: Array.from({ length: 12 }, (_, index) => ({ id: String(index), label: String(index) })),
        patterns: [{ id: 'p', tokens: [{ type: 'hide', id: 'h', value: [{ type: 'key', field: 'label' }],
            answer: { mode: 'choice_from_entities' } }] }] }));
    const candidates = prepareQuiz(large, packageId, serializeQuiz(large)).candidates;
    const first = candidates.at(0); const second = candidates.at(1);
    assert.ok(first); assert.ok(second);
    const pair = { conceptId: first.conceptId, wrongConceptId: second.conceptId, score: 0.9 };
    let state = session({ mode: 'study', candidates, seed: '1', confusions: [pair],
        allowedPatternIds: [first.patternId], conceptStats: candidates.slice(2).map((candidate) => ({
            id: candidate.id, userId: userIdentity('guest'), packageId, conceptId: candidate.conceptId, uncertainty: 0.9, recentIdk: 0
        })) });
    for (let index = 0; index < 3; index += 1) {
        state = valueOf(nextQuestion(state, index * 10));
        state = saveCorrect(state, index * 10 + 1);
    }
    const actualPairRepairs = state.history.filter((entry) => entry.stage === 'repair' &&
        (entry.question.conceptId === pair.conceptId || entry.question.conceptId === pair.wrongConceptId)).length;
    assert.equal(actualPairRepairs, 0);
    assert.equal(state.repairCounts[JSON.stringify([pair.conceptId, pair.wrongConceptId])] ?? 0, actualPairRepairs);
});
