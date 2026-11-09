import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { packageIdentity, patternId } from '../../src/core/identity.ts';

// 外部entry/題庫は別portの実HTTP。既定題庫だけをroute制御して容量を固定する。
let server: Server; let origin = '';
function quiz(title: string): string {
    return JSON.stringify({ version: 3, title, description: '共有範囲を保持する', table: [{ id: 'a', text: 'A', alt: '一' }, { id: 'b', text: 'B', alt: '二' }, { id: 'c', text: 'C', alt: '三' }],
        patterns: ['p', 'q'].map((id) => ({ id, tokens: [{ type: 'hide', id: 'h', value: [{ type: 'key', field: id === 'p' ? 'text' : 'alt' }], answer: { mode: 'choice_from_entities' } }] })) });
}
function scoped(file: string, local: string): string {
    const source = packageIdentity({ kind: 'remote', url: origin + file }); if (!source.ok) throw new Error(source.error.detail);
    return patternId(source.value, local);
}
async function defaults(target: Page | BrowserContext): Promise<void> {
    await target.route('**/quiz/entry.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 3, label: '既定', files: ['./shared-default.json'] }) }));
    await target.route('**/quiz/shared-default.json', (route) => route.fulfill({ contentType: 'application/json', body: quiz('既定の正常題庫') }));
}
test.beforeAll(async () => {
    server = createServer((request, response) => {
        response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5173');
        response.setHeader('Content-Type', 'application/json;charset=utf-8');
        if (request.url === '/one/entry.json' || request.url === '/two/entry.json') response.end(JSON.stringify({ version: 3, label: request.url, files: ['./quiz.json'] }));
        else if (request.url === '/one/quiz.json' || request.url === '/two/quiz.json') response.end(quiz(request.url));
        else { response.statusCode = 404; response.end('{}'); }
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('HTTP fixtureを起動できない');
    origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

test('外部entryの1pattern scopeをclean起動で復元し、中断の1クリックで結果へ進む', async ({ page }) => {
    await defaults(page);
    const scope = [scoped('/one/quiz.json', 'p')];
    const query = new URLSearchParams({ entry: origin + '/one/entry.json', scope: JSON.stringify(scope) });
    await page.goto(`./?${query.toString()}`);
    await expect(page.getByText('選択範囲: 3問', { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('scope')).toBe(JSON.stringify(scope));
    await page.getByRole('button', { name: 'クイズを開始', exact: true }).click();
    await expect(page.locator('.question-text')).toBeVisible();
    await page.getByRole('button', { name: '中断して結果を見る', exact: true }).click();
    await expect(page.getByRole('heading', { name: '結果', exact: true })).toBeVisible();
});

test('2entryのsubsetは再共有しても参照を失わず別clean contextで同じ範囲になる', async ({ page, browser }) => {
    await defaults(page);
    const entries = [origin + '/one/entry.json', origin + '/two/entry.json'];
    const scope = [scoped('/one/quiz.json', 'p'), scoped('/two/quiz.json', 'q')];
    await page.goto(`./?${new URLSearchParams({ entries: JSON.stringify(entries), scope: JSON.stringify(scope) }).toString()}`);
    await expect(page.getByText('選択範囲: 6問', { exact: true })).toBeVisible();
    await expect(page.locator('.quiz-card')).toHaveCount(3);
    await page.getByRole('button', { name: '共有URL・QRを表示', exact: true }).click();
    const shared = await page.getByLabel('共有URL', { exact: true }).inputValue();
    expect(new URL(shared).searchParams.get('scope')).toBe(JSON.stringify(scope));
    expect(JSON.parse(new URL(shared).searchParams.get('entries') ?? 'null')).toEqual(entries);
    const clean = await browser.newContext(); try {
        await defaults(clean); const second = await clean.newPage(); await second.goto(shared);
        await expect(second.locator('.quiz-card')).toHaveCount(3);
        await expect(second.getByText('選択範囲: 6問', { exact: true })).toBeVisible();
        await expect(second.getByRole('checkbox')).toHaveCount(6);
        expect(await second.getByRole('checkbox').evaluateAll((boxes) => boxes.filter((box) => box instanceof HTMLInputElement && box.checked).length)).toBe(2);
        await expect(second.locator('.quiz-card').filter({ hasText: origin + '/one/quiz.json' }).getByRole('checkbox').nth(0)).toBeChecked();
        await expect(second.locator('.quiz-card').filter({ hasText: origin + '/one/quiz.json' }).getByRole('checkbox').nth(1)).not.toBeChecked();
        await expect(second.locator('.quiz-card').filter({ hasText: origin + '/two/quiz.json' }).getByRole('checkbox').nth(1)).toBeChecked();
        await expect(second.locator('.quiz-card').filter({ hasText: origin + '/two/quiz.json' }).getByRole('checkbox').nth(0)).not.toBeChecked();
    } finally { await clean.close(); }
});

test('scope無しの複数shared entryは成功候補だけを集約し既定範囲と混在しない', async ({ page }) => {
    await defaults(page);
    const entries = [origin + '/one/entry.json', origin + '/two/entry.json'];
    await page.goto(`./?${new URLSearchParams({ entries: JSON.stringify(entries) }).toString()}`);
    await expect(page.locator('.quiz-card')).toHaveCount(3);
    await expect(page.getByText('選択範囲: 12問', { exact: true })).toBeVisible();
    await expect(page.locator('.quiz-card').filter({ hasText: '既定の正常題庫' }).getByRole('checkbox').nth(0)).not.toBeChecked();
});

for (const [input, notice] of [['{', 'scopeが不正なJSON'], ['{}', 'scopeはpattern IDの配列'], ['[1]', 'scopeに不正なpattern ID'], ['missing', 'scopeに利用できないpattern']] as const) {
    test(`不正scope ${input} は理由を示して既定の正常範囲を保持する`, async ({ page }) => {
        await defaults(page);
        const scope = input === 'missing' ? JSON.stringify([scoped('/one/quiz.json', 'missing')]) : input;
        await page.goto(`./?${new URLSearchParams({ scope }).toString()}`);
        await expect(page.getByRole('status')).toContainText(notice);
        await expect(page.getByRole('alert')).toContainText(notice);
        await expect(page.getByText('選択範囲: 6問', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeEnabled();
    });
}
