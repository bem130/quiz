import type { Revision, SessionId, UserId } from './identity.ts';
import type { Option } from './result.ts';

export type UserRecord = Readonly<{ id: UserId; name: string; createdAt: number }>;
/** 草稿は編集中の不正JSONを含め、そのまま保持する。versionは保存競合の検出に使う。 */
export type DraftRecord = Readonly<{ id: string; text: string; updatedAt: number; version: number }>;
export type PackageRecord = Readonly<{ id: string; source: string; json: string; revision: Revision; updatedAt: number }>;
/** idは参照元から解決した要求URL。textは原文であり、描画時に必ず安全性を再検証する。 */
export type AssetRecord = Readonly<{ id: string; text: string; updatedAt: number }>;
export type AnswerResult = 'strong' | 'weak' | 'wrong' | 'idk' | 'timeout';
export type SessionSummary = Readonly<{ answered: number; correct: number; idk: number; durationMs: number }>;
export type Completion =
    | Readonly<{ kind: 'questions'; count: number }>
    | Readonly<{ kind: 'time'; durationMs: number }>
    | Readonly<{ kind: 'drain' }>;
/** 再生に必要な初期入力のsnapshot。revisionは題庫のcanonical v3 JSONで自己完結する。 */
export type ReplayDescriptor = Readonly<{
    version: 1; seed: string; completion: Completion;
    allowedPatternIds: ReadonlyArray<string>; questionIds: ReadonlyArray<string>;
    packages: ReadonlyArray<Readonly<{ id: string; revision: Revision }>>;
    schedules: ReadonlyArray<ScheduleRecord>;
    confusions: ReadonlyArray<Readonly<{ conceptId: string; wrongConceptId: string; score: number }>>;
    conceptStats: ReadonlyArray<ConceptStatsRecord>;
}>;
export type SessionRecord = Readonly<{
    id: SessionId; userId: UserId; packageIds: ReadonlyArray<string>; mode: 'study' | 'test';
    startedAt: number; endedAt: Option<number>; summary: Option<SessionSummary>; replay: ReplayDescriptor;
}>;
export type AttemptRecord = Readonly<{
    id: string; sessionId: SessionId; userId: UserId; packageId: string; questionId: string;
    patternId: string; conceptId: string; chosenConceptId: Option<string>;
    result: AnswerResult; answerMs: number; answeredAt: number;
}>;
export type ScheduleRecord = Readonly<{
    id: string; userId: UserId; packageId: string; questionId: string; patternId: string;
    conceptId: string; state: 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING';
    dueAt: number; intervalSec: number; ease: number; stepIndex: number;
    streak: number; lapses: number; version: number; lastAnsweredAt: Option<number>;
}>;
export type ConfusionRecord = Readonly<{
    id: string; userId: UserId; packageId: string; conceptId: string; wrongConceptId: string;
    shown: number; chosen: number; idkNear: number;
}>;
export type ConceptStatsRecord = Readonly<{
    id: string; userId: UserId; packageId: string; conceptId: string;
    uncertainty: number; recentIdk: number;
}>;
export type SettingRecord = Readonly<{ id: string; value: string }>;
export type ConfusionDelta = Readonly<{
    conceptId: string; wrongConceptId: string; shown: number; chosen: number; idkNear: number;
}>;
/** EMAの係数はcoreで決め、保存層では現在値への算術更新だけを行う。 */
export type ConceptStatDelta = Readonly<{
    conceptId: string; uncertaintyMultiplier: number; uncertaintyAdd: number;
    recentIdkMultiplier: number; recentIdkAdd: number;
}>;
export type CommitAnswer = Readonly<{
    attempt: AttemptRecord;
    schedule: Option<Readonly<{ expectedVersion: number; next: ScheduleRecord }>>;
    confusion: ReadonlyArray<ConfusionDelta>;
    conceptStats: Option<ConceptStatDelta>;
}>;
export type CommitAnswerResult = Readonly<{ duplicate: boolean }>;
