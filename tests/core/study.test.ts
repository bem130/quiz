import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialSchedule, updateSchedule } from '../../src/core/study.ts';
import type { AnswerResult, ScheduleRecord } from '../../src/core/study.ts';

function initial(): ScheduleRecord {
    return initialSchedule({ userId: 'guest', packageId: 'package', questionId: 'question::with::separators',
        patternId: 'pattern::with::separators', conceptId: 'concept' }, 1000);
}

await test('短期学習と再学習の段階を進め、正答でREVIEWへ戻る', () => {
    let schedule = initial();
    const intervals = [30, 300, 3600];
    for (const interval of intervals) {
        schedule = updateSchedule(schedule, 'strong', 1000, 2000, 42).schedule;
        assert.equal(schedule.state, 'LEARNING');
        assert.equal(schedule.intervalSec, interval);
    }
    schedule = updateSchedule(schedule, 'strong', 1000, 2000, 42).schedule;
    assert.equal(schedule.state, 'REVIEW');
    schedule = updateSchedule(schedule, 'wrong', 1000, 3000, 42).schedule;
    assert.equal(schedule.state, 'RELEARNING');
    assert.equal(schedule.intervalSec, 120);
    schedule = updateSchedule(schedule, 'strong', 1000, 4000, 42).schedule;
    assert.equal(schedule.state, 'RELEARNING');
    assert.equal(schedule.intervalSec, 1800);
    schedule = updateSchedule(schedule, 'strong', 1000, 5000, 42).schedule;
    assert.equal(schedule.state, 'REVIEW');
});

await test('全状態×全回答で版・範囲・入力不変性を維持し、IDKはlapsesを増やさない', () => {
    const results: readonly AnswerResult[] = ['strong', 'weak', 'wrong', 'idk', 'timeout'];
    const states: readonly ScheduleRecord['state'][] = ['NEW', 'LEARNING', 'REVIEW', 'RELEARNING'];
    for (const state of states) {
        for (const result of results) {
            const before = Object.freeze({ ...initial(), state, intervalSec: 20000, ease: 2.8, version: 3 });
            const after = updateSchedule(before, result, 1000, 6000, 42);
            assert.equal(after.schedule.version, 4);
            assert.ok(after.schedule.intervalSec >= 20 && after.schedule.intervalSec <= 21600);
            assert.ok(after.schedule.ease >= 1.3 && after.schedule.ease <= 2.8);
            assert.ok(after.schedule.dueAt > 6000);
            assert.deepEqual(after, updateSchedule(before, result, 1000, 6000, 42));
            assert.equal(before.version, 3);
            assert.equal(after.schedule.lapses, result === 'wrong' || result === 'timeout' ? 1 : 0);
            assert.equal(after.schedule.questionId, before.questionId);
            assert.equal(after.schedule.patternId, before.patternId);
        }
    }
});

await test('Weakは短期ステップを飛ばさず、NEWを数時間先へ送らない', () => {
    const first = updateSchedule(initial(), 'weak', 10000, 2000, 42).schedule;
    const second = updateSchedule(first, 'weak', 10000, 3000, 42).schedule;
    assert.equal(first.state, 'LEARNING');
    assert.equal(second.state, 'LEARNING');
    assert.equal(second.stepIndex, 0);
    assert.equal(second.intervalSec, 30);
});
