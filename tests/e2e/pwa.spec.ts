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

test('本番buildをprecacheした後はofflineで題庫・図・編集workerを使用できる', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('./'); await ready(page);
    await expect(page.locator('input[type=checkbox]')).toHaveCount(5);
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
    await expect(page.locator('input[type=checkbox]')).toHaveCount(5);
    await page.getByRole('button', { name: '草稿を編集', exact: true }).click();
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('編集器を読み込めない');
    expect(errors).toEqual([]);
});

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
        if (!input.includes(oldVersion)) continue;
        const changed = input.replaceAll(oldVersion, version);
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
async function versionServer(): Promise<Readonly<{ baseURL: string; publish(): void; close(): Promise<void> }>> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'quiz-pwa-update-'));
    const original = path.resolve('dist'); const next = path.join(directory, 'next');
    const oldVersion = versionFrom(JSON.parse(await readFile(path.join(original, 'app-version.json'), 'utf8')));
    await nextVersion(original, next, `${oldVersion}-acceptance-next`);
    let current = original;
    const server = createServer((request, response) => {
        async function serve(): Promise<void> {
            const url = new URL(request.url ?? '/', 'http://127.0.0.1');
            if (!url.pathname.startsWith('/quiz/')) { response.writeHead(404).end(); return; }
            const relative = decodeURIComponent(url.pathname.slice('/quiz/'.length)) || 'index.html';
            const file = path.resolve(current, relative);
            const checked = path.relative(current, file);
            if (checked.startsWith('..') || path.isAbsolute(checked)) { response.writeHead(400).end(); return; }
            try {
                const body = await readFile(file);
                response.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store', Vary: 'Origin' });
                response.end(body);
            } catch { response.writeHead(404).end(); }
        }
        serve().catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address missing');
    return {
        baseURL: `http://127.0.0.1:${address.port}/quiz/`, publish() { current = next; },
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
        await Promise.all([menu.waitForEvent('load'), apply.click()]); await ready(menu);
        expect(await menu.locator('script[type=module][src]').getAttribute('src')).not.toBe(oldScript);
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
    } finally { await context?.close(); await server.close(); }
});
