import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { packageIdentity, patternId } from '../../src/core/identity.ts';
import { parseQuizJson } from '../../src/core/schema.ts';

// npm build済みdistをpreviewが実HTTP配信する。外部entryも別portの実HTTPで、route mockは使わない。
let external: Server; let externalOrigin = '';
const mathPath = '/quiz/share/data/sample/math-v3.html';
const externalQuiz = JSON.stringify({ version: 3, title: '外部共有の題庫', description: 'rootへのfallback',
    table: [{ id: 'a', term: 'A' }, { id: 'b', term: 'B' }],
    patterns: [{ id: 'p', tokens: [{ type: 'hide', id: 'h', value: [{ type: 'key', field: 'term' }], answer: { mode: 'choice_from_entities' } }] }] });
test.beforeAll(async () => {
    external = createServer((request, response) => {
        response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Content-Type', 'application/json;charset=utf-8');
        if (request.url === '/entry.json') response.end(JSON.stringify({ version: 3, files: ['./quiz.json'] }));
        else if (request.url === '/quiz.json') response.end(externalQuiz);
        else { response.statusCode = 404; response.end('{}'); }
    });
    await new Promise<void>((resolve, reject) => { external.once('error', reject); external.listen(0, '127.0.0.1', resolve); });
    const address = external.address(); if (!address || typeof address === 'string') throw new Error('外部fixtureを起動できない');
    externalOrigin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => external.close(error => error ? reject(error) : resolve())); });

async function mathIds(base: string): Promise<readonly string[]> {
    const quiz = parseQuizJson(await readFile('data/sample/math-v3.json', 'utf8'));
    const id = packageIdentity({ kind: 'remote', url: new URL('/quiz/data/sample/math-v3.json', base).href });
    if (!quiz.ok || !id.ok) throw new Error('sampleが不正');
    return quiz.value.patterns.map(pattern => patternId(id.value, pattern.id));
}
async function ready(page: Page): Promise<void> {
    await expect(page.locator('.quiz-card')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'サンプルを再読込', exact: true, includeHidden: true })).toBeEnabled();
}
async function checked(page: Page): Promise<number> {
    return page.locator('.quiz-card input[type=checkbox]').evaluateAll(nodes => nodes.filter(node => node instanceof HTMLInputElement && node.checked).length);
}
async function share(page: Page): Promise<string> {
    await page.getByRole('button', { name: '共有URL・QRを表示', exact: true }).click();
    const value = await page.getByLabel('共有URL', { exact: true }).inputValue();
    await expect(page.getByRole('img', { name: '共有URLのQRコード', exact: true })).toHaveAttribute('src', /^data:image\/png/u);
    await page.getByRole('button', { name: '共有を閉じる', exact: true }).click(); return value;
}

test('個別HTMLのmetadataとbaseを実HTTPで取得し、直開きでその題庫だけを選ぶ', async ({ page, baseURL }) => {
    if (!baseURL) throw new Error('baseURLなし');
    const response = await page.request.get(new URL(mathPath, baseURL).href);
    expect(response.status()).toBe(200); expect(response.headers()['content-type']).toContain('text/html');
    const html = await response.text(); expect(html).toContain('<base href="/quiz/">');
    expect(html).toContain('name="quiz-share-pages"'); expect(html).toContain('property="og:url"');
    expect(html).toContain('https://bem130.com/quiz/ogp-card.php?title=');
    await page.goto(mathPath); await ready(page);
    const ids = await mathIds(page.url()); expect(await checked(page)).toBe(ids.length);
    const math = page.locator('.quiz-card').filter({ hasText: '/data/sample/math-v3.json' });
    expect(await math.getByRole('checkbox').evaluateAll(nodes => nodes.every(node => node instanceof HTMLInputElement && node.checked))).toBe(true);
    expect(await page.title()).toContain('数学');
    const shared = new URL(await share(page)); expect(shared.pathname).toBe(mathPath);
    expect(JSON.parse(shared.searchParams.get('scope') ?? 'null')).toEqual(ids);
    expect(JSON.parse(shared.searchParams.get('entries') ?? 'null')).toEqual([new URL('/quiz/entry.json', baseURL).href]);
});

test('個別題庫のsubsetはコピー・QR・再共有でも同じpathと範囲を保持する', async ({ page, browser, baseURL }) => {
    if (!baseURL) throw new Error('baseURLなし');
    const ids = await mathIds(baseURL); const subset = ids.slice(0, 1);
    await page.goto(`${mathPath}?${new URLSearchParams({ scope: JSON.stringify(subset) })}`); await ready(page);
    expect(await checked(page)).toBe(1);
    const first = await share(page); expect(new URL(first).pathname).toBe(mathPath);
    expect(JSON.parse(new URL(first).searchParams.get('scope') ?? 'null')).toEqual(subset);
    expect(JSON.parse(new URL(first).searchParams.get('entries') ?? 'null')).toEqual([new URL('/quiz/entry.json', baseURL).href]);
    const clean = await browser.newContext();
    try {
        const next = await clean.newPage(); await next.goto(first); await ready(next); expect(await checked(next)).toBe(1);
        const second = await share(next); expect(second).toBe(first);
    } finally { await clean.close(); }
});

test('他題庫scopeは理由を示して個別既定を保持し、manual外部読込と混合共有はrootへ正規化する', async ({ page, baseURL }) => {
    if (!baseURL) throw new Error('baseURLなし');
    const foreign = packageIdentity({ kind: 'remote', url: new URL('/quiz/data/sample/svg-v3.json', baseURL).href });
    const svg = parseQuizJson(await readFile('data/sample/svg-v3.json', 'utf8')); const svgPattern = svg.ok ? svg.value.patterns.at(0) : undefined;
    if (!foreign.ok || svgPattern === undefined) throw new Error('source不正');
    await page.goto(`${mathPath}?${new URLSearchParams({ scope: JSON.stringify([patternId(foreign.value, svgPattern.id)]) })}`); await ready(page);
    expect(await checked(page)).toBe((await mathIds(baseURL)).length);
    await expect(page.getByRole('alert')).toContainText('scopeに利用できないpattern');
    await page.getByText('ユーザー・表示・問題一覧', { exact: true }).click();
    await page.getByLabel('問題一覧のURL', { exact: true }).fill(`${externalOrigin}/entry.json`);
    await page.getByRole('button', { name: '問題一覧を読み込む', exact: true }).click();
    await expect(page.locator('.quiz-card')).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'サンプルを再読込', exact: true, includeHidden: true })).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe('/quiz/'); expect(new URL(page.url()).searchParams.has('scope')).toBe(false);
    expect(await checked(page)).toBe(1);
    const outside = new URL(await share(page)); expect(outside.pathname).toBe('/quiz/');
    expect(JSON.parse(outside.searchParams.get('entries') ?? 'null')).toContain(`${externalOrigin}/entry.json`);
    await page.reload(); await expect(page.locator('.quiz-card')).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'サンプルを再読込', exact: true, includeHidden: true })).toBeEnabled(); expect(await checked(page)).toBe(1);
    await page.locator('.quiz-card').filter({ hasText: '/data/sample/math-v3.json' }).getByRole('checkbox').first().check();
    const mixed = new URL(await share(page)); expect(mixed.pathname).toBe('/quiz/');
    expect(JSON.parse(mixed.searchParams.get('scope') ?? 'null')).toHaveLength(2);
    await page.locator('details').filter({ hasText: 'フォルダから範囲を選択' }).locator('summary').click();
    const folder = page.locator('details').filter({ hasText: 'フォルダから範囲を選択' }).locator('p').filter({ hasText: `${externalOrigin}/` });
    await folder.getByRole('button', { name: 'このフォルダを共有', exact: true }).click();
    expect(new URL(await page.getByLabel('共有URL', { exact: true }).inputValue()).pathname).toBe('/quiz/');
});

test('個別pageのoffline再openでも固有headとsubsetを保ちrootへ化けない', async ({ page, context, baseURL }) => {
    if (!baseURL) throw new Error('baseURLなし');
    const subset = (await mathIds(baseURL)).slice(0, 1);
    const target = `${mathPath}?${new URLSearchParams({ scope: JSON.stringify(subset) })}`;
    await page.goto(target); await ready(page); const title = await page.title();
    const canonical = await page.locator('link[rel=canonical]').getAttribute('href');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true); await page.reload(); await ready(page);
    expect(await page.title()).toBe(title); expect(await page.locator('link[rel=canonical]').getAttribute('href')).toBe(canonical);
    expect(new URL(page.url()).pathname).toBe(mathPath); expect(await checked(page)).toBe(1);
    expect(JSON.parse(new URL(await share(page)).searchParams.get('scope') ?? 'null')).toEqual(subset);
});
