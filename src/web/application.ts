import { packageIdentity, parsePackageId, parseUserId, parseSessionId } from '../core/identity.ts';
import type { PatternId } from '../core/identity.ts';
import type { QuizFile } from '../core/model.ts';
import { plainText } from '../core/content.ts';
import { prepareQuiz } from '../core/quiz-engine.ts';
import type { PreparedQuiz, QuestionCandidate } from '../core/quiz-engine.ts';
import type { Question } from '../core/quiz-engine.ts';
import type { Row } from '../core/model.ts';
import { parseEntryJson, parseQuizJson, serializeQuiz } from '../core/schema.ts';
import { answerSession, confirmAnswer, createSession, finishSession, nextQuestion, retryCandidates, sessionSummary } from '../core/session.ts';
import type { Completion, Selection, SessionState } from '../core/session.ts';
import { err, none, ok, some } from '../core/result.ts';
import type { Option, Result } from '../core/result.ts';
import type { AttemptRecord, DraftRecord, PackageRecord, UserRecord } from '../core/records.ts';
import { openQuizStorage } from './storage/database.ts';
import type { QuizStorage } from './storage/database.ts';
import { renderTokens, richText } from './content.ts';
import { fetchText, resolveHttpUrl } from './network.ts';
import type { EditorController } from './editor.ts';
import { importDraft } from './draft-import.ts';
import { addRubyItem, editorFilesFromEntry, editorFilesFromSetting, folderKeys, sourceControls } from './source-tools.ts';
import type { EditorFile, RubyBufferItem, SourceInfo, SourceRegion } from './source-tools.ts';
import { shareQr, shareUrl, sharedEntries, sharedScope } from './sharing.ts';
import { currentPublishedPage, publishedPages } from './published-sharing.ts';
import type { PublishedPages } from './published-sharing.ts';
import { clearAppCache } from './cache-reset.ts';

type LoadedPackage = Readonly<{ record: PackageRecord; quiz: QuizFile; prepared: PreparedQuiz }>;
type Preferences = Readonly<{ theme: 'light' | 'dark' | 'black'; font: 'sans' | 'serif'; scale: number; mode: 'study' | 'test'; completion: 'questions' | 'time' | 'drain'; count: number; minutes: number }>;
type Data = Readonly<{ users: readonly UserRecord[]; userId: UserRecord['id']; packages: readonly LoadedPackage[]; drafts: readonly DraftRecord[]; attempts: readonly AttemptRecord[]; entries: readonly string[]; editorFiles: readonly EditorFile[] }>;
type Screen = Readonly<{ kind: 'menu' }> | Readonly<{ kind: 'editor' }> | Readonly<{ kind: 'starting'; requestId: string }> |
    Readonly<{ kind: 'playing'; session: SessionState; idkPrompt: boolean }> |
    Readonly<{ kind: 'result'; session: SessionState }>;
type ReadyState = Readonly<{ kind: 'ready'; data: Data; screen: Screen; selected: readonly PatternId[]; preferences: Preferences }>;
type AppState = Readonly<{ kind: 'loading' }> | Readonly<{ kind: 'error'; message: string }> | ReadyState;
type EntryLoadIntent = 'refresh' | 'manual' | 'shared';
type UpdateState = Readonly<{ kind: 'idle' | 'preparing' | 'reload' }> |
    Readonly<{ kind: 'ready'; registration: ServiceWorkerRegistration; worker: ServiceWorker }> |
    Readonly<{ kind: 'failed'; initial: boolean }>;
const DEFAULTS: Preferences = { theme: 'light', font: 'sans', scale: 1, mode: 'study', completion: 'questions', count: 10, minutes: 10 };
const BACKUP_MAX_BYTES = 50_000_000;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
    const value = document.createElement(tag);
    value.textContent = text;
    value.className = className;
    return value;
}
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function preferencesFrom(value: string): Preferences {
    try {
        const parsed: unknown = JSON.parse(value);
        if (!isObject(parsed)) return DEFAULTS;
        return {
            theme: parsed['theme'] === 'dark' || parsed['theme'] === 'black' ? parsed['theme'] : 'light',
            font: parsed['font'] === 'serif' ? 'serif' : 'sans',
            scale: typeof parsed['scale'] === 'number' && parsed['scale'] >= 0.5 && parsed['scale'] <= 1.7 ? parsed['scale'] : 1,
            mode: parsed['mode'] === 'test' ? 'test' : 'study',
            completion: parsed['completion'] === 'time' || parsed['completion'] === 'drain' ? parsed['completion'] : 'questions',
            count: typeof parsed['count'] === 'number' && Number.isInteger(parsed['count']) && parsed['count'] > 0 && parsed['count'] <= 1000 ? parsed['count'] : 10,
            minutes: typeof parsed['minutes'] === 'number' && parsed['minutes'] > 0 && parsed['minutes'] <= 180 ? parsed['minutes'] : 10
        };
    } catch { return DEFAULTS; }
}

/** Webの副作用を調整する。問題・回答・保存待ちの正本は純粋なSessionStateに置く。 */
export class QuizApplication {
    private state: AppState = { kind: 'loading' };
    private storage: Option<QuizStorage> = none;
    private editor: Option<EditorController> = none;
    private renderGeneration = 0;
    private loadingGeneration = 0;
    private startGeneration = 0;
    private notice = '';
    private busy = false;
    private refreshQueue: Promise<void> = Promise.resolve();
    private preferencesQueue: Promise<void> = Promise.resolve();
    private replacingPreferences = false;
    private readonly host: HTMLElement;
    private readonly message: HTMLElement;
    private readonly view: HTMLElement;
    private readonly themeToggle: HTMLButtonElement;
    private readonly themeLabel: HTMLElement;
    private readonly headerUser: HTMLElement;
    private updateState: UpdateState = { kind: 'idle' };
    private readonly observedRegistrations = new WeakSet<ServiceWorkerRegistration>();
    private readonly observedWorkers = new WeakSet<ServiceWorker>();
    private rubyState: Readonly<{ sessionId: string; items: readonly RubyBufferItem[] }> = { sessionId: '', items: [] };
    private draftImportText = '';
    private draftImportPath = `imports/quiz-${crypto.randomUUID()}.json`;
    private sharedInputError: Option<string> = none;
    private published: Option<PublishedPages> = none;

    constructor(host: HTMLElement) {
        this.host = host;
        this.message = element('p', '', 'app-message');
        this.message.setAttribute('role', 'status');
        this.message.setAttribute('aria-live', 'polite');
        this.view = element('div', '', 'app-view');
        const header = element('header', '', 'app-header');
        this.headerUser = element('span', 'Guest');
        this.themeLabel = element('span', '', 'theme-current');
        this.themeToggle = this.button('', () => this.toggleTheme());
        this.themeToggle.setAttribute('aria-label', 'ダークテーマ'); this.themeToggle.className = 'theme-toggle';
        const themeControl = element('div', '', 'theme-control'); themeControl.append(this.themeLabel, this.themeToggle);
        header.append(element('h1', '4択クイズ'), this.headerUser, themeControl, this.button('全画面', async () => {
            if (document.fullscreenElement) await document.exitFullscreen(); else await this.host.requestFullscreen();
        }));
        host.replaceChildren(header, this.message, this.view);
        this.syncThemeControls();
        window.addEventListener('beforeunload', (event) => {
            if ((this.editor.kind === 'some' && this.editor.value.isDirty()) || this.isSaving()) { event.preventDefault(); event.returnValue = ''; }
        });
        document.addEventListener('keydown', (event) => this.keyboard(event));
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.run(() => this.checkUpdate()); });
        window.setInterval(() => this.run(() => this.tick()), 1000);
    }

    private run(action: () => Promise<void> | void): void {
        Promise.resolve().then(action).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : '処理に失敗した。再試行できる。';
            if (this.state.kind === 'loading') { this.state = { kind: 'error', message }; this.render(); }
            this.inform(message);
        });
    }
    private inform(text: string): void { this.notice = text; this.message.textContent = text; }
    private button(text: string, action: () => Promise<void> | void, disabled = false): HTMLButtonElement {
        const button = element('button', text);
        button.type = 'button'; button.disabled = disabled;
        button.addEventListener('click', () => this.run(action));
        return button;
    }
    private database(): Option<QuizStorage> { return this.storage; }
    private isSaving(): boolean { return this.state.kind === 'ready' && this.state.screen.kind === 'playing' && this.state.screen.session.phase.kind === 'saving'; }

    async start(): Promise<void> {
        const incoming = new URL(location.href);
        const incomingScope = incoming.searchParams.get('scope');
        const incomingEntries = sharedEntries(incoming.searchParams, document.baseURI);
        const registry = publishedPages(document.querySelector('meta[name="quiz-share-pages"]')?.getAttribute('content') ?? null, new URL(import.meta.env.BASE_URL, location.origin).href);
        this.published = registry.ok ? registry.value : none;
        const page = this.published.kind === 'some' ? currentPublishedPage(this.published.value, incoming.href) : none;
        this.sharedInputError = none;
        const generation = ++this.startGeneration;
        ++this.loadingGeneration;
        if (this.storage.kind === 'some') this.storage.value.close();
        this.storage = none;
        this.replacingPreferences = false; this.view.inert = false;
        this.busy = false;
        this.state = { kind: 'loading' }; this.render();
        let connection: Option<QuizStorage> = none;
        const current = (): boolean => generation === this.startGeneration;
        const superseded = (): boolean => {
            if (current()) return false;
            if (connection.kind === 'some') connection.value.close();
            return true;
        };
        try {
        await this.preferencesQueue;
        if (superseded()) return;
        const opened = await openQuizStorage();
        if (opened.ok) connection = some(opened.value);
        if (superseded()) return;
        if (!opened.ok) { this.state = { kind: 'error', message: opened.error.message }; this.render(); return; }
        this.storage = some(opened.value);
        const settings = await opened.value.getSetting('preferences');
        if (superseded()) return;
        if (!settings.ok) { this.state = { kind: 'error', message: settings.error.message }; this.render(); return; }
        const preferences = settings.value.kind === 'some' ? preferencesFrom(settings.value.value) : DEFAULTS;
        const loaded = await this.readData();
        if (superseded()) return;
        if (!loaded.ok) { this.state = { kind: 'error', message: loaded.error }; this.render(); return; }
        this.state = { kind: 'ready', data: loaded.value, screen: { kind: 'menu' }, selected: [], preferences };
        this.render();
        await this.loadEntry(new URL('entry.json', document.baseURI).href, 'refresh');
        if (superseded()) return;
        if (this.state.kind === 'ready') {
            const entries = this.state.data.entries;
            for (const entry of entries) if (entry !== new URL('entry.json', document.baseURI).href) {
                await this.loadEntry(entry, 'refresh'); if (superseded()) return;
            }
        }
        const received: PatternId[] = [];
        let receivedShared = false;
        if (incomingEntries.ok) for (const entry of incomingEntries.value) {
            const loadedEntry = await this.loadEntry(entry, 'shared'); if (superseded()) return;
            if (loadedEntry.kind === 'some') { receivedShared = true; received.push(...loadedEntry.value); }
        }
        if (this.state.kind === 'ready') {
            const pagePatterns = page.kind === 'some' ? this.state.data.packages.filter(item => item.record.source === page.value.source).flatMap(item => item.prepared.candidates.map(candidate => candidate.patternId)) : [];
            if (page.kind === 'some') this.state = { ...this.state, selected: [...new Set(pagePatterns)] };
            const valid = new Set(page.kind === 'some' ? pagePatterns : this.state.data.packages.flatMap((item) => item.prepared.candidates.map((candidate) => candidate.patternId)));
            const scope = sharedScope(incomingScope, valid);
            if (!registry.ok || !incomingEntries.ok || !scope.ok) {
                const message = [registry.ok ? '' : registry.error, incomingEntries.ok ? '' : incomingEntries.error, scope.ok ? '' : scope.error].filter(Boolean).join('\n');
                this.sharedInputError = some(message); this.inform(message);
            }
            else if (scope.value.kind === 'some') {
                this.state = { ...this.state, selected: scope.value.value };
                const url = new URL(location.href); url.searchParams.set('scope', JSON.stringify(scope.value.value)); history.replaceState(null, '', url);
            } else if (page.kind === 'none' && receivedShared) this.state = { ...this.state, selected: [...new Set(received)] };
            this.render();
        }
        await this.registerWorker();
        } catch (error) {
            if (superseded()) return;
            this.state = { kind: 'error', message: error instanceof Error ? error.message : '起動処理を完了できない。' };
            this.render();
        }
    }

    private async readData(): Promise<Result<Data, string>> {
        const db = this.database(); if (db.kind === 'none') return err('保存領域に接続できていない。');
        const users = await db.value.listUsers(); if (!users.ok) return err(users.error.message);
        let userList = users.value;
        if (!userList.length) {
            const id = parseUserId(crypto.randomUUID()); if (!id.ok) return err('ユーザーIDを作成できない。');
            const user = await db.value.createUser({ id: id.value, name: 'Guest', createdAt: Date.now() });
            if (!user.ok) return err(user.error.message);
            userList = [user.value];
        }
        const drafts = await db.value.listDrafts(); if (!drafts.ok) return err(drafts.error.message);
        let packages = await db.value.listPackages(); if (!packages.ok) return err(packages.error.message);
        // 不正JSONも編集中の草稿として保持し、検証済み版だけを題庫へ確定する。
        for (const draft of drafts.value.filter((item) => !item.id.endsWith('/'))) {
            const quiz = parseQuizJson(draft.text); if (!quiz.ok) continue;
            const id = packageIdentity({ kind: 'draft', id: draft.id }); if (!id.ok) continue;
            const json = serializeQuiz(quiz.value);
            const existing = packages.value.find((item) => item.id === id.value);
            if (existing?.revision === json) continue;
            const saved = await db.value.replacePackage({ id: id.value, source: draft.id, json, revision: json, updatedAt: Date.now() }, existing ? some(existing.revision) : none);
            if (!saved.ok) return err(saved.error.message);
        }
        // 削除・名前変更された草稿の旧題庫を出題対象へ残さない。
        for (const record of packages.value) {
            const source: unknown = JSON.parse(record.id);
            if (Array.isArray(source) && source.at(0) === 'draft' && !drafts.value.some((draft) => draft.id === record.source)) {
                const deleted = await db.value.deletePackage(record.id, Date.now()); if (!deleted.ok) return err(deleted.error.message);
            }
        }
        packages = await db.value.listPackages(); if (!packages.ok) return err(packages.error.message);
        const loaded: LoadedPackage[] = [];
        for (const record of packages.value) {
            const quiz = parseQuizJson(record.json); const id = parsePackageId(record.id);
            if (!quiz.ok || !id.ok) return err('保存済み題庫の検証に失敗した。バックアップから復元できる。');
            loaded.push({ record, quiz: quiz.value, prepared: prepareQuiz(quiz.value, id.value, record.revision) });
        }
        const active = await db.value.getSetting('activeUserId'); if (!active.ok) return err(active.error.message);
        const storedId = active.value.kind === 'some' ? active.value.value : '';
        const user = userList.find((item) => item.id === storedId) ?? userList.at(0);
        if (!user) return err('利用するユーザーを作成できない。');
        const attempts = await db.value.listAttempts(); if (!attempts.ok) return err(attempts.error.message);
        const entrySetting = await db.value.getSetting('entrySources'); if (!entrySetting.ok) return err(entrySetting.error.message);
        const entries: string[] = [];
        if (entrySetting.value.kind === 'some') {
            try {
                const value: unknown = JSON.parse(entrySetting.value.value);
                if (Array.isArray(value)) for (const item of value) {
                    if (typeof item !== 'string' || entries.length >= 50) continue;
                    const resolved = resolveHttpUrl(item, document.baseURI);
                    if (resolved.ok && !entries.includes(resolved.value)) entries.push(resolved.value);
                }
            } catch { if (this.storage.kind === 'some' && this.storage.value === db.value) this.inform('保存した問題一覧URLが不正なため、再追加が必要である。題庫は保持している。'); }
        }
        const editorSetting = await db.value.getSetting('editorFiles'); if (!editorSetting.ok) return err(editorSetting.error.message);
        const editorFiles = editorSetting.value.kind === 'some' ? editorFilesFromSetting(editorSetting.value.value) : [];
        return ok({ users: userList, userId: user.id, packages: loaded, drafts: drafts.value, attempts: attempts.value, entries, editorFiles });
    }

    private async refreshDataNow(): Promise<void> {
        const result = await this.readData();
        if (!result.ok) { this.inform(result.error); return; }
        if (this.state.kind !== 'ready') return;
        const valid = new Set(result.value.packages.flatMap((item) => item.prepared.candidates.map((candidate) => candidate.patternId)));
        this.state = { ...this.state, data: result.value, selected: this.state.selected.filter((id) => valid.has(id)) };
        if (this.state.screen.kind !== 'editor') this.render();
    }

    private refreshData(): Promise<void> {
        const pending = this.refreshQueue.then(() => this.refreshDataNow());
        this.refreshQueue = pending.catch((error: unknown) => this.inform(error instanceof Error ? error.message : '一覧を更新できない。'));
        return pending;
    }

    private async loadEntry(rawUrl: string, intent: EntryLoadIntent): Promise<Option<readonly PatternId[]>> {
        if (this.state.kind !== 'ready' || this.state.screen.kind !== 'menu' || this.busy || this.replacingPreferences) return none;
        const db = this.database(); if (db.kind === 'none') return none;
        const url = resolveHttpUrl(rawUrl, document.baseURI);
        if (!url.ok) { this.inform('entry URLはHTTP(S)で指定する。'); return none; }
        const generation = ++this.loadingGeneration;
        this.busy = true; this.inform('問題一覧を取得中…'); this.render();
        try {
        if (intent !== 'refresh' && !this.state.data.entries.includes(url.value)) {
            const entries = [...this.state.data.entries, url.value].slice(-50);
            const saved = await db.value.setSetting({ id: 'entrySources', value: JSON.stringify(entries) });
            if (generation !== this.loadingGeneration) return none;
            if (!saved.ok) { this.inform(saved.error.message); return none; }
            this.state = { ...this.state, data: { ...this.state.data, entries } };
        }
            const fetched = await fetchText(url.value);
            if (generation !== this.loadingGeneration) return none;
            if (!fetched.ok) { this.inform('問題一覧を取得できない。保存済み題庫と草稿は引き続き利用できる。'); return none; }
            const entry = parseEntryJson(fetched.value.text);
            if (!entry.ok) { this.inform(`entryの形式が不正: ${entry.error.path} ${entry.error.detail}`); return none; }
            const editorMapping = editorFilesFromEntry(fetched.value.text, fetched.value.url, entry.value.files);
            const newEditorFiles: EditorFile[] = [];
            const selected: PatternId[] = [];
            const errors: string[] = [];
            for (const path of entry.value.files) {
                const resolved = resolveHttpUrl(path, fetched.value.url);
                if (!resolved.ok) { errors.push(path); continue; }
                const before = await db.value.listPackages(); if (!before.ok) { errors.push(path); continue; }
                const text = await fetchText(resolved.value);
                if (generation !== this.loadingGeneration) return none;
                if (!text.ok) { errors.push(path); continue; }
                const quiz = parseQuizJson(text.value.text);
                const identity = packageIdentity({ kind: 'remote', url: text.value.url });
                if (!quiz.ok || !identity.ok) { errors.push(path); continue; }
                const editorFile = editorMapping.ok ? editorMapping.value.find((item) => item.source === resolved.value) : undefined;
                if (editorFile) newEditorFiles.push({ source: text.value.url, localPath: editorFile.localPath });
                const existing = before.value.find((item) => item.id === identity.value);
                const json = serializeQuiz(quiz.value);
                const saved = await db.value.replacePackage({ id: identity.value, source: text.value.url, json, revision: json, updatedAt: Date.now() }, existing ? some(existing.revision) : none);
                if (!saved.ok) { errors.push(path); continue; }
                selected.push(...prepareQuiz(quiz.value, identity.value, json).candidates.map((candidate) => candidate.patternId));
            }
            if (generation !== this.loadingGeneration) return none;
            const entrySources = entry.value.files.flatMap((path) => { const resolved = resolveHttpUrl(path, fetched.value.url); return resolved.ok ? [resolved.value] : []; });
            const savedEditorFiles = await db.value.setSetting({ id: 'editorFiles', value: JSON.stringify([...this.state.data.editorFiles.filter((item) => !entrySources.includes(item.source)), ...newEditorFiles]) });
            if (!savedEditorFiles.ok) { this.inform(savedEditorFiles.error.message); return none; }
            await this.refreshData();
            if (generation !== this.loadingGeneration) return none;
            if (this.state.kind === 'ready' && (intent === 'manual' || (intent === 'refresh' && !this.state.selected.length)) && (selected.length > 0 || errors.length === 0)) this.state = { ...this.state, selected: [...new Set(selected)] };
            if (intent === 'manual' && (selected.length > 0 || errors.length === 0)) {
                this.sharedInputError = none;
                const shared = new URL(location.href);
                if (this.published.kind === 'some') shared.pathname = new URL(this.published.value.base).pathname;
                shared.searchParams.set('entry', url.value); shared.searchParams.delete('entries'); shared.searchParams.delete('scope'); history.replaceState(null, '', shared);
            }
            this.inform(errors.length ? `${errors.length}ファイルを取得・検証できなかった。以前の有効版は保持している。` : `${plainText(entry.value.label)} を読み込んだ。`);
            return selected.length > 0 || errors.length === 0 ? some([...new Set(selected)]) : none;
        } finally { if (generation === this.loadingGeneration) { this.busy = false; this.render(); } }
    }

    private applyAppearance(preferences: Preferences): void {
        document.documentElement.dataset['theme'] = preferences.theme;
        document.documentElement.dataset['font'] = preferences.font;
        document.documentElement.style.setProperty('--text-scale', String(preferences.scale));
        this.syncThemeControls();
    }

    private syncThemeControls(): void {
        const theme = document.documentElement.dataset['theme'];
        const current = theme === 'black' ? 'ブラック' : theme === 'dark' ? 'ダーク' : 'ライト';
        const dark = theme === 'dark' || theme === 'black';
        this.themeLabel.textContent = `配色: ${current}`;
        this.themeToggle.textContent = 'ダークテーマ';
        this.themeToggle.setAttribute('aria-pressed', String(dark));
        this.themeToggle.title = `現在: ${current}。${dark ? 'ライト' : 'ダーク'}に切り替える。`;
        this.themeToggle.disabled = this.state.kind === 'loading' || this.replacingPreferences;
        for (const label of this.view.querySelectorAll('[data-theme-current]')) label.textContent = `現在: ${current}`;
        for (const control of this.view.querySelectorAll('[data-theme-cycle]')) {
            control.setAttribute('title', `現在: ${current}。${theme === 'dark' ? 'ブラック' : theme === 'black' ? 'ライト' : 'ダーク'}に切り替える。`);
            if (control instanceof HTMLButtonElement) control.disabled = this.replacingPreferences;
        }
    }

    private toggleTheme(): Promise<void> | void {
        if (this.replacingPreferences) return;
        const current = this.state.kind === 'ready' ? this.state.preferences.theme : document.documentElement.dataset['theme'];
        const theme = current === 'dark' || current === 'black' ? 'light' : 'dark';
        if (this.state.kind !== 'ready') {
            this.applyAppearance({ ...DEFAULTS, theme }); this.inform('画面の配色を変更した。保存領域へ接続できないため設定は保存していない。'); return;
        }
        return this.savePreferences({ ...this.state.preferences, theme }, 'appearance');
    }

    private async savePreferences(preferences: Preferences, effect: 'render' | 'appearance' = 'render'): Promise<void> {
        if (this.state.kind !== 'ready' || this.replacingPreferences) return;
        this.state = { ...this.state, preferences };
        if (effect === 'appearance') this.applyAppearance(preferences); else this.render();
        const db = this.database(); if (db.kind === 'none') return;
        const generation = this.startGeneration;
        const current = (): boolean => generation === this.startGeneration && this.storage.kind === 'some' && this.storage.value === db.value;
        const save = async (): Promise<void> => {
            if (!current()) return;
            const saved = await db.value.setSetting({ id: 'preferences', value: JSON.stringify(preferences) });
            if (!current()) return;
            if (!saved.ok) this.inform(effect === 'appearance' ? `画面の配色は変更したが、設定を保存できない: ${saved.error.message} 再読み込み前に配色を選び直して再試行できる。` : saved.error.message);
            else if (this.state.kind === 'ready' && this.state.preferences === preferences && this.notice.startsWith('画面の配色は変更したが、設定を保存できない:')) this.inform('配色を保存した。');
        };
        const pending = this.preferencesQueue.then(save);
        this.preferencesQueue = pending.catch(() => undefined);
        await pending;
    }

    /** 全設定writeを終えてからrestore/resetし、置換中の新しい設定操作を受け付けない。 */
    private async replacePreferences(db: QuizStorage, operation: () => Promise<void>): Promise<void> {
        if (this.replacingPreferences || this.busy) return;
        const generation = this.startGeneration;
        this.replacingPreferences = true; this.view.inert = true; this.syncThemeControls();
        try {
            await this.preferencesQueue;
            if (generation !== this.startGeneration || this.storage.kind === 'none' || this.storage.value !== db) return;
            await operation();
        } finally {
            if (generation === this.startGeneration) { this.replacingPreferences = false; this.view.inert = false; this.syncThemeControls(); }
        }
    }

    private render(): void {
        this.message.textContent = this.notice;
        this.syncThemeControls();
        if (this.state.kind === 'loading') {
            this.view.replaceChildren(element('p', '保存領域を準備中…'), this.button('起動をやり直す', () => this.start())); return;
        }
        if (this.state.kind === 'error') {
            const recovery = element('section');
            recovery.append(element('h1', '起動できない'), element('p', this.state.message), element('p', '保存データを削除せずに再試行できる。失敗が続く場合はページを再読み込みする。'), this.button('再試行', () => this.start()));
            const db = this.storage;
            if (db.kind === 'some') {
                const generation = this.startGeneration;
                const backup = this.button('保存済みデータをバックアップ', async () => {
                    backup.disabled = true;
                    try {
                        const result = await db.value.exportBackup();
                        if (generation !== this.startGeneration || this.state.kind !== 'error') return;
                        if (!result.ok) { this.inform(`バックアップを作成できない: ${result.error.message} 保存データは削除していない。再試行または再読み込みできる。`); return; }
                        const text = JSON.stringify(result.value, null, 2);
                        if (new TextEncoder().encode(text).byteLength > BACKUP_MAX_BYTES) { this.inform('バックアップが50MBの上限を超えているため退避できない。保存データは削除していない。'); return; }
                        this.download(text, 'quiz-recovery-backup.json'); this.inform('保存済みデータの退避用バックアップを作成した。');
                    } catch (error) {
                        if (generation === this.startGeneration && this.state.kind === 'error') this.inform(`バックアップを作成できない: ${error instanceof Error ? error.message : '予期しない保存エラー'} 保存データは削除していない。再試行または再読み込みできる。`);
                    } finally { backup.disabled = false; }
                });
                recovery.append(backup);
            } else recovery.append(element('p', '保存領域へ接続できないためバックアップを作成できない。保存データは削除していない。接続可能になってから再試行する。'));
            this.view.replaceChildren(recovery); return;
        }
        const state = this.state;
        this.headerUser.textContent = state.data.users.find(user => user.id === state.data.userId)?.name ?? 'Guest';
        this.applyAppearance(state.preferences);
        if (state.screen.kind === 'editor' && this.editor.kind === 'some') return;
        const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset['focusKey'] : '';
        this.renderGeneration += 1;
        this.view.replaceChildren();
        switch (state.screen.kind) {
            case 'menu': this.renderMenu(state); break;
            case 'playing': this.renderSession(state.screen.session, state.screen.idkPrompt); break;
            case 'result': this.renderResult(state.screen.session); break;
            case 'editor': break;
            case 'starting': this.view.append(element('p', 'クイズを準備中…')); break;
        }
        if (focused) {
            const target = this.view.querySelector(`[data-focus-key="${CSS.escape(focused)}"]`);
            if (target instanceof HTMLElement) target.focus({ preventScroll: true });
        }
        this.syncThemeControls();
    }

    private selectionShareUrl(selected: readonly PatternId[]): string {
        if (this.state.kind !== 'ready') return location.href;
        const published = this.published.kind === 'some' ? {
            pages: this.published.value,
            packages: this.state.data.packages.map(item => ({ source: item.record.source, patternIds: item.prepared.candidates.map(candidate => candidate.patternId) }))
        } : undefined;
        return shareUrl(location.href, selected, this.state.data.entries, published);
    }

    private async showShare(selected: readonly PatternId[]): Promise<void> {
        if (this.state.kind !== 'ready') return;
        const text = this.selectionShareUrl(selected);
        const dialog = element('dialog'); dialog.setAttribute('aria-label', '出題範囲を共有');
        const url = element('textarea'); url.readOnly = true; url.value = text; url.setAttribute('aria-label', '共有URL');
        const image = element('img'); image.alt = '共有URLのQRコード'; image.style.maxWidth = '100%';
        const status = element('p', 'QRを生成中…'); status.setAttribute('role', 'status');
        dialog.append(element('h2', '出題範囲を共有'), url, this.button('URLをコピー', async () => { await navigator.clipboard.writeText(text); status.textContent = '共有URLをコピーした。'; }), image, status, this.button('共有を閉じる', () => dialog.close()));
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        document.body.append(dialog); dialog.showModal();
        const qr = await shareQr(text);
        if (!dialog.isConnected) return;
        if (qr.ok) { image.src = qr.value; status.textContent = 'QRまたはURLで同じ出題範囲を開ける。ローカル草稿そのものは共有しない。'; }
        else { image.remove(); status.textContent = qr.error; }
    }

    private renderDraftImport(parent: HTMLElement): void {
        const section = element('details'); section.append(element('summary', 'JSONを新規草稿へ取り込む'));
        const path = element('input'); path.value = this.draftImportPath; path.setAttribute('aria-label', '取込先の新規草稿パス');
        path.addEventListener('input', () => { this.draftImportPath = path.value; });
        const input = element('textarea'); input.value = this.draftImportText; input.rows = 6; input.setAttribute('aria-label', '取り込むv3問題JSON');
        input.addEventListener('input', () => { this.draftImportText = input.value; });
        section.append(path, input, this.button('クリップボードを読み込む', async () => {
            const previous = input.value;
            try {
                const text = await navigator.clipboard.readText();
                if (!input.isConnected || input.value !== previous) { this.inform('読取待ちの間に入力が進んだため、入力内容を保持した。'); return; }
                input.value = text; this.draftImportText = text; this.inform('内容を確認して新規草稿へ保存できる。');
            }
            catch { section.open = true; input.focus(); this.inform('クリップボードを読み込めない。この欄へ貼り付けて保存できる。'); }
        }), this.button('新規草稿として保存', async () => {
            const db = this.database(); if (db.kind === 'none') return;
            const savedPath = path.value; const savedText = input.value;
            const imported = await importDraft(db.value, savedPath, savedText, Date.now());
            if (!imported.ok) { this.inform(imported.error); return; }
            if (this.draftImportText === savedText && this.draftImportPath === savedPath) { this.draftImportText = ''; this.draftImportPath = `imports/quiz-${crypto.randomUUID()}.json`; }
            await this.refreshData(); this.inform(`${imported.value.id} を新規草稿として保存した。`);
        })); parent.append(section);
    }

    private sourceInfo(question: Question, row: Row): SourceInfo {
        const loaded = this.state.kind === 'ready' ? this.state.data.packages.find((entry) => entry.record.id === question.packageId) : undefined;
        const rowIndex = loaded?.quiz.table.findIndex((entry) => entry.id === row.id) ?? -1;
        return { source: loaded?.record.source ?? question.packageId, packageId: question.packageId, questionId: question.id,
            rowId: row.id, patternId: question.pattern.id, jsonPath: rowIndex >= 0 ? `$.table[${rowIndex}]` : '$.table' };
    }

    private textTools(regions: readonly SourceRegion[], sessionId: string): HTMLElement {
        return sourceControls(regions, this.state.kind === 'ready' ? this.state.data.editorFiles : [], (item) => {
            if (this.rubyState.sessionId !== sessionId) return;
            this.rubyState = { sessionId, items: addRubyItem(this.rubyState.items, item) };
            const buffer = this.view.querySelector('textarea[data-ruby-buffer]');
            if (buffer instanceof HTMLTextAreaElement) buffer.value = JSON.stringify(this.rubyState.items, null, 2);
            this.inform(`${item.base} (${item.reading}) を収集した。Ruby Buffer: ${this.rubyState.items.length}件`);
        }, async (source) => { await navigator.clipboard.writeText(JSON.stringify(source, null, 2)); this.inform('出典情報をコピーした。'); });
    }

    private renderMenu(state: ReadyState): void {
        const layout = element('main', '', 'menu-layout');
        const scope = element('section', '', 'panel'); scope.append(element('h2', '出題範囲'));
        if (this.sharedInputError.kind === 'some') { const notice = element('p', this.sharedInputError.value, 'warning'); notice.setAttribute('role', 'alert'); scope.append(notice); }
        scope.append(this.button('すべて選択', () => {
            if (this.state.kind === 'ready') { this.state = { ...this.state, selected: [...new Set(this.state.data.packages.flatMap((item) => item.prepared.candidates.map((candidate) => candidate.patternId)))] }; this.render(); }
        }, this.busy));
        scope.append(this.button('選択を解除', () => { if (this.state.kind === 'ready') { this.state = { ...this.state, selected: [] }; this.render(); } }, this.busy));
        const folders = new Map<string, PatternId[]>();
        for (const loaded of state.data.packages) for (const folder of folderKeys(loaded.record.source)) folders.set(folder, [...new Set([...(folders.get(folder) ?? []), ...loaded.prepared.candidates.map((candidate) => candidate.patternId)])]);
        if (folders.size) {
            const groups = element('details'); groups.append(element('summary', 'フォルダから範囲を選択'));
            for (const [folder, ids] of folders) {
                const item = element('p', folder);
                item.append(this.button('このフォルダを選択', () => { if (this.state.kind === 'ready') { this.state = { ...this.state, selected: ids }; this.render(); } }, this.busy), this.button('このフォルダを共有', () => this.showShare(ids), this.busy || ids.length === 0)); groups.append(item);
            }
            scope.append(groups);
        }
        for (const loaded of state.data.packages) {
            const card = element('fieldset', '', 'quiz-card');
            const legend = element('legend'); legend.append(richText(loaded.quiz.title)); card.append(legend);
            const description = element('p'); description.append(richText(loaded.quiz.description)); card.append(description);
            card.append(element('small', `${loaded.prepared.capacity}問 / ${loaded.record.source}`));
            card.append(this.button('この題庫を選択', () => { if (this.state.kind === 'ready') { this.state = { ...this.state, selected: [...new Set(loaded.prepared.candidates.map((candidate) => candidate.patternId))] }; this.render(); } }, this.busy));
            for (const pattern of loaded.quiz.patterns) {
                const candidates = loaded.prepared.candidates.filter((candidate) => candidate.pattern.id === pattern.id);
                const identity = candidates.at(0)?.patternId;
                const label = element('label', '', 'pattern-choice');
                const input = element('input'); input.type = 'checkbox'; input.checked = identity !== undefined && state.selected.includes(identity); input.disabled = this.busy || !identity;
                input.dataset['focusKey'] = `${loaded.record.id}:${pattern.id}`;
                input.addEventListener('change', () => {
                    if (this.state.kind !== 'ready' || !identity) return;
                    this.state = { ...this.state, selected: input.checked ? [...new Set([...this.state.selected, identity])] : this.state.selected.filter((id) => id !== identity) };
                    this.render();
                });
                label.append(input, richText(pattern.label), element('span', ` ${candidates.length}問`)); card.append(label);
            }
            if (loaded.prepared.unavailable.length) card.append(element('p', `${loaded.prepared.unavailable.length}件は正答または誤選択肢が不足している。`, 'warning'));
            scope.append(card);
        }
        if (!state.data.packages.length) scope.append(element('p', '題庫がない。entryを追加するか、草稿を作成できる。'));
        const controls = element('section', '', 'panel'); controls.append(element('h2', '出題設定'));
        const mode = element('select'); mode.setAttribute('aria-label', '学習・テスト');
        for (const [value, label] of [['study', '学習'], ['test', 'テスト']]) { const option = element('option', label); option.value = value ?? ''; option.selected = state.preferences.mode === value; mode.append(option); }
        mode.addEventListener('change', () => this.run(() => {
            if (this.state.kind !== 'ready') return;
            const preferences = this.state.preferences;
            return this.savePreferences({ ...preferences, mode: mode.value === 'test' ? 'test' : 'study', completion: mode.value === 'test' && preferences.completion === 'drain' ? 'questions' : preferences.completion });
        }));
        const completion = element('select'); completion.setAttribute('aria-label', '終了条件');
        for (const [value, text] of [['questions', '問題数指定'], ['time', '時間指定'], ['drain', '復習ゼロまで']]) {
            if (value === 'drain' && state.preferences.mode === 'test') continue;
            const option = element('option', text); option.value = value ?? ''; option.selected = state.preferences.completion === value; completion.append(option);
        }
        completion.addEventListener('change', () => this.run(() => {
            if (this.state.kind !== 'ready') return;
            return this.savePreferences({ ...this.state.preferences, completion: completion.value === 'time' ? 'time' : completion.value === 'drain' ? 'drain' : 'questions' });
        }));
        const count = element('input'); count.type = 'number'; count.min = '1'; count.max = '1000'; count.value = String(state.preferences.count); count.setAttribute('aria-label', '問題数'); count.disabled = state.preferences.completion !== 'questions';
        const minutes = element('input'); minutes.type = 'number'; minutes.min = '1'; minutes.max = '180'; minutes.value = String(state.preferences.minutes); minutes.setAttribute('aria-label', '制限時間（分）'); minutes.disabled = state.preferences.completion !== 'time';
        count.addEventListener('input', () => {
            const value = Number(count.value);
            if (this.state.kind === 'ready' && Number.isInteger(value) && value > 0 && value <= 1000) this.state = { ...this.state, preferences: { ...this.state.preferences, count: value } };
        });
        minutes.addEventListener('input', () => {
            const value = Number(minutes.value);
            if (this.state.kind === 'ready' && Number.isFinite(value) && value >= 1 && value <= 180) this.state = { ...this.state, preferences: { ...this.state.preferences, minutes: value } };
        });
        controls.append(mode, completion, element('label', '問題数'), count, element('label', '制限時間（分）'), minutes);
        const capacity = state.data.packages.flatMap((item) => item.prepared.candidates).filter((candidate) => state.selected.includes(candidate.patternId)).length;
        controls.append(element('p', `選択範囲: ${capacity}問`));
        controls.append(this.button('クイズを開始', async () => {
            const questions = Number(count.value); const duration = Number(minutes.value);
            if (!Number.isInteger(questions) || questions < 1 || questions > 1000 || !Number.isFinite(duration) || duration < 1 || duration > 180) { this.inform('問題数と時間を有効な範囲で指定する。'); return; }
            if (this.state.kind !== 'ready') return;
            const preferences = { ...this.state.preferences, count: questions, minutes: duration };
            await this.savePreferences(preferences);
            await this.begin();
        }, this.busy || capacity === 0));
        controls.append(this.button('共有URLをコピー', async () => {
            await navigator.clipboard.writeText(this.selectionShareUrl(state.selected)); this.inform('共有URLをコピーした。');
        }, capacity === 0));
        controls.append(this.button('共有URL・QRを表示', () => this.showShare(state.selected), capacity === 0));
        controls.append(this.button('草稿を編集', () => this.openEditor(), this.busy));
        this.renderDraftImport(controls);
        this.renderPreferences(controls, state);
        this.renderStorage(controls);
        layout.append(scope, controls); this.view.append(layout);
    }

    private renderPreferences(parent: HTMLElement, state: ReadyState): void {
        const settings = element('details'); settings.append(element('summary', 'ユーザー・表示・問題一覧'));
        const users = element('select'); users.setAttribute('aria-label', 'ユーザー');
        for (const user of state.data.users) { const option = element('option', user.name); option.value = user.id; option.selected = user.id === state.data.userId; users.append(option); }
        users.addEventListener('change', () => this.run(async () => {
            const db = this.database(); if (db.kind === 'none') return;
            const saved = await db.value.setSetting({ id: 'activeUserId', value: users.value }); if (!saved.ok) { this.inform(saved.error.message); return; }
            await this.refreshData();
        }));
        const name = element('input'); name.placeholder = '新しいユーザー名'; name.setAttribute('aria-label', '新しいユーザー名');
        settings.append(users, name, this.button('ユーザーを追加', async () => {
            const db = this.database(); if (db.kind === 'none' || !name.value.trim()) return;
            const id = parseUserId(crypto.randomUUID()); if (!id.ok) { this.inform('ユーザーIDを作成できない。'); return; }
            const user = await db.value.createUser({ id: id.value, name: name.value.trim(), createdAt: Date.now() });
            if (!user.ok) { this.inform(user.error.message); return; }
            await db.value.setSetting({ id: 'activeUserId', value: user.value.id }); await this.refreshData();
        }));
        settings.append(this.button('選択ユーザーを削除', async () => {
            const db = this.database(); if (db.kind === 'none' || !confirm('選択したユーザーと学習履歴を削除する。よいか。')) return;
            const deleted = await db.value.deleteUser(state.data.userId); if (!deleted.ok) { this.inform(deleted.error.message); return; }
            await this.refreshData();
        }, state.data.users.length <= 1));
        const mine = state.data.attempts.filter((attempt) => attempt.userId === state.data.userId);
        settings.append(element('p', `回答履歴: ${mine.length}件 / 正答: ${mine.filter((attempt) => attempt.result === 'strong' || attempt.result === 'weak').length}件`));
        const themeCycle = this.button('配色を切替', () => {
            if (this.state.kind !== 'ready') return;
            const current = this.state.preferences;
            return this.savePreferences({ ...current, theme: current.theme === 'light' ? 'dark' : current.theme === 'dark' ? 'black' : 'light' }, 'appearance');
        });
        themeCycle.dataset['themeCycle'] = 'true';
        const themeCurrent = element('span'); themeCurrent.dataset['themeCurrent'] = 'true';
        settings.append(themeCycle, themeCurrent);
        settings.append(this.button('書体を切替', () => {
            if (this.state.kind !== 'ready') return;
            return this.savePreferences({ ...this.state.preferences, font: this.state.preferences.font === 'sans' ? 'serif' : 'sans' });
        }));
        for (const scale of [0.5, 0.65, 0.8, 1, 1.2, 1.4, 1.7]) settings.append(this.button(`文字 ${Math.round(scale * 100)}%`, () => {
            if (this.state.kind !== 'ready') return;
            return this.savePreferences({ ...this.state.preferences, scale });
        }));
        const url = element('input'); url.type = 'url'; url.placeholder = 'https://example.com/entry.json'; url.setAttribute('aria-label', '問題一覧のURL');
        settings.append(url, this.button('問題一覧を読み込む', async () => { await this.loadEntry(url.value, 'manual'); }, this.busy));
        for (const entry of state.data.entries) {
            const item = element('div'); item.append(element('small', entry));
            item.append(this.button('更新', async () => { await this.loadEntry(entry, 'refresh'); }, this.busy));
            item.append(this.button('登録解除', async () => {
                const db = this.database(); if (db.kind === 'none' || this.state.kind !== 'ready') return;
                const saved = await db.value.setSetting({ id: 'entrySources', value: JSON.stringify(this.state.data.entries.filter((value) => value !== entry)) });
                if (!saved.ok) { this.inform(saved.error.message); return; }
                await this.refreshData(); this.inform('問題一覧URLの登録を解除した。取得済み題庫は残している。');
            }, this.busy));
            settings.append(item);
        }
        settings.append(this.button('サンプルを再読込', async () => { await this.loadEntry(new URL('entry.json', document.baseURI).href, 'refresh'); }, this.busy));
        settings.append(this.button('offline cacheを削除して再起動', async () => {
            if (this.state.kind !== 'ready' || this.state.screen.kind !== 'menu' || this.busy) return;
            if (!confirm('このアプリのoffline cacheを削除して再起動する。IndexedDBの草稿・ユーザー・学習記録は保持する。再取得には通信が必要である。よいか。')) return;
            if (!('caches' in globalThis) || !('serviceWorker' in navigator)) { this.inform('この環境ではoffline cache操作を利用できない。'); return; }
            const result = await clearAppCache(new URL(import.meta.env.BASE_URL, location.origin).href, caches, navigator.serviceWorker);
            if (!result.ok) { this.inform(result.error); return; }
            location.reload();
        }, this.busy));
        parent.append(settings);
    }

    private renderStorage(parent: HTMLElement): void {
        const details = element('details'); details.append(element('summary', 'バックアップ・復元'));
        details.append(this.button('完全バックアップをダウンロード', async () => {
            const db = this.database(); if (db.kind === 'none') return;
            const snapshot = await db.value.exportBackup(); if (!snapshot.ok) { this.inform(snapshot.error.message); return; }
            const text = JSON.stringify(snapshot.value, null, 2);
            if (new TextEncoder().encode(text).byteLength > BACKUP_MAX_BYTES) { this.inform('完全バックアップが50MBの上限を超える。データを省略せずに出力するため、保存内容を整理して再試行する。'); return; }
            this.download(text, 'quiz-backup.json'); this.inform('草稿・ユーザー・履歴・設定・取得済みSVGを含むバックアップを作成した。');
        }));
        const file = element('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.setAttribute('aria-label', '復元するバックアップ');
        file.disabled = this.busy || this.replacingPreferences;
        file.addEventListener('change', () => this.run(async () => {
            if (this.busy || this.replacingPreferences) { this.inform('問題一覧の取得または保存データの置換が完了してから復元できる。'); return; }
            const selected = file.files?.item(0); const db = this.database();
            if (!selected || db.kind === 'none') return;
            if (selected.size > BACKUP_MAX_BYTES) { this.inform('バックアップの上限は50MBである。'); return; }
            let value: unknown;
            try { value = JSON.parse(await selected.text()); } catch { this.inform('バックアップJSONを解釈できない。'); return; }
            if (this.busy || this.replacingPreferences) { this.inform('問題一覧の取得または保存データの置換が完了してから復元できる。'); return; }
            if (!confirm('現在の新サイトの全保存データを、選択したバックアップで置き換える。よいか。')) return;
            await this.replacePreferences(db.value, async () => {
                const restored = await db.value.restoreBackup(value); if (!restored.ok) { this.inform(restored.error.message); return; }
                const preferences = await db.value.getSetting('preferences');
                if (this.state.kind === 'ready' && preferences.ok) this.state = { ...this.state, preferences: preferences.value.kind === 'some' ? preferencesFrom(preferences.value.value) : DEFAULTS };
                await this.refreshData(); this.inform('バックアップを復元した。別のタブは再読み込みが必要である。');
            });
        }));
        details.append(file, this.button('新サイトの全データを削除', async () => {
            if (this.busy || this.replacingPreferences) { this.inform('問題一覧の取得または保存データの置換が完了してから削除できる。'); return; }
            if (!confirm('草稿・ユーザー・履歴・設定をすべて削除する。よいか。')) return;
            const db = this.database(); if (db.kind === 'none') return;
            await this.replacePreferences(db.value, async () => {
                const cleared = await db.value.clearAll(); if (!cleared.ok) { this.inform(cleared.error.message); return; }
                if (this.state.kind === 'ready') this.state = { ...this.state, preferences: DEFAULTS, selected: [] };
                await this.refreshData(); this.inform('新サイトの全保存データを削除した。');
            });
        }, this.busy || this.replacingPreferences));
        if (this.updateState.kind === 'ready' && this.updateState.registration.waiting === this.updateState.worker) parent.append(this.button('新しいアプリ版を適用', () => this.applyUpdate()));
        else if (this.updateState.kind === 'failed') parent.append(this.button('オフライン・更新の準備を再試行', () => this.retryWorker()));
        else if (this.updateState.kind === 'reload') parent.append(this.button('新しい版でページを開き直す', () => this.applyUpdate()));
        parent.append(details);
    }

    private async begin(override: Option<readonly QuestionCandidate[]> = none): Promise<void> {
        if (this.state.kind !== 'ready' || (this.state.screen.kind !== 'menu' && this.state.screen.kind !== 'result')) return;
        const state = this.state; const db = this.database(); if (db.kind === 'none') return;
        const requestId = crypto.randomUUID();
        this.state = { ...state, screen: { kind: 'starting', requestId } }; this.render();
        let published = false;
        try {
        const candidates = override.kind === 'some' ? override.value : state.data.packages.flatMap((item) => item.prepared.candidates);
        const schedules = await db.value.listSchedule(); if (!schedules.ok) { this.inform(schedules.error.message); return; }
        const confusion = await db.value.listConfusion(); if (!confusion.ok) { this.inform(confusion.error.message); return; }
        const stats = await db.value.listConceptStats(); if (!stats.ok) { this.inform(stats.error.message); return; }
        const preferences = state.preferences;
        const completion: Completion = override.kind === 'some' ? { kind: 'questions', count: candidates.length } : preferences.completion === 'questions' ? { kind: 'questions', count: preferences.count } : preferences.completion === 'time' ? { kind: 'time', durationMs: preferences.minutes * 60_000 } : { kind: 'drain' };
        const sessionId = parseSessionId(crypto.randomUUID()); if (!sessionId.ok) { this.inform('セッションIDを作成できない。'); return; }
        const created = createSession({ id: sessionId.value, userId: state.data.userId, mode: preferences.mode, retry: override.kind === 'some',
            completion, candidates, allowedPatternIds: override.kind === 'some' ? [...new Set(candidates.map((candidate) => candidate.patternId))] : state.selected,
            seed: crypto.randomUUID(), now: Date.now(), schedules: schedules.value,
            confusions: confusion.value.filter((item) => item.userId === state.data.userId).map((item) => ({ conceptId: item.conceptId, wrongConceptId: item.wrongConceptId, score: (item.chosen + item.idkNear * 0.25 + 1) / (item.shown + 4) })), conceptStats: stats.value });
        if (!created.ok) { this.inform(`出題設定が不正: ${created.error.kind}`); return; }
        const started = await db.value.startSession(created.value.record); if (!started.ok) { this.inform(started.error.message); return; }
        if (this.state.kind !== 'ready' || this.state.screen.kind !== 'starting' || this.state.screen.requestId !== requestId) return;
        this.rubyState = { sessionId: created.value.record.id, items: [] };
        this.state = { ...this.state, screen: { kind: 'playing', session: created.value, idkPrompt: false } };
        published = true;
        await this.advance();
        } finally {
            if (!published && this.state.kind === 'ready' && this.state.screen.kind === 'starting' && this.state.screen.requestId === requestId) {
                this.state = { ...this.state, screen: { kind: 'menu' } }; this.render();
            }
        }
    }

    private async advance(): Promise<void> {
        if (this.state.kind !== 'ready' || this.state.screen.kind !== 'playing') return;
        const session = nextQuestion(this.state.screen.session, Date.now());
        if (!session.ok) { this.inform(`次の問題へ進めない: ${session.error.kind}`); return; }
        this.state = { ...this.state, screen: { kind: 'playing', session: session.value, idkPrompt: false } };
        if (session.value.phase.kind === 'finished') await this.complete(session.value);
        else this.render();
    }

    private async select(selection: Selection): Promise<void> {
        if (this.state.kind !== 'ready' || this.state.screen.kind !== 'playing') return;
        const previous = this.state.screen.session;
        const answered = answerSession(previous, { operationId: crypto.randomUUID(), selection, now: Date.now() });
        if (!answered.ok) return;
        this.state = { ...this.state, screen: { kind: 'playing', session: answered.value, idkPrompt: false } }; this.render();
        await this.commit();
    }

    private async commit(): Promise<void> {
        if (this.state.kind !== 'ready' || this.state.screen.kind !== 'playing' || this.state.screen.session.phase.kind !== 'saving') return;
        const session = this.state.screen.session; if (session.phase.kind !== 'saving') return;
        const db = this.database(); if (db.kind === 'none') return;
        const operation = session.phase.commit;
        const saved = await db.value.commitAnswer(operation);
        if (!saved.ok) { this.inform(`回答をまだ保存できていない: ${saved.error.message} 同じ回答を再送できる。`); this.render(); return; }
        if (this.state.kind !== 'ready' || this.state.screen.kind !== 'playing' || this.state.screen.session.config.id !== session.config.id) return;
        const confirmed = confirmAnswer(this.state.screen.session, operation.attempt.id); if (!confirmed.ok) return;
        this.state = { ...this.state, screen: { kind: 'playing', session: confirmed.value, idkPrompt: false } };
        this.inform('回答を保存した。'); this.render();
    }

    private async complete(session: SessionState): Promise<void> {
        const db = this.database(); if (db.kind === 'none' || session.phase.kind !== 'finished') return;
        if (this.state.kind === 'ready' && this.state.screen.kind === 'playing' && this.state.screen.session.config.id === session.config.id) {
            this.state = { ...this.state, screen: { kind: 'playing', session, idkPrompt: false } }; this.render();
        }
        const saved = await db.value.finishSession(session.record.id, session.phase.summary, session.record.endedAt.kind === 'some' ? session.record.endedAt.value : Date.now());
        if (!saved.ok) { this.inform(saved.error.message); return; }
        if (this.state.kind !== 'ready' || this.state.screen.kind !== 'playing' || this.state.screen.session.config.id !== session.config.id || this.state.screen.session.phase.kind !== 'finished') return;
        this.state = { ...this.state, screen: { kind: 'result', session } };
        this.render();
    }

    private context(session: SessionState, generation: number, answer = false) {
        const question = session.phase.kind === 'question' || session.phase.kind === 'saving' || session.phase.kind === 'answered' ? some(session.phase.question) : none;
        const baseUrl = question.kind === 'some' && this.state.kind === 'ready' ? this.state.data.packages.find((item) => item.record.id === question.value.packageId)?.record.source ?? document.baseURI : document.baseURI;
        const correct = question.kind === 'some' ? question.value.options.find((option) => option.id === question.value.correctOptionId) : undefined;
        return { baseUrl: /^https?:/i.test(baseUrl) ? baseUrl : document.baseURI,
            ...(this.storage.kind === 'some' ? { assets: this.storage.value } : {}),
            answer: answer && correct ? some({ tokens: correct.tokens, row: correct.row }) : none,
            isCurrent: () => generation === this.renderGeneration };
    }

    private renderSession(session: SessionState, idkPrompt: boolean): void {
        const panel = element('main', '', 'panel quiz-panel');
        const summary = sessionSummary(session, Date.now());
        panel.append(element('p', `${summary.answered}問回答 / ${summary.correct}問正答`));
        const timer = element('p', '', 'timer'); timer.dataset['timer'] = 'session'; panel.append(timer);
        const phase = session.phase;
        switch (phase.kind) {
            case 'question': case 'saving': case 'answered': {
                const title = element('h2'); title.append(richText(phase.question.title));
                panel.append(element('p', phase.stage), title);
                const context = this.context(session, this.renderGeneration, phase.kind === 'answered');
                const stem = element('div', '', 'question-text'); stem.append(renderTokens(phase.question.pattern.tokens, phase.question.row, context)); panel.append(stem);
                const regions: SourceRegion[] = [{ root: stem, source: this.sourceInfo(phase.question, phase.question.row) }];
                const choices = element('div', '', 'choices');
                for (const [index, option] of phase.question.options.entries()) {
                    const choice = this.button('', async () => {
                        if (phase.kind === 'answered' && option.isCorrect) await this.advance();
                        else if (idkPrompt) await this.select({ kind: 'idk', nearestOptionId: some(option.id) });
                        else await this.select({ kind: 'option', optionId: option.id });
                    }, phase.kind === 'saving');
                    choice.append(element('span', `${index + 1}. `), renderTokens(option.tokens, option.row, { ...context, answer: none }));
                    regions.push({ root: choice, source: this.sourceInfo(phase.question, option.row) });
                    choice.className = 'choice';
                    if (phase.kind === 'answered') { choice.classList.add(option.isCorrect ? 'correct' : 'review'); choice.setAttribute('aria-label', `${index + 1}. ${option.text} ${option.isCorrect ? '正答' : ''}`); }
                    choices.append(choice);
                }
                panel.append(choices);
                if (phase.kind === 'question') {
                    if (idkPrompt) { panel.append(element('p', '最も近いと思う選択肢を任意で選べる。正誤判定には影響しない。'), this.button('近い選択肢を選ばずスキップ', () => this.select({ kind: 'idk', nearestOptionId: none }))); }
                    else panel.append(this.button('分からない', () => { if (this.state.kind === 'ready' && this.state.screen.kind === 'playing') { this.state = { ...this.state, screen: { ...this.state.screen, idkPrompt: true } }; this.render(); } }));
                }
                if (phase.kind === 'saving') panel.append(element('p', '回答を保存中…'), this.button('保存を再試行', () => this.commit()));
                if (phase.kind === 'answered') {
                    panel.append(element('p', phase.attempt.result === 'strong' || phase.attempt.result === 'weak' ? '正解' : phase.attempt.result === 'idk' ? '分からないとして記録した' : phase.attempt.result === 'timeout' ? '時間切れ' : '不正解', 'feedback'));
                    for (const tip of phase.question.pattern.tips) {
                        const correct = phase.attempt.result === 'strong' || phase.attempt.result === 'weak';
                        if (tip.when === 'after_answer' || (tip.when === 'after_correct' && correct) || (tip.when === 'after_incorrect' && !correct)) {
                            const tipRoot = renderTokens(tip.tokens, phase.question.row, context); panel.append(tipRoot);
                            regions.push({ root: tipRoot, source: this.sourceInfo(phase.question, phase.question.row) });
                        }
                    }
                    panel.append(this.button('次の問題', () => this.advance()));
                }
                panel.append(this.textTools(regions, session.record.id));
                break;
            }
            case 'waiting': panel.append(element('h2', '次の復習を待っている'), element('p', `${new Date(phase.dueAt).toLocaleTimeString()} に再開する。`), this.button('確認', () => this.advance())); break;
            case 'ready': panel.append(this.button('次の問題', () => this.advance())); break;
            case 'finished': panel.append(element('p', '結果を保存中…'), this.button('結果の保存を再試行', () => this.complete(session))); break;
        }
        panel.append(this.button('中断して結果を見る', async () => {
            if (this.state.kind !== 'ready' || this.state.screen.kind !== 'playing') return;
            const ended = finishSession(this.state.screen.session, Date.now());
            if (!ended.ok) return;
            await this.complete(ended.value);
        }, phase.kind === 'saving'));
        this.view.append(panel);
    }

    private renderResult(session: SessionState): void {
        const summary = sessionSummary(session, session.record.endedAt.kind === 'some' ? session.record.endedAt.value : Date.now());
        const panel = element('main', '', 'panel'); panel.append(element('h2', '結果'));
        const known = summary.answered - summary.idk;
        panel.append(element('p', `正答 ${summary.correct} / 回答 ${summary.answered}、全体正答率 ${summary.answered ? Math.round(summary.correct / summary.answered * 100) : 0}%、既知正答率 ${known ? Math.round(summary.correct / known * 100) : 0}%、IDK ${summary.idk}件`));
        if (session.phase.kind === 'finished') panel.append(element('p', `終了理由: ${session.phase.reason}`));
        panel.append(this.button('同じ設定で再挑戦', () => this.begin()), this.button('間違えた問題を再挑戦', () => this.begin(some(retryCandidates(session))), retryCandidates(session).length === 0));
        panel.append(this.button('結果JSONをコピー', async () => {
            const history = session.history.map((entry) => {
                const { revision: _revision, ...question } = entry.question;
                void _revision; // revision原文はreplayに一度だけ格納する。
                return { ...entry, question };
            });
            await navigator.clipboard.writeText(JSON.stringify({ summary, seed: session.config.seed, replay: session.record.replay, history, rubyBuffer: this.rubyState.sessionId === session.record.id ? this.rubyState.items : [] }, null, 2)); this.inform('結果をコピーした。');
        }));
        panel.append(this.button('メニューへ', async () => { if (this.state.kind === 'ready') this.state = { ...this.state, screen: { kind: 'menu' } }; await this.refreshData(); }));
        const list = element('ol');
        for (const entry of session.history) {
            const item = element('li', '', 'result-item');
            item.append(element('p', entry.attempt.result));
            const source = this.state.kind === 'ready' ? this.state.data.packages.find((loaded) => loaded.record.id === entry.question.packageId)?.record.source ?? document.baseURI : document.baseURI;
            const correct = entry.question.options.find((option) => option.id === entry.question.correctOptionId);
            const generation = this.renderGeneration;
            const context = { baseUrl: /^https?:/i.test(source) ? source : document.baseURI, ...(this.storage.kind === 'some' ? { assets: this.storage.value } : {}), answer: correct ? some({ tokens: correct.tokens, row: correct.row }) : none, isCurrent: () => generation === this.renderGeneration };
            const stem = renderTokens(entry.question.pattern.tokens, entry.question.row, context); item.append(stem);
            const regions: SourceRegion[] = [{ root: stem, source: this.sourceInfo(entry.question, entry.question.row) }];
            if (entry.selection.kind === 'option') {
                const id = entry.selection.optionId;
                const selected = entry.question.options.find((option) => option.id === id);
                if (selected) { item.append(element('p', '選んだ解答:')); const root = renderTokens(selected.tokens, selected.row, { ...context, answer: none }); item.append(root); regions.push({ root, source: this.sourceInfo(entry.question, selected.row) }); }
            }
            item.append(this.textTools(regions, session.record.id));
            list.append(item);
        }
        panel.append(list);
        const buffer = element('details'); buffer.append(element('summary', '収集したRuby Buffer'));
        const json = element('textarea'); json.readOnly = true; json.rows = 6; json.setAttribute('aria-label', 'Ruby Buffer JSON');
        json.dataset['rubyBuffer'] = 'true';
        json.value = JSON.stringify(this.rubyState.sessionId === session.record.id ? this.rubyState.items : [], null, 2);
        buffer.append(json, this.button('Ruby Bufferをコピー', async () => { await navigator.clipboard.writeText(JSON.stringify(this.rubyState.sessionId === session.record.id ? this.rubyState.items : [], null, 2)); this.inform('Ruby Bufferをコピーした。'); }));
        panel.append(buffer); this.view.append(panel);
    }

    private async openEditor(): Promise<void> {
        if (this.state.kind !== 'ready' || this.state.screen.kind !== 'menu') return;
        const db = this.database(); if (db.kind === 'none') return;
        this.state = { ...this.state, screen: { kind: 'editor' } }; this.render();
        let module: typeof import('./editor.ts');
        try { module = await import('./editor.ts'); }
        catch { this.inform('編集器を読み込めない。保存済み草稿は保持されている。ページを再読み込みして新しい版を開いてから再試行する。'); this.state = { ...this.state, screen: { kind: 'menu' } }; this.render(); return; }
        const host = element('main', '', 'editor-host'); this.view.append(host);
        const controller = await module.mountDraftEditor(host, db.value, {
            onSaved: () => this.run(() => this.refreshData()),
            onClose: async () => {
                if (this.editor.kind === 'some') this.editor.value.dispose(); this.editor = none;
                if (this.state.kind === 'ready') this.state = { ...this.state, screen: { kind: 'menu' } };
                await this.refreshData();
            }
        });
        if (!controller.ok) { this.inform(controller.error.detail); if (this.state.kind === 'ready') this.state = { ...this.state, screen: { kind: 'menu' } }; this.render(); return; }
        this.editor = some(controller.value);
    }

    private async tick(): Promise<void> {
        if (this.state.kind !== 'ready' || this.state.screen.kind !== 'playing') return;
        const session = this.state.screen.session; const now = Date.now();
        const timer = this.view.querySelector('[data-timer="session"]');
        if (timer) timer.textContent = `${Math.floor((now - session.record.startedAt) / 1000)}秒`;
        const limit = session.config.completion;
        if (limit.kind === 'time' && now >= session.record.startedAt + limit.durationMs) {
            if (session.phase.kind === 'question') await this.select({ kind: 'timeout' });
            else if (session.phase.kind !== 'saving' && session.phase.kind !== 'finished') await this.advance();
        } else if (session.phase.kind === 'waiting' && now >= session.phase.dueAt) await this.advance();
    }

    private keyboard(event: KeyboardEvent): void {
        if (event.isComposing || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement ||
            ((event.key === 'Enter' || event.key === ' ') && (event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement)) ||
            (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
        if (this.state.kind !== 'ready' || this.state.screen.kind !== 'playing') return;
        const phase = this.state.screen.session.phase;
        if (phase.kind === 'question' && /^[1-4]$/.test(event.key)) {
            const option = phase.question.options.at(Number(event.key) - 1);
            if (option) { event.preventDefault(); this.run(() => this.select({ kind: 'option', optionId: option.id })); }
        } else if (phase.kind === 'answered' && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); this.run(() => this.advance()); }
    }

    private download(text: string, name: string): void {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
        const link = element('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    private setUpdateState(next: UpdateState, message = ''): void {
        const previous = this.updateState;
        const changed = previous.kind !== next.kind ||
            (previous.kind === 'ready' && next.kind === 'ready' && previous.worker !== next.worker);
        this.updateState = next;
        if (message) this.inform(message);
        if (changed && this.state.kind === 'ready' && this.state.screen.kind === 'menu') this.render();
    }
    private workerFailed(initial: boolean): void {
        this.setUpdateState({ kind: 'failed', initial }, initial ?
            'オフライン用の準備を完了できない。オンラインで利用できる。接続を確認して再試行できる。' :
            '新しい版の準備を完了できない。現在の版と保存データを保持している。接続を確認して再試行できる。');
    }
    private refreshWorkerState(registration: ServiceWorkerRegistration): void {
        const waiting = registration.waiting;
        // 初回installのinstalled→自動activateは、旧activeを持つ更新のwaitingと区別する。
        if (waiting && registration.active && waiting !== registration.active && waiting.state === 'installed') {
            const changed = this.updateState.kind !== 'ready' || this.updateState.worker !== waiting;
            this.setUpdateState({ kind: 'ready', registration, worker: waiting }, changed ? '新しい版の準備が完了した。学習・編集終了後に適用できる。' : '');
        } else if (registration.installing || (waiting && !registration.active) || registration.active?.state === 'activating') {
            this.setUpdateState({ kind: 'preparing' });
        } else if (this.updateState.kind === 'ready' || this.updateState.kind === 'preparing') {
            this.setUpdateState({ kind: 'idle' });
        }
    }
    private observeWorker(registration: ServiceWorkerRegistration): void {
        if (!this.observedRegistrations.has(registration)) {
            this.observedRegistrations.add(registration);
            registration.addEventListener('updatefound', () => this.observeWorker(registration));
        }
        const worker = registration.installing ?? registration.waiting;
        if (worker && !this.observedWorkers.has(worker)) {
            this.observedWorkers.add(worker);
            const initial = registration.active === null;
            let prepared = worker.state === 'installed' || worker.state === 'activating' || worker.state === 'activated';
            worker.addEventListener('statechange', () => {
                if (worker.state === 'installed' || worker.state === 'activating' || worker.state === 'activated') prepared = true;
                // redundantは候補の置換でも起きる。原因を断定せず、install完了前の不成立として伝える。
                if (worker.state === 'redundant' && !prepared && (!registration.installing || registration.installing === worker) && !registration.waiting) this.workerFailed(initial);
                else {
                    this.refreshWorkerState(registration);
                    if (worker.state === 'activated' && initial) this.inform('オフライン用の準備が完了した。');
                }
            });
        }
        this.refreshWorkerState(registration);
    }
    private async registerWorker(): Promise<void> {
        if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
        try {
            const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
            this.observeWorker(registration);
        } catch { this.workerFailed(navigator.serviceWorker.controller === null); }
    }
    private async checkUpdate(): Promise<void> {
        if (this.state.kind !== 'ready' || this.state.screen.kind !== 'menu' || import.meta.env.DEV) return;
        try {
            const response = await fetch(`${import.meta.env.BASE_URL}app-version.json`, { cache: 'no-store' });
            const value: unknown = await response.json();
            if (isObject(value) && typeof value['version'] === 'string' && value['version'] !== __APP_VERSION__) {
                const registration = await navigator.serviceWorker.getRegistration();
                if (!registration) { this.workerFailed(true); return; }
                this.observeWorker(registration);
                try { await registration.update(); }
                catch { this.workerFailed(registration.active === null); return; }
                this.observeWorker(registration);
                if (this.updateState.kind === 'idle') this.setUpdateState({ kind: 'reload' }, '配信された版とこのページの版が異なる。学習・編集を終了し、ページを開き直せる。');
            }
        } catch { /* offlineは通常動作。既存データを変更しない。 */ }
    }
    private async retryWorker(): Promise<void> {
        if (this.state.kind !== 'ready' || this.state.screen.kind !== 'menu' || this.isSaving() || (this.editor.kind === 'some' && this.editor.value.isDirty())) { this.inform('学習・編集を終了してから準備を再試行する。'); return; }
        const initial = this.updateState.kind === 'failed' ? this.updateState.initial : navigator.serviceWorker.controller === null;
        this.setUpdateState({ kind: 'preparing' }, 'オフライン・更新の準備を再試行している。');
        try {
            const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
            this.observeWorker(registration);
            if (!registration.installing && !registration.waiting) { await registration.update(); this.observeWorker(registration); }
            if (this.updateState.kind === 'idle') this.inform('オフライン・更新の準備を確認した。現在の版を引き続き利用できる。');
        } catch { this.workerFailed(initial); }
    }
    private applyUpdate(): void {
        if (this.state.kind !== 'ready' || this.state.screen.kind !== 'menu' || this.isSaving() || (this.editor.kind === 'some' && this.editor.value.isDirty())) { this.inform('学習・編集を終了してから更新する。'); return; }
        if (this.updateState.kind === 'reload') { location.reload(); return; }
        if (this.updateState.kind !== 'ready') return;
        const { registration, worker } = this.updateState;
        if (registration.waiting !== worker || worker.state !== 'installed') { this.refreshWorkerState(registration); return; }
        this.setUpdateState({ kind: 'preparing' });
        const reload = (): void => {
            // apply待ちの短い間に別の操作を始めた場合も、保存中・編集中の画面は破棄しない。
            if (this.state.kind === 'ready' && this.state.screen.kind === 'menu' && !this.isSaving() &&
                (this.editor.kind === 'none' || !this.editor.value.isDirty())) location.reload();
            else this.setUpdateState({ kind: 'reload' }, '新しい版が有効になった。学習・編集を終了してからページを開き直せる。');
        };
        navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
        try { worker.postMessage({ type: 'SKIP_WAITING' }); }
        catch { navigator.serviceWorker.removeEventListener('controllerchange', reload); this.workerFailed(false); }
    }
}
