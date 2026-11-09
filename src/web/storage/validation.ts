import { isRevision, parseQuizJson, serializeQuiz } from '../../core/schema.ts';
import { isSessionId, isUserId, parsePackageId, parseRecordKey, recordKey } from '../../core/identity.ts';
import { prepareQuiz } from '../../core/quiz-engine.ts';
import type { Option, Result } from '../../core/result.ts';
import type {
    AssetRecord, AttemptRecord, BackupSnapshot, ConceptStatsRecord, ConfusionRecord, DatabaseRecords, DraftRecord,
    PackageRecord, ReplayDescriptor, ScheduleRecord, SessionRecord, SessionSummary, SettingRecord, StorageError,
    StoreName, UserRecord
} from './types.ts';
import { STORE_NAMES } from './types.ts';

export type StoreRecord<K extends StoreName> = DatabaseRecords[K][number];

export function failure(kind: StorageError['kind'], message: string): Result<never, StorageError> {
    return { ok: false, error: { kind, message } };
}

export function success<T>(value: T): Result<T, StorageError> {
    return { ok: true, value };
}

export function objectValue(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
    return typeof value === 'string';
}

function id(value: unknown): value is string {
    return text(value) && value.length > 0;
}

function nonnegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function count(value: unknown): value is number {
    return nonnegative(value) && Number.isSafeInteger(value);
}

function option<T>(value: unknown, guard: (value: unknown) => value is T): value is Option<T> {
    return objectValue(value) && (value['kind'] === 'none' || (value['kind'] === 'some' && guard(value['value'])));
}

function strings(value: unknown): value is ReadonlyArray<string> {
    return Array.isArray(value) && value.every(id);
}

function user(value: unknown): value is UserRecord {
    return objectValue(value) && isUserId(value['id']) && id(value['name']) && nonnegative(value['createdAt']);
}

function draft(value: unknown): value is DraftRecord {
    return objectValue(value) && id(value['id']) && text(value['text']) && nonnegative(value['updatedAt']) && count(value['version']) && value['version'] > 0;
}

function packageRecord(value: unknown): value is PackageRecord {
    if (!objectValue(value) || !id(value['id']) || !id(value['source']) || !text(value['json']) ||
        !isRevision(value['revision']) || !nonnegative(value['updatedAt']) || !parsePackageId(value['id']).ok) return false;
    const parsed = parseQuizJson(value['json']);
    const source = parseRecordKey(value['id']);
    return parsed.ok && serializeQuiz(parsed.value) === value['revision'] && source.ok && source.value[1] === value['source'];
}

export function scoped(value: string, packageId: string, kind: string, size: number): boolean {
    const parsed = parseRecordKey(value);
    return parsed.ok && parsed.value.length === size && parsed.value[0] === kind && parsed.value[1] === packageId;
}

export function questionReferences(value: AttemptRecord | ScheduleRecord): boolean {
    const question = parseRecordKey(value.questionId);
    const pattern = parseRecordKey(value.patternId);
    return scoped(value.questionId, value.packageId, 'question', 4) &&
        scoped(value.patternId, value.packageId, 'pattern', 3) && scoped(value.conceptId, value.packageId, 'concept', 3) &&
        question.ok && pattern.ok && question.value[2] === pattern.value[2];
}

function summary(value: unknown): value is SessionSummary {
    return objectValue(value) && count(value['answered']) && count(value['correct']) && count(value['idk']) &&
        nonnegative(value['durationMs']) && value['correct'] + value['idk'] <= value['answered'];
}

function replayPackage(value: unknown): value is ReplayDescriptor['packages'][number] {
    return objectValue(value) && id(value['id']) && isRevision(value['revision']) && parsePackageId(value['id']).ok;
}

function arrayOf<T>(value: unknown, guard: (value: unknown) => value is T): value is ReadonlyArray<T> {
    return Array.isArray(value) && value.every((entry: unknown) => guard(entry));
}

function replayConfusion(value: unknown): value is ReplayDescriptor['confusions'][number] {
    return objectValue(value) && id(value['conceptId']) && id(value['wrongConceptId']) && nonnegative(value['score']) && value['score'] <= 1;
}

function replay(value: unknown, candidateCache: Map<string, ReadonlySet<string>>): value is ReplayDescriptor {
    if (!objectValue(value) || value['version'] !== 1 || !text(value['seed']) || !strings(value['allowedPatternIds']) || !strings(value['questionIds']) ||
        !arrayOf(value['packages'], replayPackage) || !arrayOf(value['schedules'], schedule) ||
        !arrayOf(value['confusions'], replayConfusion) || !arrayOf(value['conceptStats'], conceptStats) || !objectValue(value['completion'])) return false;
    const completion = value['completion'];
    if (!(completion['kind'] === 'drain' || (completion['kind'] === 'questions' && count(completion['count']) && completion['count'] > 0) ||
        (completion['kind'] === 'time' && nonnegative(completion['durationMs']) && completion['durationMs'] > 0))) return false;
    const packageIds = new Set(value['packages'].map((entry) => entry.id));
    if (packageIds.size === 0 || packageIds.size !== value['packages'].length || new Set(value['allowedPatternIds']).size !== value['allowedPatternIds'].length) return false;
    const matchesScope = (key: string, kind: string, size: number): boolean => {
        const parsed = parseRecordKey(key);
        const packageId = parsed.ok ? parsed.value.at(1) : undefined;
        return typeof packageId === 'string' && packageIds.has(packageId) && scoped(key, packageId, kind, size);
    };
    if (value['allowedPatternIds'].length === 0 || !value['allowedPatternIds'].every((key) => matchesScope(key, 'pattern', 3))) return false;
    const knownPatterns = new Set<string>();
    const knownRows = new Map<string, ReadonlySet<string>>();
    const knownConcepts = new Set<string>();
    const availableCandidates = new Set<string>();
    for (const entry of value['packages']) {
        const quiz = parseQuizJson(entry.revision);
        const packageId = parsePackageId(entry.id);
        if (!quiz.ok || !packageId.ok) return false;
        const cacheKey = recordKey([entry.id, entry.revision]);
        let candidates = candidateCache.get(cacheKey);
        if (candidates === undefined) {
            candidates = new Set(prepareQuiz(quiz.value, packageId.value, entry.revision).candidates.map((candidate) => String(candidate.id)));
            candidateCache.set(cacheKey, candidates);
        }
        for (const key of candidates) availableCandidates.add(key);
        for (const pattern of quiz.value.patterns) knownPatterns.add(recordKey(['pattern', entry.id, pattern.id]));
        knownRows.set(entry.id, new Set(quiz.value.table.map((row) => row.id)));
        for (const row of quiz.value.table) knownConcepts.add(recordKey(['concept', entry.id, row.conceptId.kind === 'some' ? row.conceptId.value : row.id]));
    }
    if (!value['allowedPatternIds'].every((key) => knownPatterns.has(key))) return false;
    const candidateIds = new Set(value['questionIds']);
    if (candidateIds.size === 0 || candidateIds.size !== value['questionIds'].length) return false;
    for (const key of candidateIds) {
        if (!availableCandidates.has(key)) return false;
        const tuple = parseRecordKey(key);
        if (!tuple.ok) return false;
        const [kind, packageId, patternId, rowId] = tuple.value;
        if (kind !== 'question' || tuple.value.length !== 4 || typeof packageId !== 'string' || typeof patternId !== 'string' || typeof rowId !== 'string' ||
            !value['allowedPatternIds'].includes(recordKey(['pattern', packageId, patternId])) || !knownRows.get(packageId)?.has(rowId)) return false;
    }
    if (new Set(value['schedules'].map((entry) => entry.id)).size !== value['schedules'].length ||
        new Set(value['conceptStats'].map((entry) => entry.id)).size !== value['conceptStats'].length ||
        new Set(value['confusions'].map((entry) => recordKey([entry.conceptId, entry.wrongConceptId]))).size !== value['confusions'].length) return false;
    if (!value['schedules'].every((entry) => candidateIds.has(entry.questionId) && packageIds.has(entry.packageId) && questionReferences(entry) && entry.id === recordKey([entry.userId, entry.questionId]))) return false;
    if (!value['confusions'].every((entry) => knownConcepts.has(entry.conceptId) && knownConcepts.has(entry.wrongConceptId))) return false;
    return value['conceptStats'].every((entry) => packageIds.has(entry.packageId) && knownConcepts.has(entry.conceptId) && scoped(entry.conceptId, entry.packageId, 'concept', 3) &&
        entry.id === recordKey([entry.userId, entry.packageId, entry.conceptId]));
}

function session(value: unknown, candidateCache: Map<string, ReadonlySet<string>>): value is SessionRecord {
    if (!objectValue(value)) return false;
    const replayValue = value['replay'];
    if (!replay(replayValue, candidateCache)) return false;
    return isSessionId(value['id']) && isUserId(value['userId']) && strings(value['packageIds']) &&
        value['packageIds'].length > 0 && new Set(value['packageIds']).size === value['packageIds'].length &&
        (value['mode'] === 'study' || value['mode'] === 'test') && nonnegative(value['startedAt']) &&
        option(value['endedAt'], nonnegative) && option(value['summary'], summary) &&
        value['endedAt'].kind === value['summary'].kind &&
        !(value['mode'] === 'test' && replayValue.completion.kind === 'drain') &&
        value['packageIds'].every((key) => replayValue.packages.some((entry) => entry.id === key)) &&
        replayValue.schedules.every((entry) => entry.userId === value['userId']) &&
        replayValue.conceptStats.every((entry) => entry.userId === value['userId']);
}

function attempt(value: unknown): value is AttemptRecord {
    return objectValue(value) && isSessionId(value['sessionId']) && isUserId(value['userId']) && ['id', 'sessionId', 'userId', 'packageId', 'questionId', 'patternId', 'conceptId'].every((key) => id(value[key])) &&
        option(value['chosenConceptId'], id) &&
        ['strong', 'weak', 'wrong', 'idk', 'timeout'].some((result) => result === value['result']) &&
        nonnegative(value['answerMs']) && nonnegative(value['answeredAt']);
}

function schedule(value: unknown): value is ScheduleRecord {
    return objectValue(value) && isUserId(value['userId']) && ['id', 'userId', 'packageId', 'questionId', 'patternId', 'conceptId'].every((key) => id(value[key])) &&
        ['NEW', 'LEARNING', 'REVIEW', 'RELEARNING'].some((state) => state === value['state']) &&
        nonnegative(value['dueAt']) && nonnegative(value['intervalSec']) && nonnegative(value['ease']) && value['ease'] > 0 &&
        ['stepIndex', 'streak', 'lapses', 'version'].every((key) => count(value[key])) &&
        option(value['lastAnsweredAt'], nonnegative);
}

function confusion(value: unknown): value is ConfusionRecord {
    return objectValue(value) && isUserId(value['userId']) && ['id', 'userId', 'packageId', 'conceptId', 'wrongConceptId'].every((key) => id(value[key])) &&
        count(value['shown']) && count(value['chosen']) && count(value['idkNear']) &&
        value['chosen'] + value['idkNear'] <= value['shown'];
}

function conceptStats(value: unknown): value is ConceptStatsRecord {
    return objectValue(value) && isUserId(value['userId']) && ['id', 'userId', 'packageId', 'conceptId'].every((key) => id(value[key])) &&
        nonnegative(value['uncertainty']) && value['uncertainty'] <= 1 && nonnegative(value['recentIdk']);
}

function setting(value: unknown): value is SettingRecord {
    return objectValue(value) && id(value['id']) && text(value['value']);
}

function asset(value: unknown): value is AssetRecord {
    if (!objectValue(value) || !id(value['id']) || !id(value['text']) || !nonnegative(value['updatedAt'])) return false;
    if (new TextEncoder().encode(value['text']).byteLength > 2_000_000) return false;
    try {
        const url = new URL(value['id']);
        return (url.protocol === 'http:' || url.protocol === 'https:') && url.href === value['id'] &&
            url.hash === '' && url.username === '' && url.password === '';
    } catch { return false; }
}

/** IDBとバックアップの両境界で同じ検証を使う。 */
export function isStoreRecord<K extends StoreName>(name: K, value: unknown, candidateCache = new Map<string, ReadonlySet<string>>()): value is StoreRecord<K> {
    switch (name) {
        case 'users': return user(value);
        case 'drafts': return draft(value);
        case 'packages': return packageRecord(value);
        case 'sessions': return session(value, candidateCache);
        case 'attempts': return attempt(value);
        case 'schedule': return schedule(value);
        case 'confusion': return confusion(value);
        case 'conceptStats': return conceptStats(value);
        case 'settings': return setting(value);
        case 'assets': return asset(value);
    }
    return false;
}

function records(value: unknown): value is DatabaseRecords {
    if (!objectValue(value)) return false;
    // 一つのbackup内で同じ題庫revisionを持つsessionは出題候補の準備を共有する。
    const candidateCache = new Map<string, ReadonlySet<string>>();
    for (const name of STORE_NAMES) {
        const entries: unknown = value[name];
        if (!Array.isArray(entries)) return false;
        const ids = new Set<string>();
        for (const entry of entries) {
            if (!isStoreRecord(name, entry, candidateCache) || ids.has(entry.id)) return false;
            ids.add(entry.id);
        }
    }
    return true;
}

/** すべての参照を検証してから置換transactionを開始する。 */
export function validateBackup(value: unknown): Result<BackupSnapshot, StorageError> {
    if (!objectValue(value) || value['format'] !== 'bem130-quiz-backup' || value['version'] !== 2 || !records(value['records'])) {
        return failure('invalid', 'バックアップの形式または保存データが不正である。');
    }
    const data = value['records'];
    const userIds = new Set(data.users.map((entry) => entry.id));
    const packageIds = new Set(data.packages.map((entry) => entry.id));
    const sessions = new Map(data.sessions.map((entry) => [entry.id, entry]));
    if (data.sessions.some((entry) => !userIds.has(entry.userId) || entry.packageIds.some((key) => !packageIds.has(key)))) {
        return failure('invalid', 'セッションの参照先が存在しない。');
    }
    for (const entry of data.sessions) {
        if (entry.endedAt.kind === 'some') {
            const attempts = data.attempts.filter((attempt) => attempt.sessionId === entry.id);
            if (entry.summary.kind !== 'some' || entry.endedAt.value < entry.startedAt ||
                entry.summary.value.answered !== attempts.length ||
                entry.summary.value.correct !== attempts.filter((attempt) => attempt.result === 'strong' || attempt.result === 'weak').length ||
                entry.summary.value.idk !== attempts.filter((attempt) => attempt.result === 'idk').length ||
                entry.summary.value.durationMs !== entry.endedAt.value - entry.startedAt) return failure('invalid', 'セッションの集計または時刻が回答と一致しない。');
        }
    }
    for (const entry of data.attempts) {
        const parent = sessions.get(entry.sessionId);
        if (!parent || parent.userId !== entry.userId || !parent.packageIds.includes(entry.packageId) || entry.answeredAt < parent.startedAt ||
            !parent.replay.questionIds.includes(entry.questionId) ||
            (parent.endedAt.kind === 'some' && entry.answeredAt > parent.endedAt.value) ||
            !questionReferences(entry) || (entry.chosenConceptId.kind === 'some' && !scoped(entry.chosenConceptId.value, entry.packageId, 'concept', 3))) {
            return failure('invalid', '回答のセッション参照が不正である。');
        }
    }
    for (const entry of [...data.schedule, ...data.confusion, ...data.conceptStats]) {
        if (!userIds.has(entry.userId) || !packageIds.has(entry.packageId)) {
            return failure('invalid', '学習記録の参照先が存在しない。');
        }
    }
    for (const entry of data.schedule) {
        if (!questionReferences(entry) || entry.id !== recordKey([entry.userId, entry.questionId])) return failure('invalid', '調度の識別子が不正である。');
    }
    for (const entry of data.confusion) {
        if (!scoped(entry.conceptId, entry.packageId, 'concept', 3) || !scoped(entry.wrongConceptId, entry.packageId, 'concept', 3) ||
            entry.id !== recordKey([entry.userId, entry.packageId, entry.conceptId, entry.wrongConceptId])) return failure('invalid', '混同記録の識別子が不正である。');
    }
    for (const entry of data.conceptStats) {
        if (!scoped(entry.conceptId, entry.packageId, 'concept', 3) || entry.id !== recordKey([entry.userId, entry.packageId, entry.conceptId])) {
            return failure('invalid', '概念統計の識別子が不正である。');
        }
    }
    return success({ format: 'bem130-quiz-backup', version: 2, records: data });
}
