import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, Route } from '@playwright/test';

declare global { interface Window { toolsTest: { copied: string; releaseRead?: () => void } } }
function quiz(title: string): string {
    return JSON.stringify({ version: 3, title, description: '補助操作の検証', table: [{ id: 'a', prompt: '[日本語/にほんご]', answer: '解答A' }, { id: 'b', prompt: '[漢字/かんじ]', answer: '解答B' }],
        patterns: [{ id: 'p', tokens: [{ type: 'key', field: 'prompt' }, { type: 'hide', id: 'h', value: [{ type: 'key', field: 'answer' }], answer: { mode: 'choice_from_entities' } }] }] });
}
async function routes(target: Page | BrowserContext): Promise<void> {
    await target.route('**/quiz/entry.json', (route: Route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 3, label: 'ツール検証', editorBasePath: 'C:/quiz project', files: ['./tools-data/one/a.json', './tools-data/two/b.json'] }) }));
    await target.route('**/quiz/tools-data/**', (route: Route) => route.fulfill({ contentType: 'application/json', body: quiz(route.request().url().includes('/one/') ? 'ツール題庫A' : 'ツール題庫B') }));
}
async function open(page: Page): Promise<void> {
    await routes(page); await page.goto('./');
    await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeEnabled();
    await expect(page.getByText('選択範囲: 4問', { exact: true })).toBeVisible();
}
async function start(page: Page): Promise<void> {
    await page.getByLabel('学習・テスト', { exact: true }).selectOption('test');
    await page.getByLabel('問題数', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'クイズを開始', exact: true }).click();
    await expect(page.locator('.question-text')).toBeVisible();
}
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
    const messages: string[] = []; errors.set(page, messages); page.on('pageerror', (error) => messages.push(error.message));
    await page.addInitScript(() => {
        window.toolsTest = { copied: '' };
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: (text: string): Promise<void> => { window.toolsTest.copied = text; return Promise.resolve(); },
            readText: (): Promise<string> => Promise.reject(new Error('permission denied'))
        } });
    });
});
test.afterEach(({ page }) => { expect(errors.get(page) ?? []).toEqual([]); });

test('clipboard拒否でも貼付けで新規草稿を作り、同名の内容を上書きしない', async ({ page }) => {
    await open(page);
    await page.locator('summary').filter({ hasText: 'JSONを新規草稿へ取り込む' }).click();
    await page.getByRole('button', { name: 'クリップボードを読み込む', exact: true }).click();
    await expect(page.getByLabel('取り込むv3問題JSON')).toBeFocused();
    await page.getByLabel('取込先の新規草稿パス').fill('imports/copied.json');
    await page.getByLabel('取り込むv3問題JSON').fill(quiz('手動取込'));
    await page.getByRole('button', { name: '新規草稿として保存', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'imports/copied.json を新規草稿として保存した。' })).toBeVisible();
    await page.locator('summary').filter({ hasText: 'JSONを新規草稿へ取り込む' }).click();
    await page.getByLabel('取込先の新規草稿パス').fill('imports/copied.json');
    await page.getByLabel('取り込むv3問題JSON').fill(quiz('上書き禁止'));
    await page.getByRole('button', { name: '新規草稿として保存', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '草稿は別の画面で変更されている。' })).toBeVisible();
    await expect(page.getByLabel('取り込むv3問題JSON')).toHaveValue(quiz('上書き禁止'));
    await page.reload(); await expect(page.locator('legend').filter({ hasText: '手動取込' })).toBeVisible();
    await expect(page.getByText('上書き禁止', { exact: true })).toHaveCount(0);
});

test('遅いclipboard読取が貼付欄の新しい編集を上書きしない', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            readText: (): Promise<string> => new Promise((resolve) => { window.toolsTest.releaseRead = () => resolve('遅いclipboardの内容'); })
        } });
    });
    await page.locator('summary').filter({ hasText: 'JSONを新規草稿へ取り込む' }).click();
    await page.getByRole('button', { name: 'クリップボードを読み込む', exact: true }).click();
    await page.getByLabel('取り込むv3問題JSON').fill('利用者の新しい入力');
    await page.evaluate(() => { const release = window.toolsTest.releaseRead; if (release === undefined) throw new Error('読取待ちではない'); release(); });
    await expect(page.getByRole('status').filter({ hasText: '入力内容を保持した。' })).toBeVisible();
    await expect(page.getByLabel('取り込むv3問題JSON')).toHaveValue('利用者の新しい入力');
});

test('rubyを右クリックとキーボード操作で収集し、結果へ出力して次sessionで初期化する', async ({ page }) => {
    await open(page); await start(page);
    await page.locator('.question-text ruby').first().click({ button: 'right' });
    await expect(page.getByRole('status').filter({ hasText: 'Ruby Buffer: 1件' })).toBeVisible();
    await page.locator('summary').filter({ hasText: '読みの収集・出典' }).click();
    await page.getByRole('button', { name: /を収集$/u }).first().focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Ruby Buffer: 1件' })).toBeVisible();
    await page.getByRole('button', { name: '中断して結果を見る', exact: true }).click();
    await page.getByRole('button', { name: '結果JSONをコピー', exact: true }).click();
    const copied: unknown = await page.evaluate((): unknown => JSON.parse(window.toolsTest.copied));
    expect(copied).toHaveProperty('rubyBuffer');
    const packageRefs = await page.evaluate((): { urlOnly: boolean } => {
        const parsed = JSON.parse(window.toolsTest.copied) as { replay: { packages: ReadonlyArray<Record<string, unknown>> } };
        return { urlOnly: parsed.replay.packages.length > 0 && parsed.replay.packages.every((pkg) => typeof pkg['url'] === 'string' && !('revision' in pkg)) };
    });
    expect(packageRefs.urlOnly).toBe(true);
    expect(copied).toMatchObject({ rubyBuffer: [expect.objectContaining({ base: expect.any(String), reading: expect.any(String) })] });
    await page.getByRole('button', { name: '同じ設定で再挑戦', exact: true }).click();
    await expect(page.locator('.question-text')).toBeVisible();
    await page.getByRole('button', { name: '中断して結果を見る', exact: true }).click();
    await page.getByRole('button', { name: '結果JSONをコピー', exact: true }).click();
    expect(await page.evaluate((): unknown => JSON.parse(window.toolsTest.copied))).toMatchObject({ rubyBuffer: [] });
});

test('source情報は明示的にコピーし、検証したlocal filemapだけを任意リンクにする', async ({ page }) => {
    await open(page); await start(page);
    await page.locator('summary').filter({ hasText: '読みの収集・出典' }).click();
    await page.getByRole('button', { name: '出典をコピー', exact: true }).first().click();
    const copied: unknown = await page.evaluate((): unknown => JSON.parse(window.toolsTest.copied));
    expect(copied).toMatchObject({ source: expect.stringMatching(/\/tools-data\/(?:one|two)\/\w\.json$/u), jsonPath: expect.stringMatching(/^\$\.table\[\d\]$/u) });
    const link = page.getByRole('link', { name: /ローカルVS Codeで開く/u }).first();
    await expect(link).toHaveAttribute('href', /^vscode:\/\/file\/C%3A\/quiz%20project\/tools-data\//u);
    await expect(page.locator('.question-text')).toBeVisible();
});

test('folder共有は同梱QRを描画しclean環境で同じ範囲を復元する', async ({ page, browser }) => {
    await open(page);
    await page.locator('summary').filter({ hasText: 'フォルダから範囲を選択' }).click();
    const folder = page.locator('details > p').filter({ hasText: '/tools-data/one/' });
    await folder.getByRole('button', { name: 'このフォルダを選択', exact: true }).click();
    await expect(page.getByText('選択範囲: 2問', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '共有URL・QRを表示', exact: true }).click();
    await expect(page.getByRole('img', { name: '共有URLのQRコード' })).toHaveAttribute('src', /^data:image\/png;base64,/u);
    await expect.poll(() => page.getByRole('img', { name: '共有URLのQRコード' }).evaluate((node) => node instanceof HTMLImageElement && node.naturalWidth > 0)).toBe(true);
    const url = await page.getByLabel('共有URL', { exact: true }).inputValue();
    const clean = await browser.newContext(); try {
        await routes(clean); const second = await clean.newPage(); await second.goto(url);
        await expect(second.getByText('選択範囲: 2問', { exact: true })).toBeVisible();
    } finally { await clean.close(); }
});

test('appのcacheだけを削除し、再起動後もユーザーと別scopeのcacheを保持する', async ({ page }) => {
    await open(page);
    await page.locator('summary').filter({ hasText: 'ユーザー・表示・問題一覧' }).click();
    await page.getByLabel('新しいユーザー名', { exact: true }).fill('保持する利用者');
    await page.getByRole('button', { name: 'ユーザーを追加', exact: true }).click();
    await expect(page.getByRole('option', { name: '保持する利用者', exact: true })).toHaveCount(1);
    const userId = await page.getByLabel('ユーザー', { exact: true }).inputValue();
    await page.locator('summary').filter({ hasText: 'ユーザー・表示・問題一覧' }).click();
    await page.evaluate(async () => {
        const own = await caches.open('quiz-web:%2Fquiz%2F:tools-test'); await own.put('/own', new Response('own'));
        const foreign = await caches.open('quiz-web:%2Fother%2F:tools-test'); await foreign.put('/foreign', new Response('foreign'));
    });
    page.once('dialog', async (dialog) => { await dialog.accept(); });
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'offline cacheを削除して再起動', exact: true }).click()]);
    await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['quiz-web:%2Fother%2F:tools-test']);
    await expect(page.getByRole('option', { name: '保持する利用者', exact: true })).toHaveCount(1);
    await expect(page.getByLabel('ユーザー', { exact: true })).toHaveValue(userId);
});
