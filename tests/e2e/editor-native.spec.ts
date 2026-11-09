import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { EditorHarness } from './editor-harness.ts';

declare global { interface Window { editorHarness: EditorHarness } }
function quiz(title: string, description = '{説明/explanation} $x^2$'): string {
    return JSON.stringify({ version: 3, title, description, table: [{ id: 'a', term: 'A' }, { id: 'b', term: 'B' }],
        patterns: [{ id: 'p', tokens: [{ type: 'smiles', value: 'CC' }, { type: 'svg', value: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="5"/></svg>', alt: '円' }, { type: 'hide', id: 'h', value: [{ type: 'key', field: 'term' }], answer: { mode: 'choice_from_entities' } }] }] }, null, 2);
}
const errors = new WeakMap<Page, string[]>();
const monacoRequests = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
    const messages: string[] = []; const requests: string[] = []; errors.set(page, messages); monacoRequests.set(page, requests);
    page.on('pageerror', (error) => messages.push(error.message));
    page.on('request', (request) => { if (/monaco|(?:editor|json)\.worker/u.test(request.url())) requests.push(request.url()); });
});
test.afterEach(({ page }) => { expect(errors.get(page) ?? []).toEqual([]); });
async function open(page: Page): Promise<void> {
    await page.goto('/quiz/tests/e2e/editor.html'); await page.waitForFunction(() => window.editorHarness?.ready === true);
    await expect(page.getByRole('heading', { name: 'ローカル問題の編集' })).toBeVisible();
}

test.describe('touchを模した標準入力', () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

    test('touch既定textareaはMonacoを取得せず即時A→Bのcommitと再openを保持する', async ({ page }) => {
        await open(page); await expect(page.getByLabel('入力方式', { exact: true })).toHaveValue('native');
        const input = page.locator('textarea[data-draft-input]'); const changed = quiz('native保存');
        await input.fill(changed); await page.getByRole('button', { name: 'b.json', exact: true }).tap();
        await expect(page.getByLabel('草稿のパス', { exact: true })).toHaveValue('b.json');
        expect(await page.evaluate(() => window.editorHarness.savedText('a.json'))).toBe(changed);
        await page.evaluate(() => window.editorHarness.reopen());
        await page.getByRole('button', { name: 'a.json', exact: true }).tap(); await expect(input).toHaveValue(changed);
        expect(monacoRequests.get(page) ?? []).toEqual([]);
    });

    test('標準入力でもIME保存guardとrich preview・JSONからのsource jumpを共有する', async ({ page }) => {
        await open(page); const input = page.locator('textarea[data-draft-input]'); const text = quiz('😀 UTF-16の前置き', '[日本語/にほんご]{説明/explanation} $x^2$');
        // fill()による文字置換はFirefoxで変換を確定するため、未確定入力を一つのDOM処理で合成する。
        await input.evaluate((node, value) => {
            if (!(node instanceof HTMLTextAreaElement)) throw new Error('標準入力ではない');
            node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); node.value = value;
            node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: value, isComposing: true }));
        }, text);
        expect(await page.evaluate(() => window.editorHarness.flush())).toBe(false);
        expect(await page.evaluate(() => window.editorHarness.isDirty())).toBe(true);
        await expect(page.getByLabel('入力方式', { exact: true })).toBeDisabled();
        await page.getByRole('button', { name: 'b.json', exact: true }).tap();
        await expect(page.getByLabel('草稿のパス', { exact: true })).toHaveValue('a.json');
        await input.dispatchEvent('compositionend'); expect(await page.evaluate(() => window.editorHarness.flush())).toBe(true);
        expect(await page.evaluate(() => window.editorHarness.savedText('a.json'))).toBe(text);
        const preview = page.getByLabel('問題プレビュー', { exact: true });
        await expect(preview.locator('ruby')).toHaveCount(1); await expect(preview.locator('.katex')).toHaveCount(1);
        await expect(preview.locator('.diagram svg')).toHaveCount(2);
        await page.getByRole('button', { name: 'JSONプレビュー', exact: true }).tap();
        await page.getByLabel('JSONプレビュー', { exact: true }).locator('ruby').tap();
        await expect(input).toBeFocused();
        expect(await input.evaluate((node) => node instanceof HTMLTextAreaElement ? node.selectionStart : -1)).toBe(text.indexOf('"[日本語/にほんご]'));
        expect(monacoRequests.get(page) ?? []).toEqual([]);
    });

    test('高度編集の取得失敗は標準入力を保持し、その後も編集と保存を続けられる', async ({ page }) => {
        await page.route('**/src/web/monaco.ts*', (route) => route.abort());
        await open(page); const input = page.locator('textarea[data-draft-input]'); const text = quiz('保持する草稿'); await input.fill(text);
        await page.getByLabel('入力方式', { exact: true }).selectOption('advanced');
        await expect(page.getByRole('status').filter({ hasText: '元の入力内容を保持した。' })).toBeVisible();
        await expect(page.getByLabel('入力方式', { exact: true })).toHaveValue('native'); await expect(input).toHaveValue(text);
        await input.fill(quiz('失敗後も保存できる')); expect(await page.evaluate(() => window.editorHarness.flush())).toBe(true);
        expect(await page.evaluate(() => window.editorHarness.savedText('a.json'))).toBe(quiz('失敗後も保存できる'));
    });

    test('未編集CRLF草稿のUTF-16 source位置をLF表示へ写し、元の改行を保存したまま移動する', async ({ page }) => {
        await open(page);
        const text = quiz('emoji 😀', '[対象/たいしょう]').replaceAll('\n', '\r\n');
        await page.evaluate((raw) => window.editorHarness.updateExternally('a.json', raw), text);
        await page.evaluate(() => window.editorHarness.reopen());
        const input = page.locator('textarea[data-draft-input]');
        await expect(input).toHaveValue(text.replaceAll('\r\n', '\n'));
        expect(await page.evaluate(() => window.editorHarness.isDirty())).toBe(false);
        await page.getByRole('button', { name: 'JSONプレビュー', exact: true }).tap();
        await page.getByLabel('JSONプレビュー', { exact: true }).locator('ruby').tap();
        const expected = text.replaceAll('\r\n', '\n').indexOf('"[対象/たいしょう]"');
        expect(await input.evaluate((node) => node instanceof HTMLTextAreaElement ? node.selectionStart : -1)).toBe(expected);
        await expect(page.getByLabel('JSONプレビュー', { exact: true }).locator('.json-current')).toContainText('対象');
        expect(await page.evaluate(() => window.editorHarness.flush())).toBe(true);
        expect(await page.evaluate(() => window.editorHarness.savedText('a.json'))).toBe(text);
        expect(monacoRequests.get(page) ?? []).toEqual([]);
    });
});

test.describe('desktopの明示切替', () => {
    test.use({ hasTouch: false });
    test('Monaco取得中は操作を無効にし、準備直後の新規ファイル操作を失わない', async ({ page }) => {
        let markRequested = (): void => undefined; let resume = (): void => undefined;
        const requested = new Promise<void>((resolve) => { markRequested = resolve; });
        const resumed = new Promise<void>((resolve) => { resume = resolve; });
        await page.route('**/src/web/monaco.ts*', async (route) => {
            markRequested(); await resumed; await route.continue();
        });
        await page.goto('/quiz/tests/e2e/editor.html', { waitUntil: 'domcontentloaded' });
        await requested;
        const path = page.getByLabel('草稿のパス', { exact: true });
        const create = page.getByRole('button', { name: '新規ファイル', exact: true });
        try {
            await expect(path).toBeDisabled(); await expect(create).toBeDisabled();
            await expect(page.getByLabel('入力方式', { exact: true })).toBeDisabled();
            await expect(page.getByRole('status').filter({ hasText: '編集器を準備中…' })).toBeVisible();
        } finally { resume(); }
        // fill/clickの自動待機は、listenerと初期草稿復元が揃った時点で進む。
        await path.fill('after-initialization.json'); await create.click();
        await expect(page.locator('[data-state="saved"]')).toHaveText('after-initialization.json 保存済み');
        await page.waitForFunction(() => window.editorHarness?.ready === true);
        expect(await page.evaluate(() => window.editorHarness.savedText('after-initialization.json'))).toContain('after-initialization');
    });

    test('入力方式の切替はflushを待ち、失敗時はbufferを残して再試行できる', async ({ page }) => {
        await open(page); await expect(page.getByLabel('入力方式', { exact: true })).toHaveValue('advanced');
        await page.getByLabel('入力方式', { exact: true }).selectOption('native');
        const input = page.locator('textarea[data-draft-input]'); const text = quiz('切替待ちの入力'); await expect(input).toBeVisible(); await input.fill(text);
        await page.evaluate(() => window.editorHarness.setFailure(true));
        await page.getByLabel('入力方式', { exact: true }).selectOption('advanced');
        await expect(page.getByRole('status').filter({ hasText: '保存失敗を再現' })).toBeVisible();
        await expect(input).toHaveValue(text); await expect(page.getByLabel('入力方式', { exact: true })).toHaveValue('native');
        await page.evaluate(() => window.editorHarness.setFailure(false));
        await page.getByLabel('入力方式', { exact: true }).selectOption('advanced');
        await expect(page.locator('.monaco-editor')).toBeVisible(); await expect(page.getByLabel('入力方式', { exact: true })).toHaveValue('advanced');
        await page.getByLabel('入力方式', { exact: true }).selectOption('native'); await expect(input).toHaveValue(text);
        expect(await page.evaluate(() => window.editorHarness.savedText('a.json'))).toBe(text);
    });

    for (const [name, newline] of [['CRLF', '\r\n'], ['lone CR', '\r']] as const) {
        test(`${name}と補助文字のsource位置はnativeとMonacoを往復しても同じ場所へ移動する`, async ({ page }) => {
            await open(page);
            const text = quiz('emoji 😀', '[対象/たいしょう]').replaceAll('\n', newline);
            await page.evaluate((raw) => window.editorHarness.updateExternally('a.json', raw), text);
            await page.evaluate(() => window.editorHarness.reopen());
            await page.getByLabel('入力方式', { exact: true }).selectOption('native');
            const input = page.locator('textarea[data-draft-input]');
            await page.getByRole('button', { name: 'JSONプレビュー', exact: true }).click();
            await page.getByLabel('JSONプレビュー', { exact: true }).locator('ruby').click();
            const rawOffset = text.indexOf('"[対象/たいしょう]"'); const displayedOffset = text.replace(/\r\n?/gu, '\n').indexOf('"[対象/たいしょう]"');
            expect(await input.evaluate((node) => node instanceof HTMLTextAreaElement ? node.selectionStart : -1)).toBe(displayedOffset);
            await page.getByLabel('入力方式', { exact: true }).selectOption('advanced');
            await expect(page.locator('.monaco-editor')).toBeVisible();
            const advancedOffset = await page.evaluate(async () => {
                const module = await import('../../src/web/monaco.ts'); const editor = module.editor.getEditors().at(0);
                const model = editor?.getModel(); const position = editor?.getPosition();
                return model && position ? model.getOffsetAt(position) : -1;
            });
            expect(advancedOffset).toBe(rawOffset);
            await page.getByLabel('入力方式', { exact: true }).selectOption('native');
            expect(await input.evaluate((node) => node instanceof HTMLTextAreaElement ? node.selectionStart : -1)).toBe(displayedOffset);
            expect(await page.evaluate(() => window.editorHarness.isDirty())).toBe(false);
            expect(await page.evaluate(() => window.editorHarness.flush())).toBe(true);
            expect(await page.evaluate(() => window.editorHarness.savedText('a.json'))).toBe(text);
        });
    }
});
