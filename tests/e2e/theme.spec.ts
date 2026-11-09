import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

declare global { interface Window { themeTest: { release: () => void; fail: boolean; held: boolean } } }
const quiz = JSON.stringify({ version: 3, title: '[学習/がくしゅう]{題庫/quiz}', description: '色と保存状態の検証',
    table: [{ id: 'a', term: 'A' }, { id: 'b', term: 'B' }], patterns: [{ id: 'p', tokens: ['$x^2$',
        { type: 'smiles', value: 'CCO' }, { type: 'svg', value: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="5" fill="black"/></svg>', alt: '円' },
        { type: 'hide', id: 'h', value: [{ type: 'key', field: 'term' }], answer: { mode: 'choice_from_entities' } }] }] });
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
    const messages: string[] = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message));
    await page.addInitScript(() => { window.themeTest = { release: () => undefined, fail: false, held: false }; });
    await page.route('**/quiz/entry.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 3, files: ['./theme-quiz.json'] }) }));
    await page.route('**/quiz/theme-quiz.json', route => route.fulfill({ contentType: 'application/json', body: quiz }));
});
test.afterEach(({ page }) => { expect(errors.get(page) ?? []).toEqual([]); });
async function open(page: Page): Promise<void> {
    await page.goto('./'); await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeEnabled();
}
async function details(page: Page, title: string): Promise<void> {
    const summary = page.locator('summary').filter({ hasText: title });
    if (await summary.locator('..').getAttribute('open') === null) await summary.click();
}
async function theme(page: Page, expected: 'light' | 'dark' | 'black'): Promise<void> {
    await expect(page.locator('html')).toHaveAttribute('data-theme', expected);
    await expect(page.getByRole('button', { name: 'ダークテーマ', exact: true })).toHaveAttribute('aria-pressed', String(expected !== 'light'));
}
async function storedText(page: Page, store: 'settings' | 'drafts', id: string): Promise<string> {
    return page.evaluate(({ store, id }) => new Promise<string>((resolve, reject) => {
        const opened = indexedDB.open('bem130-quiz-web-v1'); opened.onerror = () => reject(new Error('DB open失敗'));
        opened.onsuccess = () => {
            const db = opened.result; const request = db.transaction(store).objectStore(store).get(id);
            request.onerror = () => { db.close(); reject(new Error('保存内容取得失敗')); };
            request.onsuccess = () => {
                const value: unknown = request.result; db.close();
                if (typeof value !== 'object' || value === null) { resolve(''); return; }
                const text: unknown = store === 'settings' && 'value' in value ? value.value : 'text' in value ? value.text : '';
                if (typeof text !== 'string') reject(new Error('保存内容の型が不正')); else resolve(text);
            };
        };
    }), { store, id });
}
async function savedTheme(page: Page, value: string): Promise<void> {
    await expect.poll(async () => {
        const raw = await storedText(page, 'settings', 'preferences');
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        return typeof parsed === 'object' && parsed !== null && 'theme' in parsed ? parsed.theme : null;
    }).toBe(value);
}
async function intercept(page: Page, code: string): Promise<void> {
    await page.route('**/src/web/storage/database.ts*', async route => {
        const response = await route.fetch(); await route.fulfill({ response, body: `${await response.text()}\n${code}\n` });
    });
}
function gate(): Readonly<{ promise: Promise<void>; release: () => void }> {
    let release = (): void => undefined;
    const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release };
}
async function snapshot(page: Page): Promise<Buffer> {
    await details(page, 'バックアップ・復元');
    const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '完全バックアップをダウンロード', exact: true }).click();
    const file = await (await downloaded).path(); if (!file) throw new Error('backup取得失敗'); return readFile(file);
}
async function delayedEntry(page: Page): Promise<Readonly<{ requested: Promise<void>; release: () => void }>> {
    const requested = gate(); const response = gate();
    await page.route('**/quiz/theme-delayed-entry.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 3, label: '[通信/つうしん]{題庫/list}', files: ['./theme-delayed.json'] }) }));
    await page.route('**/quiz/theme-delayed.json', async route => {
        requested.release(); await response.promise; await route.fulfill({ contentType: 'application/json', body: quiz.replace('題庫', '通信後題庫') });
    });
    await details(page, 'ユーザー・表示・問題一覧');
    await page.getByLabel('問題一覧のURL', { exact: true }).fill(new URL('theme-delayed-entry.json', page.url()).href);
    await page.getByRole('button', { name: '問題一覧を読み込む', exact: true }).click();
    return { requested: requested.promise, release: response.release };
}

test('headerの配色切替は未確定入力と選択を保ち、設定cycle・再起動・backup復元と同期する', async ({ page }) => {
    await open(page); const toggle = page.getByRole('button', { name: 'ダークテーマ', exact: true }); await theme(page, 'light');
    await details(page, 'ユーザー・表示・問題一覧');
    const name = page.getByLabel('新しいユーザー名', { exact: true }); await name.fill('未追加の日本語');
    await page.getByLabel('問題数', { exact: true }).fill('7');
    const selected = await page.getByRole('checkbox').isChecked();
    await toggle.click(); await theme(page, 'dark'); await savedTheme(page, 'dark');
    await expect(toggle).toHaveText('ダークテーマ'); await expect(name).toHaveValue('未追加の日本語');
    await expect(page.getByLabel('問題数', { exact: true })).toHaveValue('7'); expect(await page.getByRole('checkbox').isChecked()).toBe(selected);
    await expect(page.locator('[data-theme-current]')).toHaveText('現在: ダーク');
    await page.getByRole('button', { name: '配色を切替', exact: true }).click(); await theme(page, 'black'); await savedTheme(page, 'black');
    await page.reload(); await expect(toggle).toBeEnabled(); await theme(page, 'black');
    await toggle.click(); await theme(page, 'light'); await savedTheme(page, 'light');
    await toggle.click(); await savedTheme(page, 'dark');
    await details(page, 'バックアップ・復元');
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: '完全バックアップをダウンロード', exact: true }).click();
    const file = await (await download).path(); if (!file) throw new Error('backup取得失敗'); const backup = await readFile(file);
    await toggle.click(); await savedTheme(page, 'light');
    page.once('dialog', async dialog => { await dialog.accept(); });
    await page.getByLabel('復元するバックアップ', { exact: true }).setInputFiles({ name: 'theme.json', mimeType: 'application/json', buffer: backup });
    await expect(page.locator('.app-message')).toContainText('バックアップを復元した'); await theme(page, 'dark');
    await page.reload(); await expect(toggle).toBeEnabled(); await theme(page, 'dark');
});

test('回答savingとanswered中の配色操作は画面・回答を再作成せず、題庫名のruby/glossも描画する', async ({ page }) => {
    await intercept(page, `
const themeOriginalCommit = QuizStorage.prototype.commitAnswer;
const themeGate = new Promise(resolve => { window.themeTest.release = resolve; });
QuizStorage.prototype.commitAnswer = async function(command) { await themeGate; return themeOriginalCommit.call(this, command); };`);
    await open(page); await page.getByLabel('学習・テスト', { exact: true }).selectOption('test');
    await page.getByLabel('問題数', { exact: true }).fill('1'); await page.getByRole('button', { name: 'クイズを開始', exact: true }).click();
    const heading = page.locator('.app-view main h2'); await expect(heading.locator('ruby rt')).toHaveText('がくしゅう');
    await expect(heading.locator('.gloss-base')).toHaveText('題庫'); await expect(heading).not.toContainText('[学習/');
    await page.getByRole('button', { name: 'ダークテーマ', exact: true }).focus(); await page.keyboard.press('1');
    await expect(page.getByText('回答を保存中…', { exact: true })).toBeVisible();
    await page.locator('.question-text').evaluate(node => { node.setAttribute('data-theme-preserved', 'yes'); });
    const toggle = page.getByRole('button', { name: 'ダークテーマ', exact: true }); await toggle.click(); await theme(page, 'dark');
    await expect(page.getByText('回答を保存中…', { exact: true })).toBeVisible();
    await expect(page.locator('.question-text')).toHaveAttribute('data-theme-preserved', 'yes');
    await expect(page.getByRole('button', { name: '中断して結果を見る', exact: true })).toBeDisabled();
    await page.evaluate(() => window.themeTest.release());
    await expect(page.getByRole('button', { name: '次の問題', exact: true })).toBeVisible();
    await page.locator('.question-text').evaluate(node => { node.setAttribute('data-theme-preserved', 'answered'); });
    await toggle.focus(); await toggle.press('Enter'); await theme(page, 'light');
    await expect(page.getByRole('button', { name: '次の問題', exact: true })).toBeVisible();
    await expect(page.locator('.question-text')).toHaveAttribute('data-theme-preserved', 'answered');
    await page.getByRole('button', { name: '次の問題', exact: true }).click();
    await expect(page.getByRole('heading', { name: '結果', exact: true })).toBeVisible(); await expect(toggle).toBeEnabled();
});

test('標準入力のdirty buffer・合成IME・選択範囲を保持しMonacoも同じ配色へ追従する', async ({ page }) => {
    await open(page); await page.getByRole('button', { name: '草稿を編集', exact: true }).click();
    await page.getByLabel('入力方式', { exact: true }).selectOption('native');
    await page.getByLabel('草稿のパス', { exact: true }).fill('theme.json'); await page.getByRole('button', { name: '新規ファイル', exact: true }).click();
    const input = page.locator('textarea[data-draft-input]'); await expect(input).toBeEditable();
    await input.evaluate((node, text) => {
        if (!(node instanceof HTMLTextAreaElement)) throw new Error('textareaなし');
        node.dataset['themePreserved'] = 'yes'; node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        node.value = text; node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true })); node.setSelectionRange(5, 12);
    }, quiz);
    const toggle = page.getByRole('button', { name: 'ダークテーマ', exact: true }); await toggle.click(); await theme(page, 'dark');
    await expect(input).toHaveValue(quiz); await expect(input).toHaveAttribute('data-theme-preserved', 'yes');
    const nativeColors = await input.evaluate(node => ({ text: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }));
    expect(contrast(nativeColors.text, nativeColors.background)).toBeGreaterThanOrEqual(4.5);
    expect(await input.evaluate(node => node instanceof HTMLTextAreaElement ? [node.selectionStart, node.selectionEnd] : [])).toEqual([5, 12]);
    await expect(page.getByLabel('入力方式', { exact: true })).toBeDisabled(); expect(await storedText(page, 'drafts', 'theme.json')).not.toBe(quiz);
    await input.dispatchEvent('compositionend'); await page.getByRole('button', { name: '保存・再試行', exact: true }).click();
    await expect.poll(() => storedText(page, 'drafts', 'theme.json')).toBe(quiz);
    await page.getByLabel('入力方式', { exact: true }).selectOption('advanced'); await expect(page.locator('.monaco-editor.vs-dark')).toBeVisible();
    await toggle.click(); await theme(page, 'light'); await expect(page.locator('.monaco-editor.vs')).toBeVisible();
    await page.getByLabel('入力方式', { exact: true }).selectOption('native'); await expect(input).toHaveValue(quiz);
    await page.getByRole('button', { name: '編集を閉じる', exact: true }).click(); await expect(toggle).toBeEnabled();
});

test('配色保存失敗は画面適用と永続化失敗を区別し、再操作で保存を再試行できる', async ({ page }) => {
    await intercept(page, `
const themeOriginalSetting = QuizStorage.prototype.setSetting;
QuizStorage.prototype.setSetting = function(value) {
    if (value.id === 'preferences' && window.themeTest.fail) return Promise.resolve({ ok:false,error:{kind:'request',message:'theme保存失敗を注入'} });
    return themeOriginalSetting.call(this,value);
};`);
    await open(page); await page.getByRole('button', { name: 'ダークテーマ', exact: true }).click(); await savedTheme(page, 'dark');
    await page.evaluate(() => { window.themeTest.fail = true; });
    await page.getByRole('button', { name: 'ダークテーマ', exact: true }).click(); await theme(page, 'light');
    await expect(page.locator('.app-message')).toContainText('画面の配色は変更したが、設定を保存できない'); await savedTheme(page, 'dark');
    await page.evaluate(() => { window.themeTest.fail = false; });
    await page.getByRole('button', { name: 'ダークテーマ', exact: true }).click(); await savedTheme(page, 'dark');
    await expect(page.locator('.app-message')).toHaveText('配色を保存した。');
    await page.getByRole('button', { name: 'ダークテーマ', exact: true }).click(); await savedTheme(page, 'light');
});

for (const action of ['restore', 'reset'] as const) {
    test(`遅い設定保存と連続切替を${action}が追い越さず、置換後の配色を古いqueueが上書きしない`, async ({ page }) => {
        await intercept(page, `
const themeOriginalDelayedSetting = QuizStorage.prototype.setSetting;
let themeHeldOnce = false;
QuizStorage.prototype.setSetting = async function(value) {
    if (value.id === 'preferences' && window.themeTest.fail && !themeHeldOnce) {
        themeHeldOnce = true; window.themeTest.held = true;
        await new Promise(resolve => { window.themeTest.release = resolve; });
    }
    return themeOriginalDelayedSetting.call(this,value);
};`);
        await open(page); const toggle = page.getByRole('button', { name: 'ダークテーマ', exact: true });
        await toggle.click(); await savedTheme(page, 'dark'); await details(page, 'バックアップ・復元');
        const download = page.waitForEvent('download'); await page.getByRole('button', { name: '完全バックアップをダウンロード', exact: true }).click();
        const file = await (await download).path(); if (!file) throw new Error('backup取得失敗'); const backup = await readFile(file);
        await page.evaluate(() => { window.themeTest.fail = true; });
        await toggle.click(); await page.waitForFunction(() => window.themeTest.held);
        await toggle.click(); if (action === 'restore') await toggle.click();
        await theme(page, action === 'restore' ? 'light' : 'dark');
        page.once('dialog', async dialog => { await dialog.accept(); });
        if (action === 'restore') await page.getByLabel('復元するバックアップ', { exact: true }).setInputFiles({ name: 'theme.json', mimeType: 'application/json', buffer: backup });
        else await page.getByRole('button', { name: '新サイトの全データを削除', exact: true }).click();
        await expect(toggle).toBeDisabled(); await expect(page.locator('.app-view')).toHaveAttribute('inert', '');
        await page.evaluate(() => window.themeTest.release());
        await expect(page.locator('.app-message')).toContainText(action === 'restore' ? 'バックアップを復元した' : '新サイトの全保存データを削除した');
        await expect(toggle).toBeEnabled(); await expect(page.locator('.app-view')).not.toHaveAttribute('inert', '');
        await theme(page, action === 'restore' ? 'dark' : 'light');
        if (action === 'restore') await savedTheme(page, 'dark'); else expect(await storedText(page, 'settings', 'preferences')).toBe('');
        await page.reload(); await expect(toggle).toBeEnabled(); await theme(page, action === 'restore' ? 'dark' : 'light');
        if (action === 'restore') await savedTheme(page, 'dark'); else expect(await storedText(page, 'settings', 'preferences')).toBe('');
    });
}

for (const action of ['restore', 'reset'] as const) {
    test(`通信中の${action}はdisabledとhandlerで拒否し、取得完了後に保存データを安全に置換できる`, async ({ page }) => {
        await open(page); await page.getByRole('button', { name: 'ダークテーマ', exact: true }).click(); await savedTheme(page, 'dark');
        const backup = await snapshot(page); const pending = await delayedEntry(page); await pending.requested;
        const restore = page.getByLabel('復元するバックアップ', { exact: true });
        const reset = page.getByRole('button', { name: '新サイトの全データを削除', exact: true, includeHidden: true });
        const unexpectedDialog = async (dialog: import('@playwright/test').Dialog): Promise<void> => { await dialog.dismiss(); };
        let dialogs = 0;
        const onDialog = async (dialog: import('@playwright/test').Dialog): Promise<void> => { dialogs += 1; await unexpectedDialog(dialog); };
        page.on('dialog', onDialog);
        try {
            await expect(restore).toBeDisabled(); await expect(reset).toBeDisabled();
            // disabled UIを迂回したイベントでもhandlerが置換を始めない。
            await reset.dispatchEvent('click');
            await restore.setInputFiles({ name: 'theme.json', mimeType: 'application/json', buffer: backup });
            await expect(page.locator('.app-message')).toContainText('完了してから復元できる');
            expect(dialogs).toBe(0); await expect(page.locator('.quiz-card')).toHaveCount(1);
        } finally { page.off('dialog', onDialog); pending.release(); }
        await expect(page.locator('.quiz-card')).toHaveCount(2);
        await expect(restore).toBeEnabled(); await expect(reset).toBeEnabled();
        await expect(page.locator('.app-message')).toContainText('通信題庫 (list) を読み込んだ');
        await details(page, 'バックアップ・復元'); page.once('dialog', async dialog => { await dialog.accept(); });
        if (action === 'restore') await restore.setInputFiles({ name: 'theme.json', mimeType: 'application/json', buffer: backup });
        else await reset.click();
        await expect(page.locator('.app-message')).toContainText(action === 'restore' ? 'バックアップを復元した' : '新サイトの全保存データを削除した');
        await expect(page.locator('.quiz-card')).toHaveCount(action === 'restore' ? 1 : 0);
        await theme(page, action === 'restore' ? 'dark' : 'light');
    });
}

test('backupのfile読取待ちに通信が始まっても読取後の再検査で復元を始めない', async ({ page }) => {
    await open(page); const backup = await snapshot(page);
    await page.evaluate(() => {
        const original: unknown = Object.getOwnPropertyDescriptor(Blob.prototype, 'text')?.value;
        if (typeof original !== 'function') throw new Error('Blob.textを取得できない');
        File.prototype.text = async function(this: File): Promise<string> {
            const text: unknown = await Reflect.apply(original, this, []);
            if (typeof text !== 'string') throw new Error('Blob.textの戻り値が不正');
            window.themeTest.held = true;
            await new Promise<void>(resolve => { window.themeTest.release = resolve; }); return text;
        };
    });
    let dialogs = 0;
    page.on('dialog', async dialog => { dialogs += 1; await dialog.dismiss(); });
    await page.getByLabel('復元するバックアップ', { exact: true }).setInputFiles({ name: 'theme.json', mimeType: 'application/json', buffer: backup });
    await page.waitForFunction(() => window.themeTest.held);
    const pending = await delayedEntry(page); await pending.requested;
    try {
        await page.evaluate(() => window.themeTest.release());
        await expect(page.locator('.app-message')).toContainText('完了してから復元できる'); expect(dialogs).toBe(0);
        await expect(page.locator('.quiz-card')).toHaveCount(1);
    } finally { pending.release(); }
    await expect(page.locator('.quiz-card')).toHaveCount(2);
    await expect(page.getByLabel('復元するバックアップ', { exact: true })).toBeEnabled();
});

function contrast(a: string, b: string): number {
    const luminance = (rgb: string): number => {
        const channels = (rgb.match(/[\d.]+/gu) ?? []).slice(0, 3).map(value => Number(value) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return (channels[0] ?? 0) * .2126 + (channels[1] ?? 0) * .7152 + (channels[2] ?? 0) * .0722;
    };
    const first = luminance(a); const second = luminance(b); return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}
test('主要文字・warning・操作境界・focusの計算色と図の白canvasはlight/darkで読める', async ({ page }) => {
    await open(page); await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('学習・テスト', { exact: true }).selectOption('test'); await page.getByLabel('問題数', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'クイズを開始', exact: true }).click();
    await expect(page.locator('.question-text .diagram svg')).toHaveCount(2, { timeout: 30_000 });
    await expect(page.locator('.graphic-error')).toHaveCount(0);
    for (const expected of ['light', 'dark'] as const) {
        if (expected === 'dark') await page.getByRole('button', { name: 'ダークテーマ', exact: true }).click();
        await theme(page, expected); await page.keyboard.press('Tab'); await page.getByRole('button', { name: 'ダークテーマ', exact: true }).focus();
        // CSSの定数を再検査せず、実DOMの計算済み文字・背景・境界・focus色から測定する。
        const colors = await page.evaluate(() => {
            const panel = document.querySelector('.app-view main'); const button = document.querySelector('.theme-toggle');
            const choice = document.querySelector('.choice'); const katex = document.querySelector('.question-text .katex');
            if (!(panel instanceof HTMLElement) || !(button instanceof HTMLElement) || !(choice instanceof HTMLElement) || !(katex instanceof HTMLElement)) throw new Error('測定対象なし');
            const warning = document.createElement('p'); warning.className = 'warning'; warning.textContent = '検証用warning'; panel.append(warning);
            const disabled = document.createElement('button'); disabled.disabled = true; disabled.textContent = '検証用disabled'; panel.append(disabled);
            const inactive = getComputedStyle(disabled); const disabledColors = { text: inactive.color, background: inactive.backgroundColor, opacity: inactive.opacity }; disabled.remove();
            const text = getComputedStyle(panel); const control = getComputedStyle(button); const warningColor = getComputedStyle(warning).color; warning.remove();
            return { text: text.color, surface: text.backgroundColor, border: getComputedStyle(choice).borderTopColor,
                controlText: control.color, controlSurface: control.backgroundColor, focus: control.outlineColor, warning: warningColor,
                focusStyle: control.outlineStyle, focusWidth: control.outlineWidth, disabled: disabledColors,
                math: getComputedStyle(katex).color, canvas: [...document.querySelectorAll('.question-text .diagram svg')].map(node => ({ background: getComputedStyle(node).backgroundColor, filter: getComputedStyle(node).filter })) };
        });
        expect(contrast(colors.text, colors.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors.controlText, colors.controlSurface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors.warning, colors.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors.math, colors.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors.border, colors.surface)).toBeGreaterThanOrEqual(3);
        expect(contrast(colors.focus, colors.controlSurface)).toBeGreaterThanOrEqual(3);
        expect(colors.focusStyle).toBe('solid'); expect(colors.focusWidth).toBe('3px');
        expect(contrast(colors.disabled.text, colors.disabled.background)).toBeGreaterThanOrEqual(4.5); expect(colors.disabled.opacity).toBe('1');
        for (const canvas of colors.canvas) { expect(canvas.background).toBe('rgb(255, 255, 255)'); expect(canvas.filter).toBe('none'); }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        await page.screenshot({ path: test.info().outputPath(`theme-${expected}.png`), fullPage: true });
    }
});
