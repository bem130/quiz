import type { Option, Result } from '../../core/result.ts';
import { parseQuizJson, serializeQuiz } from '../../core/schema.ts';
import type {
    AssetRecord, AttemptRecord, BackupSnapshot, CommitAnswer, CommitAnswerResult, ConceptStatsRecord,
    ConfusionRecord, DatabaseRecords, DraftRecord, PackageRecord, ScheduleRecord, SessionRecord,
    SessionSummary, SettingRecord, StorageError, StoreName, UserRecord
} from './types.ts';
import { STORE_NAMES, storageKey } from './types.ts';
import { failure, isStoreRecord, questionReferences, scoped, success, validateBackup } from './validation.ts';
import type { StoreRecord } from './validation.ts';

export const DATABASE_NAME = 'bem130-quiz-web-v1';
export const DATABASE_VERSION = 2;
const GENERATION_KEY = '__storage-generation';
const DRAFT_VERSION_KEY = '__draft-version';

function internalSetting(id: string): boolean {
    return id === GENERATION_KEY || id === DRAFT_VERSION_KEY;
}

function boundaryMessage(error: unknown): string {
    return error instanceof Error ? error.message : '保存APIで不明な失敗が発生した。';
}

function request<T>(operation: IDBRequest<T>): Promise<Result<T, StorageError>> {
    return new Promise((resolve) => {
        operation.onsuccess = () => resolve(success(operation.result));
        operation.onerror = () => resolve(failure('request', boundaryMessage(operation.error)));
    });
}

/** requestの成功ではなくtransactionのcommitを待つ。外部APIの例外はここで値に変換する。 */
function completion(transaction: IDBTransaction): Promise<Result<true, StorageError>> {
    return new Promise((resolve) => {
        transaction.oncomplete = () => resolve(success(true));
        transaction.onabort = () => resolve(failure('aborted', boundaryMessage(transaction.error)));
        transaction.onerror = () => { /* abortが最終結果を返す。 */ };
    });
}

async function readOne<K extends StoreName>(transaction: IDBTransaction, name: K, key: string): Promise<Result<Option<StoreRecord<K>>, StorageError>> {
    const operation: IDBRequest<unknown> = transaction.objectStore(name).get(key);
    const result = await request(operation);
    if (!result.ok) return result;
    if (result.value === undefined) return success({ kind: 'none' });
    if (!isStoreRecord(name, result.value)) return failure('invalid', `${name}の保存内容が不正である。`);
    return success({ kind: 'some', value: result.value });
}

async function readAll<K extends StoreName>(transaction: IDBTransaction, name: K): Promise<Result<ReadonlyArray<StoreRecord<K>>, StorageError>> {
    const result: Result<unknown, StorageError> = await request(transaction.objectStore(name).getAll());
    if (!result.ok) return result;
    if (!Array.isArray(result.value)) return failure('invalid', `${name}の保存内容が不正である。`);
    const entries: StoreRecord<K>[] = [];
    for (const value of result.value) {
        if (!isStoreRecord(name, value)) return failure('invalid', `${name}の保存内容が不正である。`);
        entries.push(value);
    }
    return success(entries);
}

async function put<K extends StoreName>(transaction: IDBTransaction, name: K, value: StoreRecord<K>): Promise<Result<true, StorageError>> {
    if (!isStoreRecord(name, value)) return failure('invalid', `${name}に保存する値が不正である。`);
    const result = await request(transaction.objectStore(name).put(value));
    return result.ok ? success(true) : result;
}

async function remove(transaction: IDBTransaction, name: StoreName, id: string): Promise<Result<true, StorageError>> {
    const result = await request(transaction.objectStore(name).delete(id));
    return result.ok ? success(true) : result;
}

/** 削除・同名再作成や移動先の再利用でもCASの版番号を再利用しない。 */
async function nextDraftVersion(transaction: IDBTransaction): Promise<Result<number, StorageError>> {
    const current = await readOne(transaction, 'settings', DRAFT_VERSION_KEY); if (!current.ok) return current;
    if (current.value.kind === 'none') return failure('invalid', '草稿の採番情報が存在しない。');
    const text = current.value.value.value;
    const version = Number(text);
    if (!/^(?:0|[1-9]\d*)$/u.test(text) || !Number.isSafeInteger(version) || version >= Number.MAX_SAFE_INTEGER) {
        return failure('invalid', '草稿の採番情報が不正または上限に達している。');
    }
    const next = version + 1;
    const saved = await put(transaction, 'settings', { id: DRAFT_VERSION_KEY, value: String(next) });
    return saved.ok ? success(next) : saved;
}

async function snapshot(transaction: IDBTransaction): Promise<Result<DatabaseRecords, StorageError>> {
    const users = await readAll(transaction, 'users'); if (!users.ok) return users;
    const drafts = await readAll(transaction, 'drafts'); if (!drafts.ok) return drafts;
    const packages = await readAll(transaction, 'packages'); if (!packages.ok) return packages;
    const attempts = await readAll(transaction, 'attempts'); if (!attempts.ok) return attempts;
    const sessions = await readAll(transaction, 'sessions'); if (!sessions.ok) return sessions;
    const schedule = await readAll(transaction, 'schedule'); if (!schedule.ok) return schedule;
    const confusion = await readAll(transaction, 'confusion'); if (!confusion.ok) return confusion;
    const conceptStats = await readAll(transaction, 'conceptStats'); if (!conceptStats.ok) return conceptStats;
    const settings = await readAll(transaction, 'settings'); if (!settings.ok) return settings;
    const assets = await readAll(transaction, 'assets'); if (!assets.ok) return assets;
    return success({
        users: users.value, drafts: drafts.value, packages: packages.value, attempts: attempts.value,
        sessions: sessions.value, schedule: schedule.value, confusion: confusion.value,
        conceptStats: conceptStats.value, settings: settings.value.filter((entry) => !internalSetting(entry.id)), assets: assets.value
    });
}

function sameRecord(left: AttemptRecord, right: AttemptRecord): boolean {
    return left.id === right.id && left.sessionId === right.sessionId && left.userId === right.userId &&
        left.packageId === right.packageId && left.questionId === right.questionId && left.patternId === right.patternId &&
        left.conceptId === right.conceptId && left.chosenConceptId.kind === right.chosenConceptId.kind &&
        (left.chosenConceptId.kind === 'none' || (right.chosenConceptId.kind === 'some' && left.chosenConceptId.value === right.chosenConceptId.value)) &&
        left.result === right.result && left.answerMs === right.answerMs && left.answeredAt === right.answeredAt;
}

function summarized(attempts: ReadonlyArray<AttemptRecord>, durationMs: number): SessionSummary {
    return {
        answered: attempts.length,
        correct: attempts.filter((entry) => entry.result === 'strong' || entry.result === 'weak').length,
        idk: attempts.filter((entry) => entry.result === 'idk').length,
        durationMs
    };
}

/**
 * 新規Webアプリ専用の単一DB。旧アプリのDBやlocalStorageは読み書きしない。
 * 書き込みは全storeのtransactionで直列化し、復元後の別タブによる旧状態の保存を世代で拒否する。
 */
export class QuizStorage {
    private readonly database: IDBDatabase;
    private generation: string;
    private closed = false;

    constructor(database: IDBDatabase, generation: string) {
        this.database = database;
        this.generation = generation;
        database.onversionchange = () => this.close();
    }

    close(): void {
        this.closed = true;
        this.database.close();
    }

    private async run<T>(mode: IDBTransactionMode, operation: (transaction: IDBTransaction) => Promise<Result<T, StorageError>>): Promise<Result<T, StorageError>> {
        if (this.closed) return failure('closed', '保存領域への接続は閉じられている。再読み込みが必要である。');
        try {
            const transaction = this.database.transaction([...STORE_NAMES], mode);
            const completed = completion(transaction);
            let result: Result<T, StorageError>;
            try {
                const generation = await readOne(transaction, 'settings', GENERATION_KEY);
                if (!generation.ok) result = generation;
                else if (generation.value.kind !== 'some' || generation.value.value.value !== this.generation) {
                    result = failure('conflict', '別の画面でデータが置き換えられた。再読み込みが必要である。');
                } else result = await operation(transaction);
                if (!result.ok) transaction.abort();
            } catch (error) {
                try { transaction.abort(); } catch { /* 既に中断・完了したtransaction。 */ }
                result = failure('request', boundaryMessage(error));
            }
            const committed = await completed;
            if (!result.ok) return result;
            return committed.ok ? result : committed;
        } catch (error) {
            return failure('unavailable', boundaryMessage(error));
        }
    }

    listUsers(): Promise<Result<ReadonlyArray<UserRecord>, StorageError>> { return this.run('readonly', (transaction) => readAll(transaction, 'users')); }
    listDrafts(): Promise<Result<ReadonlyArray<DraftRecord>, StorageError>> { return this.run('readonly', (transaction) => readAll(transaction, 'drafts')); }
    listPackages(): Promise<Result<ReadonlyArray<PackageRecord>, StorageError>> { return this.run('readonly', (transaction) => readAll(transaction, 'packages')); }
    listAttempts(): Promise<Result<ReadonlyArray<AttemptRecord>, StorageError>> { return this.run('readonly', (transaction) => readAll(transaction, 'attempts')); }
    listSessions(): Promise<Result<ReadonlyArray<SessionRecord>, StorageError>> { return this.run('readonly', (transaction) => readAll(transaction, 'sessions')); }
    listSchedule(): Promise<Result<ReadonlyArray<ScheduleRecord>, StorageError>> { return this.run('readonly', (transaction) => readAll(transaction, 'schedule')); }
    listConfusion(): Promise<Result<ReadonlyArray<ConfusionRecord>, StorageError>> { return this.run('readonly', (transaction) => readAll(transaction, 'confusion')); }
    listConceptStats(): Promise<Result<ReadonlyArray<ConceptStatsRecord>, StorageError>> { return this.run('readonly', (transaction) => readAll(transaction, 'conceptStats')); }
    listAssets(): Promise<Result<ReadonlyArray<AssetRecord>, StorageError>> { return this.run('readonly', (transaction) => readAll(transaction, 'assets')); }

    getAsset(url: string): Promise<Result<Option<AssetRecord>, StorageError>> {
        return this.run('readonly', (transaction) => readOne(transaction, 'assets', url));
    }

    saveAsset(value: AssetRecord): Promise<Result<AssetRecord, StorageError>> {
        return this.run('readwrite', async (transaction) => {
            if (!isStoreRecord('assets', value)) return failure('invalid', '資産のURL・内容・大きさが不正である。');
            const existing = await readOne(transaction, 'assets', value.id); if (!existing.ok) return existing;
            if (existing.value.kind === 'some' && existing.value.value.updatedAt > value.updatedAt) return failure('conflict', 'より新しい資産が保存されている。');
            const saved = await put(transaction, 'assets', value);
            return saved.ok ? success(value) : saved;
        });
    }

    createUser(value: UserRecord): Promise<Result<UserRecord, StorageError>> {
        return this.run('readwrite', async (transaction) => {
            const existing = await readOne(transaction, 'users', value.id);
            if (!existing.ok) return existing;
            if (existing.value.kind === 'some') return failure('conflict', 'ユーザーIDは既に使われている。');
            const saved = await put(transaction, 'users', value);
            return saved.ok ? success(value) : saved;
        });
    }

    saveDraft(value: Readonly<{ id: string; text: string; updatedAt: number; expectedVersion: number }>): Promise<Result<DraftRecord, StorageError>> {
        return this.run('readwrite', async (transaction) => {
            const existing = await readOne(transaction, 'drafts', value.id);
            if (!existing.ok) return existing;
            const actualVersion = existing.value.kind === 'some' ? existing.value.value.version : 0;
            if (actualVersion !== value.expectedVersion) return failure('conflict', '草稿は別の画面で変更されている。');
            const version = await nextDraftVersion(transaction); if (!version.ok) return version;
            const draft = { id: value.id, text: value.text, updatedAt: value.updatedAt, version: version.value };
            const saved = await put(transaction, 'drafts', draft);
            return saved.ok ? success(draft) : saved;
        });
    }

    moveDraft(from: string, to: string, expectedVersion: number, now: number): Promise<Result<DraftRecord, StorageError>> {
        return this.run('readwrite', async (transaction) => {
            const existing = await readOne(transaction, 'drafts', from);
            if (!existing.ok) return existing;
            if (existing.value.kind === 'none') return failure('missing', '移動元の草稿が存在しない。');
            if (existing.value.value.version !== expectedVersion) return failure('conflict', '移動元の草稿は変更されている。');
            const target = await readOne(transaction, 'drafts', to);
            if (!target.ok) return target;
            if (from !== to && target.value.kind === 'some') return failure('conflict', '移動先の草稿が存在する。');
            const version = await nextDraftVersion(transaction); if (!version.ok) return version;
            const moved = { ...existing.value.value, id: to, updatedAt: now, version: version.value };
            const saved = await put(transaction, 'drafts', moved); if (!saved.ok) return saved;
            if (from !== to) { const deleted = await remove(transaction, 'drafts', from); if (!deleted.ok) return deleted; }
            return success(moved);
        });
    }

    deleteDraft(id: string, expectedVersion: number): Promise<Result<true, StorageError>> {
        return this.run('readwrite', async (transaction) => {
            const existing = await readOne(transaction, 'drafts', id); if (!existing.ok) return existing;
            if (existing.value.kind === 'none') return failure('missing', '削除する草稿が存在しない。');
            if (existing.value.value.version !== expectedVersion) return failure('conflict', '草稿は別の画面で変更されている。');
            return remove(transaction, 'drafts', id);
        });
    }

    private async draftTree(transaction: IDBTransaction, prefix: string, expected: ReadonlyArray<Readonly<{ id: string; version: number }>>): Promise<Result<ReadonlyArray<DraftRecord>, StorageError>> {
        if (!prefix.endsWith('/') || prefix.length < 2) return failure('invalid', 'フォルダのパスは末尾の/を含めて指定する。');
        const all = await readAll(transaction, 'drafts'); if (!all.ok) return all;
        const selected = all.value.filter((entry) => entry.id.startsWith(prefix));
        const versions = new Map(expected.map((entry) => [entry.id, entry.version]));
        if (selected.length === 0) return failure('missing', 'フォルダが存在しない。');
        if (versions.size !== expected.length || selected.length !== expected.length || selected.some((entry) => versions.get(entry.id) !== entry.version)) {
            return failure('conflict', 'フォルダ内の草稿が別の画面で変更されている。');
        }
        return success(selected);
    }

    moveDraftTree(from: string, to: string, expected: ReadonlyArray<Readonly<{ id: string; version: number }>>, now: number): Promise<Result<ReadonlyArray<DraftRecord>, StorageError>> {
        return this.run('readwrite', async (transaction) => {
            if (!to.endsWith('/') || to.length < 2 || to === from || to.startsWith(from)) return failure('invalid', 'フォルダの移動先が不正である。');
            const selected = await this.draftTree(transaction, from, expected); if (!selected.ok) return selected;
            const moved: DraftRecord[] = [];
            for (const entry of selected.value) {
                const version = await nextDraftVersion(transaction); if (!version.ok) return version;
                moved.push({ ...entry, id: to + entry.id.slice(from.length), version: version.value, updatedAt: now });
            }
            for (const entry of moved) {
                const target = await readOne(transaction, 'drafts', entry.id); if (!target.ok) return target;
                if (target.value.kind === 'some') return failure('conflict', '移動先に同じ名前の草稿が存在する。');
            }
            for (const entry of moved) { const saved = await put(transaction, 'drafts', entry); if (!saved.ok) return saved; }
            for (const entry of selected.value) { const deleted = await remove(transaction, 'drafts', entry.id); if (!deleted.ok) return deleted; }
            return success(moved);
        });
    }

    deleteDraftTree(prefix: string, expected: ReadonlyArray<Readonly<{ id: string; version: number }>>): Promise<Result<true, StorageError>> {
        return this.run('readwrite', async (transaction) => {
            const selected = await this.draftTree(transaction, prefix, expected); if (!selected.ok) return selected;
            for (const entry of selected.value) { const deleted = await remove(transaction, 'drafts', entry.id); if (!deleted.ok) return deleted; }
            return success(true);
        });
    }

    getSetting(id: string): Promise<Result<Option<string>, StorageError>> {
        return this.run('readonly', async (transaction) => {
            const result = await readOne(transaction, 'settings', id);
            if (!result.ok) return result;
            return success(result.value.kind === 'some' ? { kind: 'some', value: result.value.value.value } : { kind: 'none' });
        });
    }

    setSetting(value: SettingRecord): Promise<Result<true, StorageError>> {
        if (internalSetting(value.id)) return Promise.resolve(failure('invalid', '内部設定は変更できない。'));
        return this.run('readwrite', (transaction) => put(transaction, 'settings', value));
    }

    startSession(value: SessionRecord): Promise<Result<SessionRecord, StorageError>> {
        return this.run('readwrite', async (transaction) => {
            if (!isStoreRecord('sessions', value) || value.endedAt.kind !== 'none' || value.summary.kind !== 'none') {
                return failure('invalid', '開始するセッションが不正である。');
            }
            const user = await readOne(transaction, 'users', value.userId); if (!user.ok) return user;
            if (user.value.kind === 'none') return failure('missing', 'ユーザーが存在しない。');
            const existing = await readOne(transaction, 'sessions', value.id); if (!existing.ok) return existing;
            if (existing.value.kind === 'some') return failure('conflict', 'セッションIDは既に使われている。');
            for (const id of value.packageIds) {
                const entry = await readOne(transaction, 'packages', id); if (!entry.ok) return entry;
                if (entry.value.kind === 'none') return failure('missing', '題庫が存在しない。');
                const replayPackage = value.replay.packages.find((record) => record.id === id);
                if (!replayPackage || replayPackage.revision !== entry.value.value.revision) return failure('conflict', '開始時の題庫revisionが保存内容と一致しない。');
            }
            const saved = await put(transaction, 'sessions', value);
            return saved.ok ? success(value) : saved;
        });
    }

    finishSession(id: string, summary: SessionSummary, endedAt: number): Promise<Result<SessionRecord, StorageError>> {
        return this.run('readwrite', async (transaction) => {
            const existing = await readOne(transaction, 'sessions', id); if (!existing.ok) return existing;
            if (existing.value.kind === 'none') return failure('missing', 'セッションが存在しない。');
            const value = existing.value.value;
            if (value.endedAt.kind === 'some') return success(value);
            const attempts = await readAll(transaction, 'attempts'); if (!attempts.ok) return attempts;
            if (!Number.isFinite(endedAt) || endedAt < value.startedAt || attempts.value.some((entry) => entry.sessionId === id && entry.answeredAt > endedAt)) {
                return failure('invalid', '終了時刻が保存済みの回答より前である。');
            }
            const actual = summarized(attempts.value.filter((entry) => entry.sessionId === id), endedAt - value.startedAt);
            if (actual.answered !== summary.answered || actual.correct !== summary.correct || actual.idk !== summary.idk) {
                return failure('conflict', '回答の保存完了前にセッションを終了できない。');
            }
            const finished: SessionRecord = { ...value, endedAt: { kind: 'some', value: endedAt }, summary: { kind: 'some', value: actual } };
            const saved = await put(transaction, 'sessions', finished);
            return saved.ok ? success(finished) : saved;
        });
    }

    /** 題庫更新は検証後に確定し、旧回答を除去したセッション集計を同時に再計算する。 */
    replacePackage(value: PackageRecord, expectedRevision: Option<string>): Promise<Result<PackageRecord, StorageError>> {
        const parsed = parseQuizJson(value.json);
        if (!parsed.ok) return Promise.resolve(failure('invalid', '題庫のJSONまたはschemaが不正である。'));
        const canonical = serializeQuiz(parsed.value);
        const next = { ...value, json: canonical, revision: canonical };
        if (!isStoreRecord('packages', next)) return Promise.resolve(failure('invalid', '題庫の保存情報が不正である。'));
        return this.run('readwrite', async (transaction) => {
            const existing = await readOne(transaction, 'packages', next.id); if (!existing.ok) return existing;
            if ((expectedRevision.kind === 'none' && existing.value.kind === 'some') ||
                (expectedRevision.kind === 'some' && (existing.value.kind === 'none' || existing.value.value.revision !== expectedRevision.value))) {
                return failure('conflict', '題庫は別の画面で更新されている。再読み込みが必要である。');
            }
            if (existing.value.kind === 'some' && existing.value.value.revision !== canonical) {
                const purged = await this.purgePackage(transaction, next.id, next.updatedAt); if (!purged.ok) return purged;
            }
            const saved = await put(transaction, 'packages', next);
            return saved.ok ? success(next) : saved;
        });
    }

    deletePackage(id: string, now: number): Promise<Result<true, StorageError>> {
        return this.run('readwrite', async (transaction) => {
            const existing = await readOne(transaction, 'packages', id); if (!existing.ok) return existing;
            if (existing.value.kind === 'none') return failure('missing', '削除する題庫が存在しない。');
            const purged = await this.purgePackage(transaction, id, now); if (!purged.ok) return purged;
            const sessions = await readAll(transaction, 'sessions'); if (!sessions.ok) return sessions;
            for (const session of sessions.value) {
                if (!session.packageIds.includes(id)) continue;
                const packageIds = session.packageIds.filter((packageId) => packageId !== id);
                const changed = packageIds.length > 0
                    ? await put(transaction, 'sessions', { ...session, packageIds })
                    : await remove(transaction, 'sessions', session.id);
                if (!changed.ok) return changed;
            }
            return remove(transaction, 'packages', id);
        });
    }

    private async purgePackage(transaction: IDBTransaction, packageId: string, now: number): Promise<Result<true, StorageError>> {
        for (const name of ['attempts', 'schedule', 'confusion', 'conceptStats'] as const) {
            const entries = await readAll(transaction, name); if (!entries.ok) return entries;
            for (const entry of entries.value) {
                if (entry.packageId === packageId) { const deleted = await remove(transaction, name, entry.id); if (!deleted.ok) return deleted; }
            }
        }
        const sessions = await readAll(transaction, 'sessions'); if (!sessions.ok) return sessions;
        const attempts = await readAll(transaction, 'attempts'); if (!attempts.ok) return attempts;
        for (const session of sessions.value) {
            if (!session.packageIds.includes(packageId)) continue;
            const endedAt = session.endedAt.kind === 'some' ? session.endedAt.value : Math.max(now, session.startedAt);
            const updated: SessionRecord = {
                ...session, endedAt: { kind: 'some', value: endedAt },
                summary: { kind: 'some', value: summarized(attempts.value.filter((entry) => entry.sessionId === session.id), endedAt - session.startedAt) }
            };
            const saved = await put(transaction, 'sessions', updated); if (!saved.ok) return saved;
        }
        return success(true);
    }

    deleteUser(id: string): Promise<Result<true, StorageError>> {
        return this.run('readwrite', async (transaction) => {
            const existing = await readOne(transaction, 'users', id); if (!existing.ok) return existing;
            if (existing.value.kind === 'none') return failure('missing', 'ユーザーが存在しない。');
            for (const name of ['attempts', 'sessions', 'schedule', 'confusion', 'conceptStats'] as const) {
                const entries = await readAll(transaction, name); if (!entries.ok) return entries;
                for (const entry of entries.value) {
                    if (entry.userId === id) { const deleted = await remove(transaction, name, entry.id); if (!deleted.ok) return deleted; }
                }
            }
            const settings = await readAll(transaction, 'settings'); if (!settings.ok) return settings;
            for (const entry of settings.value) {
                if (entry.id === 'activeUserId' && entry.value === id) { const deleted = await remove(transaction, 'settings', entry.id); if (!deleted.ok) return deleted; }
            }
            return remove(transaction, 'users', id);
        });
    }

    commitAnswer(command: CommitAnswer): Promise<Result<CommitAnswerResult, StorageError>> {
        return this.run<CommitAnswerResult>('readwrite', async (transaction) => {
            const attempt = command.attempt;
            if (!isStoreRecord('attempts', attempt) || !questionReferences(attempt) ||
                (attempt.chosenConceptId.kind === 'some' && !scoped(attempt.chosenConceptId.value, attempt.packageId, 'concept', 3))) {
                return failure('invalid', '回答内容が不正である。');
            }
            const existing = await readOne(transaction, 'attempts', attempt.id); if (!existing.ok) return existing;
            if (existing.value.kind === 'some') {
                return sameRecord(existing.value.value, attempt) ? success({ duplicate: true }) : failure('conflict', '回答IDが異なる内容で再利用された。');
            }
            const session = await readOne(transaction, 'sessions', attempt.sessionId); if (!session.ok) return session;
            if (session.value.kind === 'none' || session.value.value.endedAt.kind !== 'none') return failure('missing', '回答可能なセッションが存在しない。');
            const parent = session.value.value;
            if (parent.userId !== attempt.userId || !parent.packageIds.includes(attempt.packageId) ||
                !parent.replay.questionIds.includes(attempt.questionId) || attempt.answeredAt < parent.startedAt) {
                return failure('invalid', '回答とセッションの参照が一致しない。');
            }
            if (parent.mode === 'test' && (command.schedule.kind === 'some' || command.confusion.length > 0 || command.conceptStats.kind === 'some')) {
                return failure('invalid', 'テスト回答は学習記録を変更できない。');
            }
            const saved = await put(transaction, 'attempts', attempt); if (!saved.ok) return saved;
            if (command.schedule.kind === 'some') {
                const change = command.schedule.value;
                const next = change.next;
                if (next.userId !== attempt.userId || next.packageId !== attempt.packageId || next.questionId !== attempt.questionId ||
                    next.patternId !== attempt.patternId || next.conceptId !== attempt.conceptId || next.version !== change.expectedVersion + 1 ||
                    next.id !== storageKey(attempt.userId, attempt.questionId)) return failure('invalid', '調度更新の識別子またはversionが不正である。');
                const previous = await readOne(transaction, 'schedule', next.id); if (!previous.ok) return previous;
                const version = previous.value.kind === 'some' ? previous.value.value.version : 0;
                if (version !== change.expectedVersion) return failure('conflict', '調度は別の画面で変更されている。');
                const updated = await put(transaction, 'schedule', next); if (!updated.ok) return updated;
            }
            const statistics = await this.updateStatistics(transaction, command); if (!statistics.ok) return statistics;
            return success({ duplicate: false });
        });
    }

    private async updateStatistics(transaction: IDBTransaction, command: CommitAnswer): Promise<Result<true, StorageError>> {
        const { userId, packageId, conceptId } = command.attempt;
        for (const delta of command.confusion) {
            if (delta.conceptId !== conceptId || delta.wrongConceptId === conceptId || !scoped(delta.wrongConceptId, packageId, 'concept', 3) ||
                ![delta.shown, delta.chosen, delta.idkNear].every((value) => Number.isSafeInteger(value) && value >= 0)) {
                return failure('invalid', '混同記録の更新値が不正である。');
            }
            const id = storageKey(userId, packageId, conceptId, delta.wrongConceptId);
            const previous = await readOne(transaction, 'confusion', id); if (!previous.ok) return previous;
            const value: ConfusionRecord = previous.value.kind === 'some' ? previous.value.value : { id, userId, packageId, conceptId, wrongConceptId: delta.wrongConceptId, shown: 0, chosen: 0, idkNear: 0 };
            const updated = await put(transaction, 'confusion', { ...value, shown: value.shown + delta.shown, chosen: value.chosen + delta.chosen, idkNear: value.idkNear + delta.idkNear });
            if (!updated.ok) return updated;
        }
        if (command.conceptStats.kind === 'some') {
            const delta = command.conceptStats.value;
            if (delta.conceptId !== conceptId || ![delta.uncertaintyMultiplier, delta.uncertaintyAdd, delta.recentIdkMultiplier, delta.recentIdkAdd].every((value) => Number.isFinite(value) && value >= 0)) {
                return failure('invalid', '概念統計の更新値が不正である。');
            }
            const id = storageKey(userId, packageId, conceptId);
            const previous = await readOne(transaction, 'conceptStats', id); if (!previous.ok) return previous;
            const value: ConceptStatsRecord = previous.value.kind === 'some' ? previous.value.value : { id, userId, packageId, conceptId, uncertainty: 0, recentIdk: 0 };
            const updated = await put(transaction, 'conceptStats', {
                ...value, uncertainty: value.uncertainty * delta.uncertaintyMultiplier + delta.uncertaintyAdd,
                recentIdk: value.recentIdk * delta.recentIdkMultiplier + delta.recentIdkAdd
            });
            if (!updated.ok) return updated;
        }
        return success(true);
    }

    exportBackup(): Promise<Result<BackupSnapshot, StorageError>> {
        return this.run('readonly', async (transaction) => {
            const result = await snapshot(transaction); if (!result.ok) return result;
            return validateBackup({ format: 'bem130-quiz-backup', version: 2, records: result.value });
        });
    }

    async restoreBackup(value: unknown): Promise<Result<true, StorageError>> {
        let isolated: unknown;
        try { isolated = structuredClone(value); }
        catch (error) { return failure('invalid', boundaryMessage(error)); }
        const parsed = validateBackup(isolated); if (!parsed.ok) return parsed;
        if (parsed.value.records.settings.some((setting) => internalSetting(setting.id))) return failure('invalid', '内部設定をバックアップから復元できない。');
        if (Number(this.generation) >= Number.MAX_SAFE_INTEGER) return failure('invalid', '保存領域の世代情報が上限に達している。');
        const nextGeneration = String(Number(this.generation) + 1);
        const restored = await this.run('readwrite', async (transaction) => {
            for (const name of STORE_NAMES) {
                const cleared = await request(transaction.objectStore(name).clear()); if (!cleared.ok) return cleared;
                for (const entry of parsed.value.records[name]) {
                    const saved = await request(transaction.objectStore(name).put(entry)); if (!saved.ok) return saved;
                }
            }
            let maxVersion = 0;
            for (const draft of parsed.value.records.drafts) maxVersion = Math.max(maxVersion, draft.version);
            const counter = await put(transaction, 'settings', { id: DRAFT_VERSION_KEY, value: String(maxVersion) });
            if (!counter.ok) return counter;
            return put(transaction, 'settings', { id: GENERATION_KEY, value: nextGeneration });
        });
        if (restored.ok) this.generation = nextGeneration;
        return restored;
    }

    clearAll(): Promise<Result<true, StorageError>> {
        return this.restoreBackup({
            format: 'bem130-quiz-backup', version: 2,
            records: { users: [], drafts: [], packages: [], attempts: [], sessions: [], schedule: [], confusion: [], conceptStats: [], settings: [], assets: [] }
        });
    }
}

/** ブラウザのAPI不存在・blocked・open失敗をResultへ変換する。 */
export async function openQuizStorage(name = DATABASE_NAME, factory: IDBFactory = globalThis.indexedDB): Promise<Result<QuizStorage, StorageError>> {
    if (typeof factory === 'undefined') return failure('unavailable', 'この環境ではIndexedDBを利用できない。');
    try {
        const opened = await new Promise<Result<IDBDatabase, StorageError>>((resolve) => {
            const operation = factory.open(name, DATABASE_VERSION);
            let blocked = false;
            operation.onupgradeneeded = () => {
                for (const store of STORE_NAMES) {
                    if (!operation.result.objectStoreNames.contains(store)) operation.result.createObjectStore(store, { keyPath: 'id' });
                }
            };
            operation.onblocked = () => { blocked = true; resolve(failure('blocked', '別の画面が保存領域の更新を妨げている。')); };
            operation.onerror = () => resolve(failure('unavailable', boundaryMessage(operation.error)));
            operation.onsuccess = () => {
                if (blocked) operation.result.close();
                else resolve(success(operation.result));
            };
        });
        if (!opened.ok) return opened;
        const database = opened.value;
        const transaction = database.transaction(['settings', 'drafts'], 'readwrite');
        const completed = completion(transaction);
        const current = await readOne(transaction, 'settings', GENERATION_KEY);
        if (!current.ok) { transaction.abort(); await completed; database.close(); return current; }
        const generation = current.value.kind === 'some' ? current.value.value.value : '1';
        if (!/^[1-9]\d*$/u.test(generation) || !Number.isSafeInteger(Number(generation))) {
            transaction.abort(); await completed; database.close();
            return failure('invalid', '保存領域の世代情報が不正である。');
        }
        const saved = await put(transaction, 'settings', { id: GENERATION_KEY, value: generation });
        if (!saved.ok) transaction.abort();
        if (saved.ok) {
            const drafts = await readAll(transaction, 'drafts');
            const counter = await readOne(transaction, 'settings', DRAFT_VERSION_KEY);
            if (!drafts.ok || !counter.ok) {
                transaction.abort(); await completed; database.close();
                return !drafts.ok ? drafts : !counter.ok ? counter : failure('invalid', '草稿の採番情報を取得できない。');
            }
            let maxVersion = 0;
            for (const draft of drafts.value) maxVersion = Math.max(maxVersion, draft.version);
            if (counter.value.kind === 'some') {
                const text = counter.value.value.value;
                if (!/^(?:0|[1-9]\d*)$/u.test(text) || !Number.isSafeInteger(Number(text))) {
                    transaction.abort(); await completed; database.close();
                    return failure('invalid', '草稿の採番情報が不正である。');
                }
                maxVersion = Math.max(maxVersion, Number(text));
            }
            const initialized = await put(transaction, 'settings', { id: DRAFT_VERSION_KEY, value: String(maxVersion) });
            if (!initialized.ok) { transaction.abort(); await completed; database.close(); return initialized; }
        }
        const committed = await completed;
        if (!saved.ok) { database.close(); return saved; }
        if (!committed.ok) { database.close(); return committed; }
        return success(new QuizStorage(database, generation));
    } catch (error) {
        return failure('unavailable', boundaryMessage(error));
    }
}
