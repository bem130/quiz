import { generateQuestion } from './quiz-engine.ts';
import type { ConfusionPair, Question, QuestionCandidate, QuestionOption } from './quiz-engine.ts';
import { drawRandom, seedRandom, shuffle } from './random.ts';
import type { RandomState } from './random.ts';
import type { AnswerResult, AttemptRecord, CommitAnswer, Completion, ConceptStatDelta, ConceptStatsRecord, ScheduleRecord, SessionRecord, SessionSummary } from './records.ts';
export type { Completion } from './records.ts';
import { err, none, ok, some } from './result.ts';
import type { Option, Result } from './result.ts';
import { initialSchedule, updateSchedule } from './study.ts';

export type SessionConfig = Readonly<{
    id: string; userId: string; mode: 'study' | 'test'; completion: Completion;
    candidates: readonly QuestionCandidate[]; allowedPatternIds: readonly string[];
    seed: string; now: number; schedules: readonly ScheduleRecord[];
    confusions: readonly ConfusionPair[];
    conceptStats: readonly ConceptStatsRecord[];
}>;
export type SessionError = Readonly<{
    kind: 'invalid-config' | 'invalid-phase' | 'invalid-selection' | 'stale-operation' | 'invalid-clock';
}>;
export type QuestionStage = 'test' | 'new' | 'learning' | 'relearning' | 'review' | 'repair' | 'retry';
export type FinishReason = 'target' | 'time' | 'drained' | 'exhausted' | 'interrupted';
export type SessionPhase =
    | Readonly<{ kind: 'ready' }>
    | Readonly<{ kind: 'question'; question: Question; startedAt: number; stage: QuestionStage }>
    | Readonly<{ kind: 'saving'; question: Question; startedAt: number; stage: QuestionStage; commit: CommitAnswer; input: AnswerInput }>
    | Readonly<{ kind: 'answered'; question: Question; attempt: AttemptRecord; stage: QuestionStage }>
    | Readonly<{ kind: 'waiting'; dueAt: number }>
    | Readonly<{ kind: 'finished'; reason: FinishReason; summary: SessionSummary }>;
export type SessionState = Readonly<{
    config: SessionConfig; record: SessionRecord; random: RandomState; phase: SessionPhase;
    /** 最後に受理した遷移の時刻。回答・待機・中断を通じて逆行させない。 */
    clockAt: number;
    history: readonly Readonly<{ question: Question; attempt: AttemptRecord; stage: QuestionStage; selection: Selection }>[];
    /** historyの回答射影。confirmAnswerの一箇所だけでhistoryから再計算する。 */
    attempts: readonly AttemptRecord[]; schedules: readonly ScheduleRecord[];
    seenQuestionIds: readonly string[]; recentConceptIds: readonly string[];
    retries: readonly Readonly<{ questionId: string; availableAfter: number }>[];
    repairCounts: Readonly<Record<string, number>>;
    served: Readonly<{ review: number; repair: number; fresh: number }>;
}>;
export type Selection =
    | Readonly<{ kind: 'option'; optionId: string }>
    | Readonly<{ kind: 'idk'; nearestOptionId: Option<string> }>
    | Readonly<{ kind: 'timeout' }>;
export type AnswerInput = Readonly<{ operationId: string; selection: Selection; now: number }>;

function error(kind: SessionError['kind']): Result<never, SessionError> { return err({ kind }); }
function validTime(now: number, startedAt: number): boolean { return Number.isFinite(now) && now >= startedAt; }
function clockBase(state: SessionState): number { return state.clockAt; }

/** 選択範囲を固定し、古い保存済みquestion snapshotから出題しない。 */
export function createSession(config: SessionConfig): Result<SessionState, SessionError> {
    if (config.id.trim().length === 0 || config.userId.trim().length === 0 || !Number.isFinite(config.now)) {
        return error('invalid-config');
    }
    if ((config.completion.kind === 'questions' && (!Number.isInteger(config.completion.count) || config.completion.count < 1)) ||
        (config.completion.kind === 'time' && (!Number.isFinite(config.completion.durationMs) || config.completion.durationMs <= 0)) ||
        (config.mode === 'test' && config.completion.kind === 'drain')) return error('invalid-config');
    const allowed = new Set(config.allowedPatternIds);
    const candidates = config.candidates.filter((candidate) => allowed.has(candidate.patternId));
    if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) return error('invalid-config');
    const packages = [...new Map(candidates.map((candidate) => [candidate.packageId,
        { id: candidate.packageId, revision: candidate.revision }])).values()];
    const packageIds = new Set<string>(packages.map((entry) => entry.id));
    const candidateConcepts = new Set<string>(candidates.map((candidate) => candidate.conceptId));
    const candidateIds = new Set<string>(candidates.map((candidate) => candidate.id));
    const filteredSchedules = config.schedules.filter((entry) => entry.userId === config.userId && candidateIds.has(entry.questionId));
    const filteredConfusions = config.confusions.filter((pair) => candidateConcepts.has(pair.conceptId));
    const filteredStats = config.conceptStats.filter((entry) => entry.userId === config.userId &&
        packageIds.has(entry.packageId) && candidateConcepts.has(entry.conceptId));
    const allowedPatternIds = [...new Set(candidates.map((candidate) => candidate.patternId))];
    return ok({
        config: { ...config, candidates, allowedPatternIds, schedules: filteredSchedules,
            confusions: filteredConfusions, conceptStats: filteredStats },
        record: { id: config.id, userId: config.userId, mode: config.mode,
            packageIds: [...packageIds],
            replay: { version: 1, seed: config.seed, completion: config.completion, allowedPatternIds,
                questionIds: candidates.map((candidate) => candidate.id),
                packages, schedules: filteredSchedules, confusions: filteredConfusions, conceptStats: filteredStats },
            startedAt: config.now, endedAt: none, summary: none },
        random: seedRandom(config.seed), phase: { kind: 'ready' }, clockAt: config.now, history: [], attempts: [],
        schedules: filteredSchedules,
        seenQuestionIds: [], recentConceptIds: [], retries: [], repairCounts: {},
        served: { review: 0, repair: 0, fresh: 0 }
    });
}

export function sessionSummary(state: SessionState, now: number): SessionSummary {
    return { answered: state.attempts.length,
        correct: state.attempts.filter((attempt) => attempt.result === 'strong' || attempt.result === 'weak').length,
        idk: state.attempts.filter((attempt) => attempt.result === 'idk').length,
        durationMs: Math.max(0, now - state.record.startedAt) };
}
function finish(state: SessionState, now: number, reason: FinishReason): SessionState {
    const summary = sessionSummary(state, now);
    return { ...state, clockAt: now, record: { ...state.record, endedAt: some(now), summary: some(summary) },
        phase: { kind: 'finished', reason, summary } };
}
function existingSchedule(state: SessionState, candidate: Readonly<{ id: string }>): Option<ScheduleRecord> {
    const entry = state.schedules.find((record) => record.questionId === candidate.id);
    return entry === undefined ? none : some(entry);
}
function dueStage(entry: ScheduleRecord): QuestionStage {
    switch (entry.state) {
        case 'NEW': return 'new';
        case 'LEARNING': return 'learning';
        case 'RELEARNING': return 'relearning';
        case 'REVIEW': return 'review';
    }
}

/** 候補枯渇・復習待ち・正常完了をphaseで区別する。保存待ち中は進行しない。 */
export function nextQuestion(state: SessionState, now: number): Result<SessionState, SessionError> {
    if (!validTime(now, clockBase(state))) return error('invalid-clock');
    if (state.phase.kind === 'finished') return ok(state);
    if (state.phase.kind === 'question' || state.phase.kind === 'saving') return error('invalid-phase');
    const completion = state.config.completion;
    if (completion.kind === 'questions' && state.attempts.length >= completion.count) return ok(finish(state, now, 'target'));
    if (completion.kind === 'time' && now >= state.record.startedAt + completion.durationMs) return ok(finish(state, now, 'time'));
    const schedulesByQuestion = new Map<string, ScheduleRecord>();
    for (const entry of state.schedules) {
        const id = entry.questionId;
        if (!schedulesByQuestion.has(id)) schedulesByQuestion.set(id, entry);
    }
    const scheduleFor = (candidate: Readonly<{ id: string }>): Option<ScheduleRecord> => {
        const entry = schedulesByQuestion.get(candidate.id);
        return entry === undefined ? none : some(entry);
    };
    const seen = new Set(state.seenQuestionIds);
    const candidateIds = new Set<string>(state.config.candidates.map((candidate) => candidate.id));
    const unseenConcepts = new Set<string>(state.config.candidates.filter((candidate) => !seen.has(candidate.id)).map((candidate) => candidate.conceptId));
    let candidates: readonly QuestionCandidate[] = [];
    let stage: QuestionStage = state.config.mode === 'test' ? 'test' : 'new';
    let repairPair: Option<ConfusionPair> = none;
    if (state.config.mode === 'test') {
        candidates = state.config.candidates.filter((candidate) => !seen.has(candidate.id));
    } else {
        const due = state.config.candidates.filter((candidate) => {
            const entry = scheduleFor(candidate);
            return entry.kind === 'some' && entry.value.state !== 'NEW' && entry.value.dueAt <= now;
        });
        const urgent = due.filter((candidate) => {
            const entry = scheduleFor(candidate);
            return entry.kind === 'some' && (entry.value.state === 'LEARNING' || entry.value.state === 'RELEARNING');
        });
        const retry = state.retries.find((item) => item.availableAfter <= state.attempts.length &&
            candidateIds.has(item.questionId));
        if (retry !== undefined && completion.kind !== 'drain') {
            candidates = state.config.candidates.filter((candidate) => candidate.id === retry.questionId);
            stage = 'retry';
        } else if (urgent.length > 0) {
            candidates = urgent;
        } else {
            const fresh = state.config.candidates.filter((candidate) => {
                const entry = scheduleFor(candidate);
                return !seen.has(candidate.id) &&
                    (entry.kind === 'none' || entry.value.state === 'NEW');
            });
            const pair = state.config.confusions.filter((item) => item.score >= 0.6 &&
                (state.repairCounts[JSON.stringify([item.conceptId, item.wrongConceptId])] ?? 0) < 2)
                .find((item) => unseenConcepts.has(item.conceptId) || unseenConcepts.has(item.wrongConceptId));
            const uncertain = new Set(state.config.conceptStats.filter((item) => item.userId === state.record.userId &&
                item.uncertainty >= 0.6).map((item) => item.conceptId));
            const repair = state.config.candidates.filter((candidate) =>
                !seen.has(candidate.id) &&
                (uncertain.has(candidate.conceptId) || (pair !== undefined &&
                    (candidate.conceptId === pair.conceptId || candidate.conceptId === pair.wrongConceptId))));
            const choices = [
                { stage: 'review', pool: due, ratio: state.served.review / 6 },
                { stage: 'repair', pool: completion.kind === 'drain' ? [] : repair, ratio: state.served.repair / 3 },
                { stage: 'new', pool: completion.kind === 'drain' || due.length >= 80 ? [] : fresh, ratio: state.served.fresh }
            ].filter((choice) => choice.pool.length > 0).sort((left, right) => left.ratio - right.ratio);
            const choice = choices.at(0);
            if (choice !== undefined) {
                candidates = choice.pool;
                if (choice.stage === 'repair') {
                    stage = 'repair';
                    if (pair !== undefined) repairPair = some(pair);
                }
            }
        }
    }
    if (candidates.length === 0) {
        if (state.config.mode === 'test') return ok(finish(state, now, 'exhausted'));
        if (completion.kind === 'drain') return ok(finish(state, now, 'drained'));
        const future = state.schedules.filter((entry) => entry.dueAt > now && entry.state !== 'NEW')
            .sort((left, right) => left.dueAt - right.dueAt).at(0);
        return future === undefined ? ok(finish(state, now, 'exhausted')) :
            ok({ ...state, clockAt: now, phase: { kind: 'waiting', dueAt: future.dueAt } });
    }
    const ordered = shuffle(candidates, state.random);
    const candidate = ordered.items.at(0);
    if (candidate === undefined) return ok(finish(state, now, 'exhausted'));
    if (stage !== 'test' && stage !== 'repair' && stage !== 'retry') {
        const schedule = scheduleFor(candidate);
        stage = schedule.kind === 'some' ? dueStage(schedule.value) : 'new';
    }
    const repairKey = repairPair.kind === 'some' &&
        (candidate.conceptId === repairPair.value.conceptId || candidate.conceptId === repairPair.value.wrongConceptId)
        ? some(JSON.stringify([repairPair.value.conceptId, repairPair.value.wrongConceptId])) : none;
    const generated = generateQuestion(candidate, ordered.state, {
        confusions: state.config.mode === 'study' ? state.config.confusions : [],
        recentConceptIds: state.recentConceptIds
    });
    if (generated.kind === 'none') return error('invalid-config');
    const served = { ...state.served };
    if (stage === 'new') served.fresh += 1;
    else if (stage === 'repair') served.repair += 1;
    else if (stage !== 'test') served.review += 1;
    return ok({ ...state, clockAt: now, random: generated.value.random,
        phase: { kind: 'question', question: generated.value.question, startedAt: now, stage },
        seenQuestionIds: [...new Set([...state.seenQuestionIds, candidate.id])],
        recentConceptIds: [...state.history.slice(-2).flatMap((entry) => entry.question.options.map((option) => option.conceptId)),
            ...generated.value.question.options.map((option) => option.conceptId)].slice(-24),
        retries: state.retries.filter((item) => item.questionId !== candidate.id),
        repairCounts: repairKey.kind === 'none' ? state.repairCounts : {
            ...state.repairCounts, [repairKey.value]: (state.repairCounts[repairKey.value] ?? 0) + 1
        }, served });
}

function medianDuration(attempts: readonly AttemptRecord[]): number {
    const sorted = attempts.map((attempt) => attempt.answerMs).filter((duration) => duration > 0).sort((left, right) => left - right);
    const middle = sorted.at(Math.floor(sorted.length / 2));
    if (middle === undefined) return 8000 / 1.5;
    const lower = sorted.at(Math.floor(sorted.length / 2) - 1);
    return sorted.length % 2 === 0 && lower !== undefined ? (lower + middle) / 2 : middle;
}
function statDelta(question: Question, result: AnswerResult): ConceptStatDelta {
    const idk = result === 'idk';
    const wrong = result === 'wrong' || result === 'timeout';
    return { conceptId: question.conceptId,
        uncertaintyMultiplier: idk ? 0.9 : wrong ? 0.92 : 0.85,
        uncertaintyAdd: idk ? 0.1 : wrong ? 0.08 : 0,
        recentIdkMultiplier: idk || wrong ? 0.8 : 0.7,
        recentIdkAdd: idk ? 1 : 0 };
}

/** 固定したquestionと操作IDから原子的保存用DTOを作る。保存失敗時は同じDTOを再送する。 */
export function answerSession(state: SessionState, input: AnswerInput): Result<SessionState, SessionError> {
    if (state.phase.kind === 'saving') {
        return JSON.stringify(input) === JSON.stringify(state.phase.input) ? ok(state) : error('invalid-phase');
    }
    if (state.phase.kind !== 'question') return error('invalid-phase');
    if (!validTime(input.now, Math.max(clockBase(state), state.phase.startedAt))) return error('invalid-clock');
    if (input.operationId.trim().length === 0 || state.attempts.some((attempt) => attempt.id === input.operationId)) return error('stale-operation');
    const question = state.phase.question;
    const selection: Selection = state.config.completion.kind === 'time' &&
        input.now >= state.record.startedAt + state.config.completion.durationMs ? { kind: 'timeout' } : input.selection;
    let selected: Option<QuestionOption> = none;
    let nearest: Option<QuestionOption> = none;
    if (selection.kind === 'option') {
        const id = selection.optionId;
        const option = question.options.find((entry) => entry.id === id);
        if (option === undefined) return error('invalid-selection');
        selected = some(option);
    } else if (selection.kind === 'idk' && selection.nearestOptionId.kind === 'some') {
        const id = selection.nearestOptionId.value;
        const option = question.options.find((entry) => entry.id === id);
        if (option === undefined) return error('invalid-selection');
        nearest = some(option);
    }
    const answerMs = input.now - state.phase.startedAt;
    let result: AnswerResult;
    switch (selection.kind) {
        case 'idk': result = 'idk'; break;
        case 'timeout': result = 'timeout'; break;
        case 'option': {
            const risk = state.config.confusions.some((pair) => pair.conceptId === question.conceptId && pair.score >= 0.6 &&
                question.options.some((option) => option.conceptId === pair.wrongConceptId));
            const uncertain = state.config.conceptStats.some((item) => item.userId === state.record.userId &&
                item.conceptId === question.conceptId && item.uncertainty >= 0.6);
            result = selected.kind === 'some' && selected.value.isCorrect ?
                (answerMs > medianDuration(state.attempts) * 1.5 || risk || uncertain ? 'weak' : 'strong') : 'wrong';
            break;
        }
    }
    const attempt: AttemptRecord = {
        id: input.operationId, sessionId: state.record.id, userId: state.record.userId,
        packageId: question.packageId, questionId: question.id, patternId: question.patternId,
        conceptId: question.conceptId, chosenConceptId: selected.kind === 'some' ? some(selected.value.conceptId) : none,
        result, answerMs, answeredAt: input.now
    };
    let random = state.random;
    let schedule: CommitAnswer['schedule'] = none;
    let retries = state.retries;
    if (state.config.mode === 'study') {
        const existing = existingSchedule(state, question);
        const previous = existing.kind === 'some' ? existing.value : initialSchedule({
            userId: state.record.userId, packageId: question.packageId, questionId: question.id,
            patternId: question.patternId, conceptId: question.conceptId
        }, input.now);
        const updated = updateSchedule(previous, result, answerMs, input.now, random);
        schedule = some({ expectedVersion: previous.version, next: updated.schedule });
        random = updated.random;
        if (result === 'wrong' || result === 'idk' || result === 'timeout') {
            const drawn = drawRandom(random);
            random = drawn.state;
            retries = [...retries.filter((item) => item.questionId !== question.id), {
                questionId: question.id, availableAfter: state.attempts.length + 1 + 3 + Math.floor(drawn.value * 5)
            }];
        }
    }
    const commit: CommitAnswer = {
        attempt, schedule,
        confusion: state.config.mode === 'test' ? [] : [...new Set(question.options.map((option) => option.conceptId))]
            .filter((id) => id !== question.conceptId)
            .map((id) => ({ conceptId: question.conceptId, wrongConceptId: id, shown: 1,
                chosen: selected.kind === 'some' && selected.value.conceptId === id ? 1 : 0,
                idkNear: nearest.kind === 'some' && nearest.value.conceptId === id ? 1 : 0 })),
        conceptStats: state.config.mode === 'test' ? none : some(statDelta(question, result))
    };
    return ok({ ...state, clockAt: input.now, random, retries,
        phase: { kind: 'saving', question, startedAt: state.phase.startedAt, stage: state.phase.stage, commit, input } });
}

/** 保存層がcommit完了または同一操作のduplicate成功を確認してから呼び出す。 */
export function confirmAnswer(state: SessionState, operationId: string): Result<SessionState, SessionError> {
    if (state.phase.kind !== 'saving') return error('invalid-phase');
    const commit = state.phase.commit;
    if (commit.attempt.id !== operationId) return error('stale-operation');
    const schedule = commit.schedule;
    const selection: Selection = commit.attempt.result === 'timeout' ? { kind: 'timeout' } : state.phase.input.selection;
    const history = [...state.history, { question: state.phase.question, attempt: commit.attempt, stage: state.phase.stage, selection }];
    return ok({ ...state, phase: { kind: 'answered', question: state.phase.question, attempt: commit.attempt, stage: state.phase.stage },
        history, attempts: history.map((entry) => entry.attempt),
        schedules: schedule.kind === 'none' ? state.schedules : [
            ...state.schedules.filter((entry) => entry.id !== schedule.value.next.id), schedule.value.next
        ] });
}

/** 中断は未保存回答を追い越さない。保存完了後に同じ固定状態から終了する。 */
export function finishSession(state: SessionState, now: number): Result<SessionState, SessionError> {
    if (!validTime(now, clockBase(state))) return error('invalid-clock');
    if (state.phase.kind === 'saving') return error('invalid-phase');
    if (state.phase.kind === 'finished') return ok(state);
    return ok(finish(state, now, 'interrupted'));
}

/** 新しいsessionを作るための題目集合。旧sessionを回答記録先として再利用しない。 */
export function retryCandidates(state: SessionState): readonly QuestionCandidate[] {
    const wrong = new Set(state.attempts.filter((attempt) => attempt.result === 'wrong' || attempt.result === 'idk' ||
        attempt.result === 'timeout').map((attempt) => attempt.questionId));
    return state.config.candidates.filter((candidate) => wrong.has(candidate.id));
}
