import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import type { EditorHarness } from './editor-harness.ts';
import { none, some } from '../../src/core/result.ts';
import type { Option } from '../../src/core/result.ts';

// harnessの型を参照する。ブラウザ専用実装をNode側へ読み込まない。
type BrowserHarness = EditorHarness;
declare global { interface Window { editorHarness: BrowserHarness } }
const runtimeErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
    const errors: string[] = []; runtimeErrors.set(page, errors);
    page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(({ page }) => { expect(runtimeErrors.get(page) ?? []).toEqual([]); });
function quiz(title: string, diagram = ''): string {
    return JSON.stringify({ title, description: '編集の検証', table: [{ id: 'a', term: 'A' }, { id: 'b', term: 'B' }],
        patterns: [{ id: 'p', tokens: [
            ...(diagram ? [{ type: 'svg', value: diagram, alt: '図形' }] : []),
            { type: 'hide', id: 'h', value: [{ type: 'key', field: 'term' }], answer: { mode: 'choice_from_entities' } }
        ] }] });
}
async function open(page: Page): Promise<void> {
    await page.goto('/quiz/tests/e2e/editor.html');
    await page.waitForFunction(() => window.editorHarness?.ready === true);
    await expect(page.getByRole('heading', { name: 'ローカル問題の編集' })).toBeVisible();
}

test('編集直後のA→B切替はAのcommitを待ち、再open後も内容を維持する', async ({ page }) => {
    await open(page);
    const changed = quiz('Aの変更');
    await page.evaluate((text) => {
        window.editorHarness.setText(text);
        const target = document.querySelector('[data-path="b.json"]');
        if (!(target instanceof HTMLButtonElement)) throw new Error('Bがない');
        target.click();
    }, changed);
    await expect(page.getByRole('textbox', { name: '草稿のパス' })).toHaveValue('b.json');
    expect(await page.evaluate(() => window.editorHarness.savedText('a.json'))).toBe(changed);
    await page.evaluate(() => window.editorHarness.reopen());
    await page.getByRole('button', { name: 'a.json', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.editorHarness.getText())).toBe(changed);
});

test('保存失敗では切替も閉じるも行わず、内容を残して同じversionで再試行する', async ({ page }) => {
    await open(page);
    const changed = quiz('保存失敗中');
    await page.evaluate((text) => {
        window.editorHarness.setFailure(true); window.editorHarness.setText(text);
        const target = document.querySelector('[data-path="b.json"]');
        if (target instanceof HTMLButtonElement) target.click();
    }, changed);
    await expect(page.locator('[role="status"]').filter({ hasText: '保存失敗を再現' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '草稿のパス' })).toHaveValue('a.json');
    expect(await page.evaluate(() => window.editorHarness.getText())).toBe(changed);
    await page.getByRole('button', { name: '編集を閉じる' }).click();
    await expect(page.locator('#editor-host')).not.toHaveAttribute('data-closed', 'true');
    await page.evaluate(() => window.editorHarness.setFailure(false));
    await page.getByRole('button', { name: '保存・再試行' }).click();
    await expect.poll(() => page.evaluate(() => window.editorHarness.savedText('a.json'))).toBe(changed);
});

test('JSON/schemaエラーを区別し、不正な編集中JSONも草稿として保存する', async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.editorHarness.setText('{"title":01}'));
    await expect(page.getByText(/検証エラー: invalid-json/u)).toBeVisible();
    expect(await page.evaluate(() => window.editorHarness.flush())).toBe(true);
    expect(await page.evaluate(() => window.editorHarness.savedText('a.json'))).toBe('{"title":01}');
    await page.evaluate(() => window.editorHarness.setText('{"title":"schema"}'));
    await expect(page.getByText(/検証エラー:/u)).not.toContainText('invalid-json');
});

test('IME変換中は切替・保存を留め、確定後の日本語を保存する', async ({ page }) => {
    await open(page);
    await page.getByRole('textbox', { name: '問題JSONの編集' }).focus();
    await page.getByRole('textbox', { name: '問題JSONの編集' }).dispatchEvent('compositionstart', { data: 'にほんご' });
    expect(await page.evaluate(() => window.editorHarness.isDirty())).toBe(true);
    const changed = quiz('日本語の確定');
    await page.evaluate((text) => window.editorHarness.setText(text), changed);
    await expect(page.getByRole('button', { name: '開く', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.editorHarness.flush())).toBe(false);
    await page.getByRole('textbox', { name: '問題JSONの編集' }).dispatchEvent('compositionend', { data: '日本語' });
    await expect(page.getByRole('button', { name: '開く', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.editorHarness.flush())).toBe(true);
    expect(await page.evaluate(() => window.editorHarness.savedText('a.json'))).toBe(changed);
});

test('SVGプレビューは安全subsetだけを描画し、古い非同期SVGを再挿入しない', async ({ page }) => {
    await open(page);
    const safe = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><path d="M0 0L100 60"/></svg>';
    await page.evaluate((text) => window.editorHarness.setText(text), quiz('安全SVG', safe));
    const preview = page.getByLabel('問題プレビュー', { exact: true });
    await expect(preview.locator('svg')).toHaveCount(1);
    await page.evaluate((text) => window.editorHarness.setText(text), quiz('不正SVG', '<svg xmlns="http://www.w3.org/2000/svg"><script>window.injectedBySvg=1</script></svg>'));
    await expect(preview).toContainText('図を表示できない');
    await expect(preview.locator('script')).toHaveCount(0);
    expect(await page.evaluate(() => Object.hasOwn(window, 'injectedBySvg'))).toBe(false);
    let pending: Option<Route> = none;
    await page.route('**/old.svg', (route) => { pending = some(route); });
    const external = { title: '旧画像', description: '遅延した描画', table: [{ id: 'a', term: 'A' }, { id: 'b', term: 'B' }],
        patterns: [{ id: 'p', tokens: [{ type: 'svg', src: 'old.svg', alt: '旧画像' },
            { type: 'hide', id: 'h', value: [{ type: 'key', field: 'term' }], answer: { mode: 'choice_from_entities' } }] }] };
    await page.evaluate((text) => window.editorHarness.setText(text), JSON.stringify(external));
    await expect.poll(() => pending.kind).toBe('some');
    await page.evaluate((text) => window.editorHarness.setText(text), quiz('現在の画像', safe));
    await expect(preview).toContainText('現在の画像');
    if (pending.kind !== 'some') throw new Error('旧画像requestがない');
    await pending.value.fulfill({ contentType: 'image/svg+xml', body: safe.replace('M0 0L100 60', 'M0 60L100 0') });
    await expect(preview.locator('svg')).toHaveCount(1);
    await expect(preview.locator('path')).toHaveAttribute('d', 'M0 0L100 60');
});

test('JSONプレビューのsourceクリックでMonacoの対応位置へ移動する', async ({ page }) => {
    await open(page);
    await page.evaluate((text) => window.editorHarness.setText(text), quiz('[日本語/にほんご]'));
    await expect(page.getByLabel('問題プレビュー', { exact: true })).toContainText('日本語');
    await page.getByRole('button', { name: 'JSONプレビュー', exact: true }).click();
    await page.getByLabel('JSONプレビュー', { exact: true }).locator('ruby').click();
    await expect(page.getByRole('textbox', { name: '問題JSONの編集' })).toBeFocused();
});

test('JSON workerを同じoriginから読み込み、CDNなしで編集を初期化する', async ({ page }) => {
    const workers: string[] = [];
    const external: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1:5173/')) external.push(request.url()); });
    await open(page);
    await expect.poll(() => workers.some((url) => url.includes('json.worker'))).toBe(true);
    expect(workers.every((url) => /(?:json|editor)\.worker/u.test(url))).toBe(true);
    expect(external).toEqual([]);
    await page.evaluate(() => { document.documentElement.dataset['theme'] = 'black'; });
    await expect(page.locator('.monaco-editor')).toHaveClass(/vs-dark/u);
});

test('空フォルダ・子ファイルを作成し、フォルダ名変更と削除をまとめて反映する', async ({ page }) => {
    await open(page);
    const path = page.getByRole('textbox', { name: '草稿のパス' });
    await path.fill('drafts');
    await page.getByRole('button', { name: '新規フォルダ', exact: true }).click();
    await expect(page.locator('[data-path="drafts/"]')).toBeVisible();
    await path.fill('drafts/child.json');
    await page.getByRole('button', { name: '新規ファイル', exact: true }).click();
    await expect(path).toHaveValue('drafts/child.json');
    await expect(page.locator('[role="status"]').filter({ hasText: 'drafts/child.json 保存済み' })).toBeVisible();
    const changed = quiz('フォルダ内の編集');
    await page.evaluate((text) => window.editorHarness.setText(text), changed);
    await page.locator('[data-path="drafts/"]').click();
    page.once('dialog', async (dialog) => { await dialog.accept('renamed'); });
    await page.getByRole('button', { name: '名前を変更', exact: true }).click();
    await expect(page.locator('[data-path="renamed/child.json"]')).toBeVisible();
    expect(await page.evaluate(() => window.editorHarness.savedText('renamed/child.json'))).toBe(changed);
    await page.locator('[data-path="renamed/"]').click();
    page.once('dialog', async (dialog) => { await dialog.accept(); });
    await page.getByRole('button', { name: '削除', exact: true }).click();
    await expect(page.locator('[data-path="renamed/child.json"]')).toHaveCount(0);
    await expect(page.locator('[data-path="renamed/"]')).toHaveCount(0);
});

test('別タブの更新を上書きせず、競合した内容を別名で保存できる', async ({ page }) => {
    await open(page);
    const mine = quiz('こちらの変更'); const theirs = quiz('別タブの変更');
    await page.evaluate(async ({ mine, theirs }) => {
        window.editorHarness.setText(mine);
        await window.editorHarness.updateExternally('a.json', theirs);
    }, { mine, theirs });
    expect(await page.evaluate(() => window.editorHarness.flush())).toBe(false);
    await page.getByRole('textbox', { name: '草稿のパス' }).fill('rescued.json');
    await page.getByRole('button', { name: '別名で保存', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.editorHarness.savedText('rescued.json'))).toBe(mine);
    expect(await page.evaluate(() => window.editorHarness.savedText('a.json'))).toBe(theirs);
});
