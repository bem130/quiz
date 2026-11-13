import { expect, test } from '@playwright/test';

test('SVGパレットのトークンはテーマで切り替わる', async ({ page }) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><rect width="120" height="60" fill="paper"/><path d="M10 50 L60 10 L110 50 Z" fill="accent" stroke="ink" stroke-width="3"/><text x="60" y="35" fill="ink" text-anchor="middle">図</text></svg>`;
    const body = JSON.stringify({ version: 3, title: 'パレット図', description: 'トークンで描く図',
        palette: { ink: { light: '#112233', dark: '#ddeeff' }, accent: { light: '#445566', dark: '#fedcba' }, paper: { light: '#ffffff', dark: '#202830' } },
        table: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), figure: [{ type: 'svg', value: svg, alt: 'パレット図' }] })),
        patterns: [{ id: 'p', tokens: [{ type: 'key', field: 'figure' },
            { type: 'hide', id: 'answer', display: 'none', value: [{ type: 'key', field: 'name' }], answer: { mode: 'choice_from_entities' } }] }] });
    await page.route('**/quiz/entry.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 3, label: 'パレット', files: ['./palette.json'] }) }));
    await page.route('**/quiz/palette.json', route => route.fulfill({ contentType: 'application/json', body }));
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'クイズを開始', exact: true }).click();
    const figure = page.locator('.question-text svg');
    await expect(figure).toHaveCount(1);
    await expect(figure).toHaveClass(/quiz-svg-palette/);
    const fills = async (): Promise<readonly (string | null)[]> => figure.evaluate((node) => [
        getComputedStyle(node.querySelector('rect') as SVGElement).fill,
        getComputedStyle(node.querySelector('path') as SVGElement).fill,
        getComputedStyle(node.querySelector('path') as SVGElement).stroke,
        getComputedStyle(node).backgroundColor
    ]);
    expect(await fills()).toEqual(['rgb(255, 255, 255)', 'rgb(68, 85, 102)', 'rgb(17, 34, 51)', 'rgba(0, 0, 0, 0)']);
    await page.getByRole('button', { name: 'ダークテーマ' }).click();
    expect(await fills()).toEqual(['rgb(32, 40, 48)', 'rgb(254, 220, 186)', 'rgb(221, 238, 255)', 'rgba(0, 0, 0, 0)']);
});
