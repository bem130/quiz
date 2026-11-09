import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { outputFiles, precacheAssets } from '../../scripts/build-assets.ts';

async function ready(page: Page): Promise<void> {
    await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeVisible();
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active !== undefined);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

test('本番buildをprecacheした後はofflineで草稿を編集保存し、browser再起動後に出題と回答を保存できる', async ({ playwright, browserName }) => {
    const server = await versionServer();
    const profile = await mkdtemp(path.join(os.tmpdir(), 'quiz-pwa-profile-'));
    let context: BrowserContext | undefined;
    try {
    context = await playwright[browserName].launchPersistentContext(profile, { headless: true });
    const page = context.pages().at(0) ?? await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.baseURL); await ready(page);
    await expect(page.locator('.quiz-card').filter({ hasText: 'math-v3.json' })).toBeVisible();
    await expect(page.locator('.quiz-card').filter({ hasText: 'svg-v3.json' })).toBeVisible();
    const precache = await page.evaluate(async () => {
        const names = await caches.keys();
        const name = names.find(value => value.includes(':static:'));
        if (!name) throw new Error('shell cache missing');
        return (await (await caches.open(name)).keys()).map(request => request.url);
    });
    expect(precache.some(url => url.endsWith('.wasm'))).toBe(true);
    expect(precache.some(url => url.includes('editor.worker'))).toBe(true);
    expect(precache.some(url => url.endsWith('.woff2'))).toBe(true);
    expect(precache.some(url => url.endsWith('/data/sample/figures/circle.svg'))).toBe(true);
    await context.setOffline(true); await page.reload(); await ready(page);
    await expect(page.locator('.quiz-card').filter({ hasText: 'math-v3.json' })).toBeVisible();
    await expect(page.locator('.quiz-card').filter({ hasText: 'svg-v3.json' })).toBeVisible();
    await page.getByRole('button', { name: '草稿を編集', exact: true }).click();
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('編集器を読み込めない');
    await createDraft(page, 'offline.json');
    const text = draftJson('オフラインで編集した題庫');
    await replaceEditorText(page, text);
    await page.getByRole('button', { name: '保存・再試行', exact: true }).click();
    await expect(page.locator('[data-state="saved"]').filter({ hasText: 'offline.json 保存済み' })).toBeVisible();
    expect(await storedRows(page, 'drafts')).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'offline.json', text })]));
    await page.getByRole('button', { name: '編集を閉じる', exact: true }).click();
    // 同じ永続profileを使ってbrowserプロセスを終了・再起動する。storageStateによる再注入はしない。
    await context.close();
    context = await playwright[browserName].launchPersistentContext(profile, { headless: true });
    await context.setOffline(true);
    const restarted = context.pages().at(0) ?? await context.newPage();
    restarted.on('pageerror', error => errors.push(error.message));
    await restarted.goto(server.baseURL); await ready(restarted);
    await restarted.getByRole('button', { name: '選択を解除', exact: true }).click();
    await restarted.locator('.quiz-card').filter({ hasText: 'オフラインで編集した題庫' }).getByRole('checkbox').check();
    await restarted.getByLabel('学習・テスト', { exact: true }).selectOption('test');
    await restarted.getByLabel('問題数', { exact: true }).fill('1');
    await restarted.getByRole('button', { name: 'クイズを開始', exact: true }).click();
    await expect(restarted.locator('.choices button')).toHaveCount(2);
    await restarted.locator('.choices button').first().click();
    await expect(restarted.getByRole('button', { name: '次の問題', exact: true })).toBeEnabled();
    expect(await storedRows(restarted, 'attempts')).toHaveLength(1);
    await restarted.getByRole('button', { name: '次の問題', exact: true }).click();
    await expect(restarted.getByRole('heading', { name: '結果', exact: true })).toBeVisible();
    await restarted.reload(); await ready(restarted);
    expect(await storedRows(restarted, 'attempts')).toHaveLength(1);
    expect(errors).toEqual([]);
    } finally {
        await context?.close(); await server.close();
        expect(path.dirname(profile)).toBe(os.tmpdir()); expect(path.basename(profile).startsWith('quiz-pwa-profile-')).toBe(true);
        await rm(profile, { recursive: true, force: true });
    }
});

function draftJson(title: string): string {
    return JSON.stringify({ version: 3, title, description: 'PWA実ブラウザー受入', table: [{ id: 'a', term: 'A' }, { id: 'b', term: 'B' }],
        patterns: [{ id: 'p', label: '文字を選ぶ', tokens: [{ type: 'hide', id: 'answer', value: [{ type: 'key', field: 'term' }], answer: { mode: 'choice_from_entities' } }] }] });
}
async function createDraft(page: Page, id: string): Promise<void> {
    await page.getByLabel('草稿のパス', { exact: true }).fill(id);
    await page.getByRole('button', { name: '新規ファイル', exact: true }).click();
    await expect(page.locator('[data-state="saved"]').filter({ hasText: `${id} 保存済み` })).toBeVisible();
}
async function replaceEditorText(page: Page, text: string): Promise<void> {
    await page.locator('.monaco-editor .view-lines').first().click();
    // Windows版WebKitもMacintoshのUAを使うため、Monacoのキー割当と同じブラウザー環境を見る。
    const modifier = await page.evaluate(() => navigator.userAgent.includes('Macintosh') ? 'Meta' : 'Control');
    await page.keyboard.press(`${modifier}+A`);
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(text);
}
async function storedRows(page: Page, store: string): Promise<readonly unknown[]> {
    return page.evaluate(name => new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open('bem130-quiz-web-v1');
        open.onerror = () => reject(new Error('IDB open failed'));
        open.onsuccess = () => {
            const database = open.result;
            const transaction = database.transaction(name, 'readonly');
            const result = transaction.objectStore(name).getAll();
            let rows: unknown[] = [];
            result.onsuccess = () => { const value: unknown = result.result; if (Array.isArray(value)) rows = value; else reject(new Error('Invalid store result')); };
            transaction.oncomplete = () => { database.close(); resolve(rows); };
            transaction.onabort = () => { database.close(); reject(new Error('IDB read aborted')); };
        };
    }), store);
}
async function databaseSnapshot(page: Page): Promise<readonly Readonly<{ store: string; rows: readonly unknown[] }>[]> {
    return Promise.all(['users', 'drafts', 'packages', 'attempts', 'sessions', 'schedule', 'confusion', 'conceptStats', 'settings', 'assets']
        .map(async store => ({ store, rows: await storedRows(page, store) })));
}

function versionFrom(value: unknown): string {
    if (typeof value !== 'object' || value === null || !('version' in value) || typeof value.version !== 'string') throw new Error('version metadata missing');
    return value.version;
}
function contentType(file: string): string {
    switch (path.extname(file)) {
        case '.html': return 'text/html'; case '.js': return 'text/javascript'; case '.css': return 'text/css';
        case '.json': return 'application/json'; case '.webmanifest': return 'application/manifest+json';
        case '.svg': return 'image/svg+xml'; case '.wasm': return 'application/wasm';
        case '.woff2': return 'font/woff2'; case '.woff': return 'font/woff'; case '.ttf': return 'font/ttf';
        default: return 'application/octet-stream';
    }
}
async function nextVersion(original: string, output: string, version: string): Promise<void> {
    await cp(original, output, { recursive: true });
    const oldVersion = versionFrom(JSON.parse(await readFile(path.join(output, 'app-version.json'), 'utf8')));
    const renames = new Map<string, string>();
    for (const file of await outputFiles(output)) {
        if (!file.startsWith('assets/') || !file.endsWith('.js')) continue;
        const input = await readFile(path.join(output, file), 'utf8');
        const editor = /^assets\/editor-[^/]+\.js$/u.test(file);
        if (!input.includes(oldVersion) && !editor) continue;
        const changed = input.replaceAll(oldVersion, version) + (editor ? `\n// acceptance version: ${version}\n` : '');
        const name = `${path.basename(file, '.js')}-${createHash('sha256').update(changed).digest('hex').slice(0, 8)}.js`;
        const next = `assets/${name}`;
        await writeFile(path.join(output, file), changed, 'utf8');
        await rename(path.join(output, file), path.join(output, next));
        renames.set(path.basename(file), name);
    }
    expect(renames.size).toBeGreaterThan(0);
    for (const file of await outputFiles(output)) {
        if (!/\.(?:html|js|css|json|webmanifest)$/u.test(file) || file === 'sw.js') continue;
        let text = await readFile(path.join(output, file), 'utf8');
        for (const [before, after] of renames) text = text.replaceAll(before, after);
        await writeFile(path.join(output, file), text, 'utf8');
    }
    await writeFile(path.join(output, 'app-version.json'), JSON.stringify({ version }), 'utf8');
    const assets = await precacheAssets(output, '/quiz/');
    await writeFile(path.join(output, 'precache-manifest.json'), JSON.stringify({ version, assets }), 'utf8');
    await build({
        configFile: false, root: process.cwd(), publicDir: false, logLevel: 'silent',
        define: { __APP_VERSION__: JSON.stringify(version), __PRECACHE__: JSON.stringify(assets) },
        build: { outDir: output, emptyOutDir: false, target: 'es2022', lib: { entry: path.resolve('src/service-worker.ts'), formats: ['iife'], name: 'QuizServiceWorker', fileName: () => 'sw.js' } }
    });
}
type VersionServer = Readonly<{ baseURL: string; nextVersion: string; editorAsset: string; mimeAsset: string; mimeAssetHash: string; requests: readonly string[]; publish(): void; breakInstall(): void; breakMimeInstall(): void; repairInstall(): void; denyAsset(asset: string): void; close(): Promise<void> }>;
async function versionServer(): Promise<VersionServer> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'quiz-pwa-update-'));
    const original = path.resolve('dist'); const next = path.join(directory, 'next');
    const oldVersion = versionFrom(JSON.parse(await readFile(path.join(original, 'app-version.json'), 'utf8')));
    const nextId = `${oldVersion}-acceptance-next`;
    await nextVersion(original, next, nextId);
    const editorAsset = (await outputFiles(original)).find(file => /^assets\/editor-[^/]+\.js$/u.test(file));
    if (!editorAsset) throw new Error('Lazy editor chunk missing');
    const fontAsset = (await outputFiles(next)).find(file => file.endsWith('.woff2'));
    if (!fontAsset) throw new Error('Font precache asset missing');
    const mimeAsset = (await outputFiles(next)).find(file => /^assets\/editor-[^/]+\.js$/u.test(file));
    if (!mimeAsset) throw new Error('Next editor asset missing');
    const mimeAssetHash = createHash('sha256').update(await readFile(path.join(next, mimeAsset))).digest('hex');
    const denied = new Set<string>();
    const requests: string[] = [];
    let brokenInstall = false;
    let brokenMime = false;
    let current = original;
    const server = createServer((request, response) => {
        async function serve(): Promise<void> {
            const url = new URL(request.url ?? '/', 'http://127.0.0.1');
            if (!url.pathname.startsWith('/quiz/')) { response.writeHead(404).end(); return; }
            const relative = decodeURIComponent(url.pathname.slice('/quiz/'.length)) || 'index.html';
            requests.push(relative);
            if (denied.has(relative)) { response.writeHead(404, { 'Cache-Control': 'no-store' }).end(); return; }
            if (brokenInstall && relative === fontAsset) { response.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'no-store' }).end('corrupt font'); return; }
            const file = path.resolve(current, relative);
            const checked = path.relative(current, file);
            if (checked.startsWith('..') || path.isAbsolute(checked)) { response.writeHead(400).end(); return; }
            try {
                const body = await readFile(file);
                response.writeHead(200, { 'Content-Type': brokenMime && relative === mimeAsset ? 'text/html' : contentType(file), 'Cache-Control': 'no-store', Vary: 'Origin' });
                response.end(body);
            } catch { response.writeHead(404).end(); }
        }
        serve().catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address missing');
    return {
        baseURL: `http://127.0.0.1:${address.port}/quiz/`, nextVersion: nextId, editorAsset, mimeAsset, mimeAssetHash, requests,
        publish() { current = next; }, breakInstall() { brokenInstall = true; current = next; }, breakMimeInstall() { brokenMime = true; current = next; },
        repairInstall() { brokenInstall = false; brokenMime = false; denied.clear(); }, denyAsset(asset) { denied.add(asset); },
        async close() {
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            expect(path.dirname(directory)).toBe(os.tmpdir()); expect(path.basename(directory).startsWith('quiz-pwa-update-')).toBe(true);
            await rm(directory, { recursive: true, force: true });
        }
    };
}
async function waiting(page: Page): Promise<void> {
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update(); });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state), { timeout: 30_000 }).toBe('installed');
}

test('旧版から新版を通知し、明示適用後も他tabの学習と旧hashedassetを維持する', async ({ browser }) => {
    const server = await versionServer();
    let context: BrowserContext | undefined;
    try {
        context = await browser.newContext();
        const menu = await context.newPage(); await menu.goto(server.baseURL); await ready(menu);
        const oldScript = await menu.locator('script[type=module][src]').getAttribute('src');
        expect(oldScript).toBeTruthy();
        const playing = await context.newPage(); await playing.goto(server.baseURL); await ready(playing);
        await playing.getByRole('button', { name: 'クイズを開始', exact: true }).click();
        await expect(playing.getByRole('button', { name: '分からない', exact: true })).toBeVisible();
        // 本物のIndexedDB transactionを保持し、回答commitを保存中にする。
        await playing.evaluate(() => new Promise<void>((resolve, reject) => {
            const open = indexedDB.open('bem130-quiz-web-v1');
            open.onerror = () => reject(new Error('test database open failed'));
            open.onsuccess = () => {
                const database = open.result;
                const transaction = database.transaction(Array.from(database.objectStoreNames), 'readwrite');
                const store = transaction.objectStore('settings');
                let holding = true;
                window.addEventListener('quiz-pwa-release-write', () => { holding = false; }, { once: true });
                transaction.oncomplete = () => database.close();
                transaction.onabort = () => database.close();
                const keepAlive = (): void => {
                    const request = store.get('pwa-write-barrier');
                    request.onsuccess = () => { resolve(); if (holding) keepAlive(); };
                    request.onerror = () => reject(new Error('test database barrier failed'));
                };
                keepAlive();
            };
        }));
        await playing.locator('.choices button').first().click();
        await expect(playing.getByText('回答を保存中…', { exact: true })).toBeVisible();
        server.publish(); await waiting(menu);
        // 活動中のtabを含め、自動で新版へ切り替わらない。
        await expect.poll(() => playing.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state), { timeout: 30_000 }).toBe('installed');
        const waitingState = await playing.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            return { url: location.href, controller: navigator.serviceWorker.controller?.state, active: registration?.active?.state, waiting: registration?.waiting?.state, installing: registration?.installing?.state, caches: await caches.keys() };
        });
        expect(waitingState.waiting, JSON.stringify(waitingState)).toBe('installed');
        await expect(playing.getByRole('button', { name: '新しいアプリ版を適用', exact: true })).toHaveCount(0);
        await expect(playing.getByText('回答を保存中…', { exact: true })).toBeVisible();
        await playing.evaluate(() => window.dispatchEvent(new Event('quiz-pwa-release-write')));
        await expect(playing.getByRole('button', { name: '次の問題', exact: true })).toBeEnabled();
        await playing.getByRole('button', { name: '次の問題', exact: true }).click();
        await menu.bringToFront();
        await menu.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        const apply = menu.getByRole('button', { name: '新しいアプリ版を適用', exact: true, includeHidden: true });
        await expect(apply).toBeAttached();
        await expect(apply).toBeVisible();
        let reloads = 0;
        menu.on('framenavigated', frame => { if (frame === menu.mainFrame()) reloads += 1; });
        await Promise.all([menu.waitForEvent('load'), apply.click()]); await ready(menu);
        const newScript = await menu.locator('script[type=module][src]').getAttribute('src');
        expect(newScript).not.toBe(oldScript);
        expect(reloads).toBe(1);
        const cacheNames = await menu.evaluate(() => caches.keys());
        expect(cacheNames.filter(name => name.includes(':static:')).length).toBeGreaterThanOrEqual(2);
        await expect(playing.getByRole('button', { name: '分からない', exact: true })).toBeVisible();
        await context.setOffline(true);
        const oldAsset = await playing.evaluate(async script => {
            if (!script) throw new Error('old script missing');
            const response = await fetch(script); return { status: response.status, size: (await response.text()).length };
        }, oldScript);
        expect(oldAsset.status).toBe(200); expect(oldAsset.size).toBeGreaterThan(1000);
        await playing.locator('.choices button').first().click();
        await expect(playing.getByRole('button', { name: '次の問題', exact: true })).toBeEnabled();
        // 新版menuと旧版の学習tabが共存していても、適用によるreloadは一回だけ。
        expect(await playing.locator('script[type=module][src]').getAttribute('src')).toBe(oldScript);
        expect(reloads).toBe(1);
        await context.setOffline(false);
        await menu.bringToFront();
        for (let check = 0; check < 2; check += 1) {
            const response = menu.waitForResponse(value => value.url() === `${server.baseURL}app-version.json` && value.status() === 200);
            await menu.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
            const version = await response;
            expect(versionFrom(await version.json())).toBe(server.nextVersion);
            await version.finished();
            // version応答の解析と描画を待つ。固定sleepでreloadの不在を推測しない。
            await menu.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
            expect(await menu.locator('script[type=module][src]').getAttribute('src')).toBe(newScript);
            expect(reloads).toBe(1);
        }
    } finally { await context?.close(); await server.close(); }
});

test('未保存の草稿がある間は新版をwaitingに留め、保存と編集終了後だけ明示適用する', async ({ page }) => {
    const server = await versionServer();
    try {
        await page.goto(server.baseURL); await ready(page);
        const oldScript = await page.locator('script[type=module][src]').getAttribute('src');
        await page.getByRole('button', { name: '草稿を編集', exact: true }).click();
        await createDraft(page, 'update-protected.json');
        const before = await storedRows(page, 'drafts');
        const editor = page.getByRole('textbox', { name: '問題JSONの編集', exact: true });
        // 実Monacoの変更bufferをIME変換中として保持する。OSのIME自体はこの試験の対象外。
        const changed = draftJson('未保存中の更新保護');
        await replaceEditorText(page, changed);
        await editor.dispatchEvent('compositionstart', { data: '編集中' });
        await expect(page.locator('[data-state="dirty"]')).toBeVisible();
        server.publish(); await waiting(page);
        expect(await storedRows(page, 'drafts')).toEqual(before);
        await expect(page.locator('.monaco-editor').first()).toBeVisible();
        await expect(page.getByRole('button', { name: '新しいアプリ版を適用', exact: true })).toHaveCount(0);
        expect(await page.locator('script[type=module][src]').getAttribute('src')).toBe(oldScript);
        expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
        await editor.dispatchEvent('compositionend', { data: '編集中' });
        await page.getByRole('button', { name: '保存・再試行', exact: true }).click();
        await expect(page.locator('[data-state="saved"]').filter({ hasText: 'update-protected.json 保存済み' })).toBeVisible();
        await page.getByRole('button', { name: '編集を閉じる', exact: true }).click();
        const apply = page.getByRole('button', { name: '新しいアプリ版を適用', exact: true, includeHidden: true });
        await expect(apply).toBeAttached();
        await expect(apply).toBeVisible();
        await Promise.all([page.waitForEvent('load'), apply.click()]); await ready(page);
        expect(await page.locator('script[type=module][src]').getAttribute('src')).not.toBe(oldScript);
        expect(await storedRows(page, 'drafts')).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'update-protected.json', text: changed })]));
    } finally { await server.close(); }
});

for (const failure of ['integrity', 'worker404', 'mime'] as const) {
    test(`新版の${failure === 'integrity' ? 'install整合性検査' : failure === 'mime' ? 'install MIME検査' : 'worker取得'}が失敗しても旧版を維持する`, async ({ page, context }) => {
        const server = await versionServer();
        try {
            await page.goto(server.baseURL); await ready(page);
            await expect(page.getByRole('button', { name: '新しいアプリ版を適用', exact: true, includeHidden: true })).toHaveCount(0);
            const oldScript = await page.locator('script[type=module][src]').getAttribute('src');
            const before = await storedRows(page, 'users');
            const beforeDatabase = await databaseSnapshot(page);
            if (failure !== 'worker404') {
                if (failure === 'integrity') server.breakInstall();
                else {
                    server.breakMimeInstall();
                    // 本文自体は正しいJSである。hash失敗による拒否と取り違えない。
                    const response = await fetch(`${server.baseURL}${server.mimeAsset}`);
                    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('text/html');
                    expect(createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex')).toBe(server.mimeAssetHash);
                }
                const result = await page.evaluate(async () => {
                    const registration = await navigator.serviceWorker.getRegistration();
                    if (!registration) throw new Error('SW registration missing');
                    const redundant = new Promise<string>(resolve => {
                        registration.addEventListener('updatefound', () => {
                            const installing = registration.installing;
                            if (installing) installing.addEventListener('statechange', () => { if (installing.state === 'redundant') resolve(installing.state); });
                        }, { once: true });
                    });
                    await registration.update();
                    return redundant;
                });
                expect(result).toBe('redundant');
            } else {
                server.publish(); server.denyAsset('sw.js');
                const requestedBefore = server.requests.length;
                await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
                await expect(page.getByRole('status')).toContainText('新しい版の準備を完了できない');
                expect(server.requests.slice(requestedBefore)).toContain('sw.js');
            }
            await expect(page.getByRole('status')).toContainText('新しい版の準備を完了できない');
            await expect(page.getByRole('button', { name: '新しいアプリ版を適用', exact: true, includeHidden: true })).toHaveCount(0);
            const retry = page.getByRole('button', { name: 'オフライン・更新の準備を再試行', exact: true });
            await expect(retry).toBeVisible();
            const version = page.waitForResponse(response => response.url() === `${server.baseURL}app-version.json` && response.status() === 200);
            await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
            await (await version).finished();
            await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
            await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.installing?.state ?? 'none')).toBe('none');
            await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
            await expect(page.getByRole('status')).toContainText('新しい版の準備を完了できない');
            await expect(retry).toBeVisible();
            await expect(page.getByRole('button', { name: '新しいアプリ版を適用', exact: true, includeHidden: true })).toHaveCount(0);
            const state = await page.evaluate(async () => {
                const registration = await navigator.serviceWorker.getRegistration();
                return { active: registration?.active?.state, waiting: registration?.waiting?.state ?? 'none', caches: await caches.keys() };
            });
            expect(state.active).toBe('activated'); expect(state.waiting).toBe('none');
            expect(state.caches.some(name => name.endsWith(server.nextVersion))).toBe(false);
            expect(state.caches.filter(name => name.includes(':static:'))).toHaveLength(1);
            expect(await databaseSnapshot(page)).toEqual(beforeDatabase);
            server.repairInstall(); await retry.click();
            await expect(page.getByRole('button', { name: '新しいアプリ版を適用', exact: true })).toBeVisible();
            await expect(retry).toHaveCount(0);
            expect(await databaseSnapshot(page)).toEqual(beforeDatabase);
            await context.setOffline(true); await page.reload(); await ready(page);
            expect(await page.locator('script[type=module][src]').getAttribute('src')).toBe(oldScript);
            expect(await storedRows(page, 'users')).toEqual(before);
            await page.getByRole('button', { name: 'クイズを開始', exact: true }).click();
            await expect(page.getByRole('button', { name: '分からない', exact: true })).toBeVisible();
        } finally { await server.close(); }
    });
}

for (const failure of ['integrity', 'worker404'] as const) {
test(`初回の${failure === 'integrity' ? 'install整合性検査' : 'register取得'}失敗を表示し、オンライン利用と保存データを保持して再試行できる`, async ({ page }) => {
    const server = await versionServer();
    try {
        if (failure === 'integrity') server.breakInstall();
        else { server.publish(); server.denyAsset('sw.js'); }
        await page.goto(server.baseURL);
        await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeEnabled();
        await expect(page.getByRole('status')).toContainText('オフライン用の準備を完了できない');
        await expect(page.getByRole('button', { name: '新しいアプリ版を適用', exact: true, includeHidden: true })).toHaveCount(0);
        const before = await storedRows(page, 'users');
        const failed = await page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            return { active: registration?.active?.state ?? 'none', waiting: registration?.waiting?.state ?? 'none', caches: await caches.keys() };
        });
        expect(failed.active).toBe('none'); expect(failed.waiting).toBe('none');
        expect(failed.caches.some(name => name.endsWith(server.nextVersion))).toBe(false);
        await page.getByRole('button', { name: 'クイズを開始', exact: true }).click();
        await expect(page.getByRole('button', { name: '分からない', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '中断して結果を見る', exact: true }).click();
        await page.getByRole('button', { name: 'メニューへ', exact: true }).click();
        server.repairInstall();
        await page.getByRole('button', { name: 'オフライン・更新の準備を再試行', exact: true }).click();
        await ready(page);
        await expect(page.getByRole('status')).toContainText('オフライン用の準備が完了した');
        await expect(page.getByRole('button', { name: 'オフライン・更新の準備を再試行', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: '新しいアプリ版を適用', exact: true, includeHidden: true })).toHaveCount(0);
        expect(await storedRows(page, 'users')).toEqual(before);
    } finally { await server.close(); }
});
}

test('旧hashed editor資産がcacheにも配信元にも無ければ理由を表示してメニューを使い続ける', async ({ page }) => {
    const server = await versionServer();
    try {
        await page.goto(server.baseURL); await ready(page);
        const oldScript = await page.locator('script[type=module][src]').getAttribute('src');
        const updater = await page.context().newPage();
        await updater.goto(server.baseURL); await ready(updater);
        server.publish(); await waiting(updater);
        const apply = updater.getByRole('button', { name: '新しいアプリ版を適用', exact: true, includeHidden: true });
        await expect(apply).toBeAttached();
        await expect(apply).toBeVisible();
        await Promise.all([updater.waitForEvent('load'), apply.click()]); await ready(updater);
        expect(await updater.locator('script[type=module][src]').getAttribute('src')).not.toBe(oldScript);
        expect(await page.locator('script[type=module][src]').getAttribute('src')).toBe(oldScript);
        server.denyAsset(server.editorAsset);
        const removed = await page.evaluate(async asset => {
            const url = new URL(asset, location.href).href;
            let removed = false;
            for (const name of await caches.keys()) removed = await (await caches.open(name)).delete(url, { ignoreVary: true }) || removed;
            return removed;
        }, server.editorAsset);
        expect(removed).toBe(true);
        await page.getByRole('button', { name: '草稿を編集', exact: true }).click();
        await expect(page.getByRole('status').filter({ hasText: '編集器を読み込めない' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeEnabled();
        await expect(page.locator('.monaco-editor')).toHaveCount(0);
        expect(server.requests).toContain(server.editorAsset);
        await page.getByRole('button', { name: 'クイズを開始', exact: true }).click();
        await expect(page.getByRole('button', { name: '分からない', exact: true })).toBeVisible();
        // 新版workerのindexから開き直せば、新しいhashの編集器を取得できる。
        await page.reload(); await ready(page);
        await page.getByRole('button', { name: '草稿を編集', exact: true }).click();
        await expect(page.locator('.monaco-editor').first()).toBeVisible();
    } finally { await server.close(); }
});

test('native IndexedDBのschema1をschema2へ更新してもユーザーと草稿を保持する', async ({ page }) => {
    const server = await versionServer();
    try {
        // 同originのJSON文書で旧DBを作り、アプリ初期化前の実upgradeを試験する。
        await page.goto(`${server.baseURL}app-version.json`);
        const text = draftJson('schema1から保持した題庫');
        await page.evaluate(text => new Promise<void>((resolve, reject) => {
            const open = indexedDB.open('bem130-quiz-web-v1', 1);
            open.onupgradeneeded = () => {
                for (const store of ['users', 'drafts', 'packages', 'attempts', 'sessions', 'schedule', 'confusion', 'conceptStats', 'settings']) open.result.createObjectStore(store, { keyPath: 'id' });
            };
            open.onerror = () => reject(new Error('schema1 open failed'));
            open.onsuccess = () => {
                const database = open.result;
                const transaction = database.transaction(['users', 'drafts', 'settings'], 'readwrite');
                transaction.objectStore('users').put({ id: 'previous-user', name: 'schema1利用者', createdAt: 0 });
                transaction.objectStore('drafts').put({ id: 'retained.json', text, updatedAt: 0, version: 37 });
                transaction.objectStore('settings').put({ id: 'activeUserId', value: 'previous-user' });
                transaction.oncomplete = () => { database.close(); resolve(); };
                transaction.onabort = () => { database.close(); reject(new Error('schema1 fixture failed')); };
            };
        }), text);
        await page.goto(server.baseURL); await ready(page);
        const upgraded = await page.evaluate(() => new Promise<Readonly<{ version: number; stores: string[] }>>((resolve, reject) => {
            const open = indexedDB.open('bem130-quiz-web-v1');
            open.onerror = () => reject(new Error('upgraded open failed'));
            open.onsuccess = () => { const database = open.result; resolve({ version: database.version, stores: Array.from(database.objectStoreNames) }); database.close(); };
        }));
        expect(upgraded.version).toBe(2); expect(upgraded.stores).toContain('assets');
        expect(await storedRows(page, 'users')).toEqual([{ id: 'previous-user', name: 'schema1利用者', createdAt: 0 }]);
        expect(await storedRows(page, 'drafts')).toEqual([{ id: 'retained.json', text, updatedAt: 0, version: 37 }]);
        await page.getByRole('button', { name: '草稿を編集', exact: true }).click();
        await page.getByRole('button', { name: 'retained.json', exact: true }).click();
        await expect(page.getByLabel('問題プレビュー', { exact: true })).toContainText('schema1から保持した題庫');
    } finally { await server.close(); }
});
