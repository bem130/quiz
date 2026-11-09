import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, Route } from '@playwright/test';
import { validateBackup, isStoreRecord } from '../../src/web/storage/validation.ts';
import type { StoreRecord } from '../../src/web/storage/validation.ts';
import type { BackupSnapshot, StoreName } from '../../src/web/storage/types.ts';

declare global {
    interface Window {
        applicationTest: { copied: string; release: () => void; calls: number; attacked: boolean };
    }
}
const runtimeErrors = new WeakMap<Page, string[]>();

function tinyQuiz(): string {
    return JSON.stringify({
        version: 3, title: 'UI試験題庫', description: '画面から保存までを検証する',
        table: [{ id: 'a', prompt: '問題A', answer: '解答A' }, { id: 'b', prompt: '問題B', answer: '解答B' }],
        patterns: [{ id: 'p', label: 'テスト範囲', tokens: [{ type: 'key', field: 'prompt' }, ' → ',
            { type: 'hide', id: 'h', value: [{ type: 'key', field: 'answer' }], answer: { mode: 'choice_from_entities' } }] }]
    });
}

async function controlledEntry(target: Page | BrowserContext): Promise<void> {
    await target.route('**/quiz/entry.json', async (route: Route) => {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 3, label: '画面検証', files: ['./test-data/tiny.json'] }) });
    });
    await target.route('**/quiz/test-data/tiny.json', async (route: Route) => {
        await route.fulfill({ contentType: 'application/json', body: tinyQuiz() });
    });
}

async function open(page: Page, path = './'): Promise<void> {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: '出題範囲', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeEnabled();
}

async function details(page: Page, name: string): Promise<void> {
    const summary = page.locator('summary').filter({ hasText: name });
    const parent = summary.locator('..');
    if (await parent.getAttribute('open') === null) await summary.click();
}

async function backup(page: Page): Promise<BackupSnapshot> {
    await details(page, 'バックアップ・復元');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: '完全バックアップをダウンロード', exact: true }).click();
    const download = await downloaded;
    const path = await download.path();
    assert.ok(path);
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const validated = validateBackup(parsed);
    if (!validated.ok) assert.fail(validated.error.message);
    return validated.value;
}

async function records<K extends StoreName>(page: Page, name: K): Promise<ReadonlyArray<StoreRecord<K>>> {
    const raw: unknown = await page.evaluate((store) => new Promise<unknown>((resolve, reject) => {
        const opened = indexedDB.open('bem130-quiz-web-v1');
        opened.onerror = () => reject(new Error('検証対象DBを開けない。'));
        opened.onsuccess = () => {
            const database = opened.result;
            const transaction = database.transaction(store, 'readonly');
            const read = transaction.objectStore(store).getAll();
            read.onerror = () => { database.close(); reject(new Error('検証対象を読めない。')); };
            read.onsuccess = () => { const value: unknown = read.result; database.close(); resolve(value); };
        };
    }), name);
    assert.ok(Array.isArray(raw));
    const result: StoreRecord<K>[] = [];
    for (const entry of raw) {
        if (!isStoreRecord(name, entry)) assert.fail(`保存内容がschemaに一致しない: ${name}`);
        result.push(entry);
    }
    return result;
}

async function startTest(page: Page, count = 10): Promise<void> {
    await page.getByLabel('学習・テスト', { exact: true }).selectOption('test');
    await page.getByLabel('問題数', { exact: true }).fill(String(count));
    await page.getByRole('button', { name: 'クイズを開始', exact: true }).click();
    await expect(page.locator('.question-text')).toBeVisible();
}

async function idk(page: Page): Promise<void> {
    await page.getByRole('button', { name: '分からない', exact: true }).click();
    await page.getByRole('button', { name: '近い選択肢を選ばずスキップ', exact: true }).click();
    await expect(page.getByRole('button', { name: '次の問題', exact: true })).toBeVisible();
}

async function interceptStorage(page: Page, code: string): Promise<void> {
    await page.route('**/src/web/storage/database.ts*', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: `${await response.text()}\n${code}\n` });
    });
}

test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    runtimeErrors.set(page, errors);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
        window.applicationTest = { copied: '', release: () => {}, calls: 0, attacked: false };
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: (text: string): Promise<void> => { window.applicationTest.copied = text; return Promise.resolve(); } }
        });
    });
});
test.afterEach(({ page }) => { expect(runtimeErrors.get(page) ?? []).toEqual([]); });

test('clean起動のサンプルから範囲を絞り、少数題庫の枯渇・結果コピー・新規再挑戦を完了する', async ({ page }) => {
    await open(page);
    for (const file of ['math-v3.json', 'multi-answer-v3.json', 'svg-v3.json']) {
        await expect(page.locator('.quiz-card').filter({ hasText: file })).toHaveCount(1);
    }
    await page.getByRole('button', { name: '選択を解除', exact: true }).click();
    await page.locator('.quiz-card').filter({ hasText: 'math-v3.json' }).getByRole('checkbox').first().check();
    await startTest(page, 10);
    for (let index = 0; index < 4; index += 1) {
        await idk(page);
        await page.getByRole('button', { name: '次の問題', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: '結果', exact: true })).toBeVisible();
    await expect(page.getByText('終了理由: exhausted', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '結果JSONをコピー', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('結果をコピーした。');
    const copied: unknown = JSON.parse(await page.evaluate(() => window.applicationTest.copied));
    assert.ok(typeof copied === 'object' && copied !== null && 'summary' in copied && 'history' in copied);
    assert.ok(Array.isArray(copied.history));
    expect(copied.history).toHaveLength(4);
    const first = await records(page, 'attempts');
    expect(first).toHaveLength(4);
    expect(new Set(first.map((attempt) => attempt.questionId)).size).toBe(4);
    expect(new Set(first.map((attempt) => attempt.patternId)).size).toBe(1);
    expect(await records(page, 'schedule')).toHaveLength(0);
    await page.getByRole('button', { name: '間違えた問題を再挑戦', exact: true }).click();
    await expect(page.locator('.question-text')).toBeVisible();
    await idk(page);
    await page.getByRole('button', { name: '中断して結果を見る', exact: true }).click();
    await expect(page.getByRole('heading', { name: '結果', exact: true })).toBeVisible();
    const sessions = await records(page, 'sessions');
    expect(sessions).toHaveLength(2);
    expect(new Set(sessions.map((session) => session.id)).size).toBe(2);
    expect(sessions.every((session) => session.endedAt.kind === 'some')).toBe(true);
    expect(await records(page, 'attempts')).toHaveLength(5);
});

test('保存待ちの連打・キーボード・中断がQ1を次問へ混入させない', async ({ page }) => {
    await controlledEntry(page);
    await interceptStorage(page, `
const originalCommit = QuizStorage.prototype.commitAnswer;
const commitGate = new Promise(resolve => { window.applicationTest.release = resolve; });
QuizStorage.prototype.commitAnswer = async function(command) {
    window.applicationTest.calls += 1;
    await commitGate;
    return originalCommit.call(this, command);
};`);
    await open(page);
    await startTest(page, 2);
    const firstQuestion = await page.locator('.question-text').innerText();
    await page.locator('.choice').first().click();
    await expect(page.getByText('回答を保存中…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '中断して結果を見る', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '次の問題', exact: true })).toHaveCount(0);
    await page.keyboard.press('2'); await page.keyboard.press('Enter'); await page.keyboard.press('Space');
    await page.getByRole('button', { name: '中断して結果を見る', exact: true }).dispatchEvent('click');
    expect(await records(page, 'attempts')).toHaveLength(0);
    expect(await page.locator('.question-text').innerText()).toBe(firstQuestion);
    await page.evaluate(() => window.applicationTest.release());
    await expect(page.getByRole('button', { name: '次の問題', exact: true })).toBeVisible();
    const saved = await records(page, 'attempts');
    expect(saved).toHaveLength(1);
    await page.getByRole('button', { name: '次の問題', exact: true }).click();
    await expect(page.locator('.question-text')).not.toHaveText(firstQuestion);
    expect(await records(page, 'attempts')).toEqual(saved);
    expect(await page.evaluate(() => window.applicationTest.calls)).toBe(1);
});

test('開始ボタンの同時連打で複数sessionを作らない', async ({ page }) => {
    await controlledEntry(page); await open(page);
    await page.getByRole('button', { name: 'クイズを開始', exact: true }).evaluate((button) => {
        if (!(button instanceof HTMLButtonElement)) throw new Error('開始ボタンがない。');
        button.click(); button.click();
    });
    await expect(page.locator('.question-text')).toBeVisible();
    expect(await records(page, 'sessions')).toHaveLength(1);
});

test('回答保存失敗を同じ操作IDで再試行し、回答を重複計上しない', async ({ page }) => {
    await controlledEntry(page);
    await interceptStorage(page, `
const originalCommit = QuizStorage.prototype.commitAnswer;
QuizStorage.prototype.commitAnswer = async function(command) {
    window.applicationTest.calls += 1;
    if (window.applicationTest.calls === 1) return { ok: false, error: { kind: 'request', message: '保存失敗を注入' } };
    return originalCommit.call(this, command);
};`);
    await open(page); await startTest(page, 2);
    await page.locator('.choice').first().click();
    await expect(page.getByRole('status')).toContainText('回答をまだ保存できていない');
    expect(await records(page, 'attempts')).toHaveLength(0);
    await page.getByRole('button', { name: '保存を再試行', exact: true }).click();
    await expect(page.getByRole('button', { name: '次の問題', exact: true })).toBeVisible();
    expect(await records(page, 'attempts')).toHaveLength(1);
    expect(await records(page, 'schedule')).toHaveLength(0);
});

test('遅い旧結果の保存完了が再挑戦中の新sessionを上書きしない', async ({ page }) => {
    await controlledEntry(page);
    await interceptStorage(page, `
const originalFinish = QuizStorage.prototype.finishSession;
const finishGate = new Promise(resolve => { window.applicationTest.release = resolve; });
QuizStorage.prototype.finishSession = async function(...args) {
    const call = ++window.applicationTest.calls;
    const result = await originalFinish.apply(this, args);
    if (call === 1) await finishGate;
    return result;
};`);
    await open(page); await startTest(page, 2);
    await page.getByRole('button', { name: '中断して結果を見る', exact: true }).click();
    await page.getByRole('button', { name: '結果の保存を再試行', exact: true }).click();
    await expect(page.getByRole('heading', { name: '結果', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '同じ設定で再挑戦', exact: true }).click();
    await expect(page.locator('.question-text')).toBeVisible();
    await page.evaluate(() => window.applicationTest.release());
    await expect(page.locator('.question-text')).toBeVisible();
    await expect(page.getByRole('heading', { name: '結果', exact: true })).toHaveCount(0);
    expect(await records(page, 'sessions')).toHaveLength(2);
});

test('同名ユーザー再作成は新IDになり、完全backupをUIから復元できる', async ({ page }) => {
    await controlledEntry(page); await open(page);
    await details(page, 'ユーザー・表示・問題一覧');
    await page.getByLabel('新しいユーザー名', { exact: true }).fill('同名利用者');
    await page.getByRole('button', { name: 'ユーザーを追加', exact: true }).click();
    await details(page, 'ユーザー・表示・問題一覧');
    await expect(page.getByLabel('ユーザー', { exact: true }).locator('option:checked')).toHaveText('同名利用者');
    const oldId = await page.getByLabel('ユーザー', { exact: true }).inputValue();
    await startTest(page, 2); await idk(page);
    await page.getByRole('button', { name: '中断して結果を見る', exact: true }).click();
    await page.getByRole('button', { name: 'メニューへ', exact: true }).click();
    const original = await backup(page);
    await details(page, 'ユーザー・表示・問題一覧');
    page.once('dialog', async (dialog) => { await dialog.accept(); });
    await page.getByRole('button', { name: '選択ユーザーを削除', exact: true }).click();
    await expect(page.getByLabel('ユーザー', { exact: true }).locator('option:checked')).toHaveText('Guest');
    await details(page, 'ユーザー・表示・問題一覧');
    await page.getByLabel('新しいユーザー名', { exact: true }).fill('同名利用者');
    await page.getByRole('button', { name: 'ユーザーを追加', exact: true }).click();
    await details(page, 'ユーザー・表示・問題一覧');
    await expect(page.getByLabel('ユーザー', { exact: true }).locator('option:checked')).toHaveText('同名利用者');
    expect(await page.getByLabel('ユーザー', { exact: true }).inputValue()).not.toBe(oldId);
    expect(await records(page, 'attempts')).toHaveLength(0);
    await details(page, 'バックアップ・復元');
    page.once('dialog', async (dialog) => { await dialog.accept(); });
    await page.getByLabel('復元するバックアップ', { exact: true }).setInputFiles({ name: 'quiz-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) });
    await expect(page.getByRole('status')).toContainText('バックアップを復元した');
    expect(await backup(page)).toEqual(original);
});

test('保存領域初期化の失敗でも起動エラーと再試行操作を表示する', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(indexedDB, 'open', { configurable: true, value: () => { throw new DOMException('保存領域なし', 'SecurityError'); } });
    });
    await page.goto('./');
    await expect(page.getByRole('heading', { name: '起動できない', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '再試行', exact: true })).toBeVisible();
    await expect(page.getByText('保存領域を準備中…', { exact: true })).toHaveCount(0);
});

test('entry URLのpercentを保持し、外部entry共有をclean環境で再現できる', async ({ page, browser }) => {
    const external = 'https://entry.example.test/list.json?tag=100%&value=a%2Fb';
    const requests: string[] = [];
    const routeExternal = async (target: Page | BrowserContext): Promise<void> => {
        await target.route('https://entry.example.test/**', async (route) => {
            requests.push(route.request().url());
            await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
                body: new URL(route.request().url()).pathname === '/list.json' ? JSON.stringify({ version: 3, label: '外部問題', files: ['./tiny.json'] }) : tinyQuiz() });
        });
    };
    await routeExternal(page); await open(page);
    await details(page, 'ユーザー・表示・問題一覧');
    await page.getByLabel('問題一覧のURL', { exact: true }).fill(external);
    await page.getByRole('button', { name: '問題一覧を読み込む', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('外部問題 を読み込んだ');
    expect(requests).toContain(external);
    await page.getByRole('button', { name: '共有URLをコピー', exact: true }).click();
    const shared = await page.evaluate(() => window.applicationTest.copied);
    expect(new URL(shared).searchParams.get('entry')).toBe(external);
    const clean = await browser.newContext();
    try {
        await routeExternal(clean);
        const fresh = await clean.newPage();
        await open(fresh, shared);
        await expect(fresh.getByRole('checkbox', { name: /^テスト範囲/ })).toBeChecked();
        await expect(fresh.locator('.quiz-card').filter({ hasText: 'UI試験題庫' })).toHaveCount(1);
        await expect(fresh.locator('.quiz-card').filter({ hasText: 'math-v3.json' })).toHaveCount(1);
    } finally { await clean.close(); }
});

test('外部entryが失敗しても読み込み済み題庫を保持して出題できる', async ({ page }) => {
    await controlledEntry(page); await open(page);
    const before = await records(page, 'packages');
    await page.route('https://offline.example.test/**', async (route) => { await route.abort('failed'); });
    await details(page, 'ユーザー・表示・問題一覧');
    await page.getByLabel('問題一覧のURL', { exact: true }).fill('https://offline.example.test/entry.json');
    await page.getByRole('button', { name: '問題一覧を読み込む', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('保存済み題庫と草稿は引き続き利用できる');
    expect(await records(page, 'packages')).toEqual(before);
    await startTest(page, 2);
    await expect(page.locator('.choice')).toHaveCount(2);
});

test('listkeyとSVGの範囲を明示して出題し、選択肢のfile SVGも実表示する', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: '選択を解除', exact: true }).click();
    await page.locator('.quiz-card').filter({ hasText: 'multi-answer-v3.json' }).getByRole('checkbox').check();
    await startTest(page, 1); await idk(page);
    const saved = await records(page, 'attempts');
    expect(saved).toHaveLength(1);
    expect(saved.at(0)?.patternId).toContain('p_pick_one_from_set');
    await page.getByRole('button', { name: '次の問題', exact: true }).click();
    await page.getByRole('button', { name: 'メニューへ', exact: true }).click();
    await page.getByRole('button', { name: '選択を解除', exact: true }).click();
    await page.locator('.quiz-card').filter({ hasText: 'svg-v3.json' }).getByRole('checkbox', { name: /^名称から図形/ }).check();
    await startTest(page, 1);
    await expect(page.locator('.choices svg')).toHaveCount(3);
    await expect(page.locator('.choices').getByRole('img', { name: '円', exact: true })).toBeVisible();
    await expect(page.locator('.graphic-error')).toHaveCount(0);
});

test('数値入力を設定変更で失わず、狭幅・文字拡大・IME中のキーを処理する', async ({ page }) => {
    await controlledEntry(page); await page.setViewportSize({ width: 320, height: 640 }); await open(page);
    await page.getByLabel('問題数', { exact: true }).fill('2');
    await page.getByLabel('学習・テスト', { exact: true }).selectOption('test');
    await expect(page.getByLabel('問題数', { exact: true })).toHaveValue('2');
    await details(page, 'ユーザー・表示・問題一覧');
    await page.getByRole('button', { name: '文字 170%', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.getByRole('button', { name: 'クイズを開始', exact: true }).click();
    await expect(page.locator('.question-text')).toBeVisible();
    await page.evaluate(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true, isComposing: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true, repeat: true }));
    });
    expect(await records(page, 'attempts')).toHaveLength(0);
    await page.keyboard.press('1');
    await expect(page.getByRole('button', { name: '次の問題', exact: true })).toBeVisible();
    expect(await records(page, 'attempts')).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

async function startFigures(page: Page): Promise<void> {
    await page.getByRole('button', { name: '選択を解除', exact: true }).click();
    await page.locator('.quiz-card').filter({ hasText: 'svg-v3.json' }).getByRole('checkbox', { name: /^名称から図形/ }).check();
    await startTest(page, 1);
}

async function figureBackup(page: Page): Promise<BackupSnapshot> {
    await open(page); await startFigures(page);
    await expect(page.locator('.choices').getByRole('img', { name: '円', exact: true })).toBeVisible();
    await expect.poll(async () => (await records(page, 'assets')).some((asset) => asset.id.endsWith('/figures/circle.svg'))).toBe(true);
    await page.getByRole('button', { name: '中断して結果を見る', exact: true }).click();
    await page.getByRole('button', { name: 'メニューへ', exact: true }).click();
    return backup(page);
}

async function restoreFile(page: Page, value: unknown): Promise<void> {
    await details(page, 'バックアップ・復元');
    page.once('dialog', async (dialog) => { await dialog.accept(); });
    await page.getByLabel('復元するバックアップ', { exact: true }).setInputFiles({ name: 'quiz-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
    await expect(page.getByRole('status')).toContainText('バックアップを復元した');
}

test('SVG資産を完全backupへ含め、clean環境で復元すれば取得失敗時も図を表示できる', async ({ page, browser }) => {
    const original = await figureBackup(page);
    expect(original.records.assets.some((asset) => asset.id.endsWith('/figures/circle.svg'))).toBe(true);
    const freshContext = await browser.newContext();
    try {
        await freshContext.route('**/data/sample/figures/circle.svg', async (route) => { await route.abort('failed'); });
        const fresh = await freshContext.newPage();
        await open(fresh); await restoreFile(fresh, original);
        const failed = fresh.waitForEvent('requestfailed', { predicate: (request) => request.url().endsWith('/figures/circle.svg') });
        await startFigures(fresh);
        await failed;
        await expect(fresh.locator('.choices').getByRole('img', { name: '円', exact: true })).toBeVisible();
        await expect(fresh.locator('.graphic-error')).toHaveCount(0);
        expect(await records(fresh, 'assets')).toEqual(original.records.assets);
    } finally { await freshContext.close(); }
});

test('復元したSVG資産も描画時に再検証し、改変されたイベント属性を実行しない', async ({ page }) => {
    const original = await figureBackup(page);
    const corrupted = { ...original, records: { ...original.records, assets: original.records.assets.map((asset) => asset.id.endsWith('/figures/circle.svg') ? ({
        ...asset, text: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="window.applicationTest.attacked=true"><circle r="2"/></svg>'
    }) : asset) } };
    await page.route('**/data/sample/figures/circle.svg', async (route) => { await route.abort('failed'); });
    await restoreFile(page, corrupted); await startFigures(page);
    await expect(page.locator('.graphic-error').filter({ hasText: '円' })).toHaveCount(1);
    await expect(page.locator('.choices').getByRole('img', { name: '円', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.applicationTest.attacked)).toBe(false);
});

test('復元前に開始した遅いSVG取得は復元後の資産を上書きしない', async ({ page }) => {
    const original = await figureBackup(page);
    let release: () => void = () => { throw new Error('SVG応答のgateが未設定である。'); };
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let requested: () => void = () => { throw new Error('SVG要求のgateが未設定である。'); };
    const entered = new Promise<void>((resolve) => { requested = resolve; });
    await page.route('**/data/sample/figures/circle.svg', async (route) => {
        requested(); await gate;
        await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>' });
    });
    await startFigures(page); await entered;
    await page.getByRole('button', { name: '中断して結果を見る', exact: true }).click();
    await page.getByRole('button', { name: 'メニューへ', exact: true }).click();
    await restoreFile(page, original);
    const finished = page.waitForEvent('requestfinished', { predicate: (request) => request.url().endsWith('/figures/circle.svg') });
    release(); await finished;
    expect(await records(page, 'assets')).toEqual(original.records.assets);
});
