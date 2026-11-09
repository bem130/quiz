import { drawRandom } from './random.ts';
import type { RandomState } from './random.ts';
import type { AnswerResult, ScheduleRecord } from './records.ts';
export type { AnswerResult, ScheduleRecord } from './records.ts';

export type StudyState = 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING';
export type ScheduleIdentity = Readonly<{
    userId: string; packageId: string; questionId: string; patternId: string; conceptId: string;
}>;

/** 保存キーは文字列の分割では復元せず、各IDをレコードの独立した項目に保持する。 */
export function initialSchedule(identity: ScheduleIdentity, now: number): ScheduleRecord {
    return {
        ...identity, id: JSON.stringify([identity.userId, identity.questionId]),
        state: 'NEW', dueAt: now, intervalSec: 0, ease: 2.5, stepIndex: 0,
        streak: 0, lapses: 0, version: 0, lastAnsweredAt: { kind: 'none' }
    };
}

function intervalForStep(state: 'LEARNING' | 'RELEARNING', step: number): number {
    if (state === 'LEARNING') {
        if (step <= 0) return 30;
        if (step === 1) return 300;
        return 3600;
    }
    return step <= 0 ? 120 : 1800;
}

/**
 * 学習の一回分の遷移。Strongは短期段階を進め、Weakは短期段階を維持する。
 * Wrong/Timeoutは再学習を開始しlapsesを増やす。IDKではlapsesを増やさない。
 * 再学習の120s→1800sを正答で完了するとREVIEWへ戻す。
 * 時刻・乱数を明示入力し、保存I/Oは呼び出し側が原子的に行う。
 */
export function updateSchedule(
    previous: ScheduleRecord,
    result: AnswerResult,
    answerMs: number,
    now: number,
    random: RandomState
): Readonly<{ schedule: ScheduleRecord; random: RandomState }> {
    let state = previous.state;
    let stepIndex = previous.stepIndex;
    let interval = previous.intervalSec;
    let ease = previous.ease;
    let streak = previous.streak;
    let lapses = previous.lapses;
    switch (result) {
        case 'wrong':
        case 'timeout':
        case 'idk':
            state = 'RELEARNING';
            stepIndex = 0;
            interval = 120;
            ease -= result === 'idk' ? 0.04 : 0.08;
            streak = 0;
            lapses += result === 'idk' ? 0 : 1;
            break;
        case 'strong':
        case 'weak':
            streak += 1;
            ease = Math.min(2.8, Math.max(1.3, ease + (result === 'strong' ? 0.02 : -0.02)));
            switch (state) {
                case 'NEW':
                    state = 'LEARNING';
                    stepIndex = 0;
                    interval = 30;
                    break;
                case 'LEARNING':
                case 'RELEARNING': {
                    const lastStep = state === 'LEARNING' ? 2 : 1;
                    if (result === 'strong' && stepIndex >= lastStep) {
                        state = 'REVIEW';
                        stepIndex = 0;
                        interval = Math.max(1800, interval * ease);
                    } else {
                        stepIndex += result === 'strong' ? 1 : 0;
                        interval = intervalForStep(state, stepIndex);
                    }
                    break;
                }
                case 'REVIEW':
                    interval = Math.max(20, interval) *
                        (result === 'strong' ? ease : Math.max(1.2, ease * 0.7));
                    break;
            }
            break;
    }
    ease = Math.min(2.8, Math.max(1.3, ease));
    interval = Math.min(21600, Math.max(20, Math.round(interval)));
    let nextRandom = random;
    let fuzz = 1;
    if (interval >= 600) {
        const decision = drawRandom(nextRandom);
        nextRandom = decision.state;
        if (decision.value >= 0.05) {
            const amount = drawRandom(nextRandom);
            nextRandom = amount.state;
            fuzz = 0.95 + amount.value * 0.1;
        }
    }
    // answerMsはSessionの入力検証済み値。保存DTOには時刻を記録する。
    void answerMs;
    return {
        schedule: {
            ...previous, state, stepIndex, intervalSec: interval, ease, streak, lapses,
            dueAt: now + Math.round(interval * fuzz * 1000), version: previous.version + 1,
            lastAnsweredAt: { kind: 'some', value: now }
        },
        random: nextRandom
    };
}
