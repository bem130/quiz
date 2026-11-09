import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

declare global { interface Window { startupTest: { calls: number; closed: number[]; releaseOne: () => void; releaseTwo: () => void; oldSettingsRead: number } } }
async function intercept(page: Page, script: string): Promise<void> {
    await page.route('**/src/web/storage/database.ts*', async (route) => {
        const response = await route.fetch(); await route.fulfill({ response, body: `${await response.text()}\n${script}\n` });
    });
}
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
    const messages: string[] = []; errors.set(page, messages); page.on('pageerror', (error) => messages.push(error.message));
    await page.addInitScript(() => { window.startupTest = { calls: 0, closed: [], releaseOne: () => {}, releaseTwo: () => {}, oldSettingsRead: 0 }; });
});
test.afterEach(({ page }) => { expect(errors.get(page) ?? []).toEqual([]); });

test('遅いopenを二度やり直しても最新起動を保ち、後着の接続を閉じる', async ({ page }) => {
    await intercept(page, `
const originalStartupOpen = openQuizStorage;
openQuizStorage = async (...args) => {
    const call = ++window.startupTest.calls;
    const result = await originalStartupOpen(...args);
    if (!result.ok || call > 2) return result;
    const close = result.value.close.bind(result.value);
    result.value.close = () => { window.startupTest.closed.push(call); close(); };
    const get = result.value.getSetting.bind(result.value);
    result.value.getSetting = (id) => { window.startupTest.oldSettingsRead += 1; return get(id); };
    return new Promise(resolve => { window.startupTest[call === 1 ? 'releaseOne' : 'releaseTwo'] = () => resolve(result); });
};`);
    await page.goto('./');
    await expect.poll(() => page.evaluate(() => window.startupTest.calls)).toBe(1);
    await page.getByRole('button', { name: '起動をやり直す', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.startupTest.calls)).toBe(2);
    await page.getByRole('button', { name: '起動をやり直す', exact: true }).click();
    await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeEnabled();
    const user = await page.getByLabel('ユーザー', { exact: true }).inputValue();
    await page.evaluate(() => { window.startupTest.releaseTwo(); window.startupTest.releaseOne(); });
    await expect.poll(() => page.evaluate(() => [...new Set(window.startupTest.closed)].sort())).toEqual([1, 2]);
    expect(await page.evaluate(() => window.startupTest.oldSettingsRead)).toBe(0);
    await expect(page.getByLabel('ユーザー', { exact: true })).toHaveValue(user);
    await expect(page.getByRole('heading', { name: '起動できない', exact: true })).toHaveCount(0);
});

test('古い設定取得の失敗は再試行後のreadyをerrorへ戻さない', async ({ page }) => {
    await intercept(page, `
const originalStartupGet = QuizStorage.prototype.getSetting;
let startupWaited = false;
QuizStorage.prototype.getSetting = function(id) {
    if (id === 'preferences' && !startupWaited) {
        startupWaited = true;
        window.startupTest.calls += 1;
        return new Promise(resolve => { window.startupTest.releaseOne = () => resolve({ ok: false, error: { kind: 'request', message: '古い設定取得の失敗' } }); });
    }
    return originalStartupGet.call(this, id);
};`);
    await page.goto('./');
    await expect.poll(() => page.evaluate(() => window.startupTest.calls)).toBe(1);
    await page.getByRole('button', { name: '起動をやり直す', exact: true }).click();
    await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeEnabled();
    await page.evaluate(() => window.startupTest.releaseOne());
    await expect(page.getByRole('heading', { name: '出題範囲', exact: true })).toBeVisible();
    await expect(page.getByText('古い設定取得の失敗', { exact: true })).toHaveCount(0);
});

test('設定取得失敗の画面から退避でき、退避失敗も明示してデータを残したまま再試行する', async ({ page }) => {
    await intercept(page, `
const originalRecoveryGet = QuizStorage.prototype.getSetting;
const originalRecoveryExport = QuizStorage.prototype.exportBackup;
let recoveryFailed = false; let recoveryExportFailed = false;
QuizStorage.prototype.getSetting = async function(id) {
    if (id === 'preferences' && !recoveryFailed) {
        recoveryFailed = true;
        await this.saveDraft({ id: 'keep.json', text: '{未完成の草稿を保持する', updatedAt: 0, expectedVersion: 0 });
        return { ok: false, error: { kind: 'request', message: '設定取得の失敗を再現' } };
    }
    return originalRecoveryGet.call(this, id);
};
QuizStorage.prototype.exportBackup = function() {
    if (!recoveryExportFailed) { recoveryExportFailed = true; return Promise.resolve({ ok: false, error: { kind: 'request', message: '退避の失敗を再現' } }); }
    return originalRecoveryExport.call(this);
};`);
    await page.goto('./'); await expect(page.getByRole('heading', { name: '起動できない', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '保存済みデータをバックアップ', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('バックアップを作成できない: 退避の失敗を再現');
    await expect(page.getByRole('status')).toContainText('保存データは削除していない');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存済みデータをバックアップ', exact: true }).click();
    const download = await downloaded; const path = await download.path(); if (path === null) throw new Error('退避ファイルがない');
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ records: { drafts: [expect.objectContaining({ id: 'keep.json', text: '{未完成の草稿を保持する' })] } });
    await page.getByRole('button', { name: '再試行', exact: true }).click();
    await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeEnabled();
    await expect(page.getByRole('heading', { name: '起動できない', exact: true })).toHaveCount(0);
    await page.locator('summary').filter({ hasText: 'バックアップ・復元' }).click();
    const retainedDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: '完全バックアップをダウンロード', exact: true }).click();
    const retainedPath = await (await retainedDownload).path(); if (retainedPath === null) throw new Error('再試行後の退避ファイルがない');
    expect(JSON.parse(await readFile(retainedPath, 'utf8'))).toMatchObject({ records: { drafts: [expect.objectContaining({ id: 'keep.json', text: '{未完成の草稿を保持する' })] } });
});
