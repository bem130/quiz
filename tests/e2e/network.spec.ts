import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

let server: Server;
let origin = '';
const observed: string[] = [];

test.beforeAll(async () => {
    const quiz = await readFile(new URL('../../data/sample/math-v3.json', import.meta.url), 'utf8');
    server = createServer((request, response) => {
        const route = request.url ?? '';
        observed.push(`${route} ${request.headers.origin ?? ''}`);
        if (!route.startsWith('/denied/')) response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5173');
        if (route === '/redirect') {
            response.writeHead(302, { Location: '/allowed/entry.json' }); response.end(); return;
        }
        if (route.endsWith('/entry.json')) {
            response.setHeader('Content-Type', 'application/json;charset=utf-8');
            response.end(JSON.stringify({ version: 3, label: 'CORS検証', files: [route.startsWith('/partial/') ? '../denied/data.json' : './data.json'] })); return;
        }
        if (route.endsWith('/data.json')) {
            response.setHeader('Content-Type', 'application/json;charset=utf-8'); response.end(quiz); return;
        }
        response.setHeader('Content-Type', 'text/html;charset=utf-8'); response.end('<html><body>JSONではない応答</body></html>');
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('検証用HTTPサーバーのportを取得できない。');
    origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

test.beforeEach(async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeEnabled();
    await page.locator('summary').filter({ hasText: 'ユーザー・表示・問題一覧' }).click();
});

test('別originの実HTTP redirectとentry・題庫JSONのCORS許可を確認する', async ({ page }) => {
    await page.getByRole('textbox', { name: '問題一覧のURL' }).fill(`${origin}/redirect`);
    await page.getByRole('button', { name: '問題一覧を読み込む', exact: true }).click();
    await expect(page.locator('.quiz-card').filter({ hasText: `${origin}/allowed/data.json` })).toBeVisible();
    expect(observed.some(value => value === '/allowed/entry.json http://127.0.0.1:5173')).toBe(true);
    expect(observed.some(value => value === '/allowed/data.json http://127.0.0.1:5173')).toBe(true);
});

for (const [route, notice] of [
    ['/denied/entry.json', '問題一覧を取得できない'],
    ['/partial/entry.json', '1ファイルを取得・検証できなかった'],
    ['/html', 'entryの形式が不正']
] as const) {
    test(`実HTTP ${route}の失敗を空題庫と混同せず保存済み題庫を保持する`, async ({ page }) => {
        const before = await page.locator('.quiz-card').count();
        await page.getByRole('textbox', { name: '問題一覧のURL' }).fill(origin + route);
        await page.getByRole('button', { name: '問題一覧を読み込む', exact: true }).click();
        await expect(page.getByRole('status')).toContainText(notice);
        await expect(page.locator('.quiz-card')).toHaveCount(before);
        await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeEnabled();
    });
}
