import type {
    AssetRecord, AttemptRecord, ConceptStatsRecord, ConfusionRecord, DraftRecord, PackageRecord,
    ScheduleRecord, SessionRecord, SettingRecord, UserRecord
} from '../../core/records.ts';
export type {
    AnswerResult, AssetRecord, AttemptRecord, CommitAnswer, CommitAnswerResult, Completion, ConceptStatDelta,
    ConceptStatsRecord, ConfusionDelta, ConfusionRecord, DraftRecord, PackageRecord,
    ReplayDescriptor, ScheduleRecord, SessionRecord, SessionSummary, SettingRecord, UserRecord
} from '../../core/records.ts';

/** 保存失敗は例外や表示文ではなく、UIが分岐できる値として返す。 */
export type StorageError = Readonly<{
    kind: 'unavailable' | 'blocked' | 'closed' | 'request' | 'aborted' | 'invalid' | 'conflict' | 'missing';
    message: string;
}>;

export type DatabaseRecords = Readonly<{
    users: ReadonlyArray<UserRecord>; drafts: ReadonlyArray<DraftRecord>;
    packages: ReadonlyArray<PackageRecord>; attempts: ReadonlyArray<AttemptRecord>;
    sessions: ReadonlyArray<SessionRecord>; schedule: ReadonlyArray<ScheduleRecord>;
    confusion: ReadonlyArray<ConfusionRecord>; conceptStats: ReadonlyArray<ConceptStatsRecord>;
    settings: ReadonlyArray<SettingRecord>; assets: ReadonlyArray<AssetRecord>;
}>;
export type StoreName = keyof DatabaseRecords;
export type BackupSnapshot = Readonly<{
    format: 'bem130-quiz-backup'; version: 2; records: DatabaseRecords;
}>;

export const STORE_NAMES: ReadonlyArray<StoreName> = [
    'users', 'drafts', 'packages', 'attempts', 'sessions', 'schedule', 'confusion', 'conceptStats', 'settings', 'assets'
];

/** 区切り文字を含む値でも衝突しない保存用キー。 */
export function storageKey(...parts: ReadonlyArray<string>): string {
    return JSON.stringify(parts);
}
