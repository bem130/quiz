import { expect, test } from '@playwright/test';

for (const setup of [
    { mode: 'choice_from_entities', display: 'none', preview: true },
    { mode: 'choice_from_field', display: 'none', preview: false },
    { mode: 'choice_from_entities', display: 'inline', preview: true }
]) {
    test(`${setup.mode} / ${setup.display}: 各選択肢の行の構造を示す`, async ({ page }) => {
        const labels = ['A', 'B', 'C', 'D'];
        const body = JSON.stringify({ version: 3, title: '構造と名前', description: '行の対応を確認する',
            table: labels.map(label => ({ id: label, name: label, choices: labels.map(value => [value]),
                structure: [{ type: 'svg', value: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><text x="5" y="30">構造${label}</text></svg>`, alt: `構造${label}` }] })),
            patterns: [{ id: 'p', tokens: ['この構造の名前を選べ。', { type: 'key', field: 'structure' },
                { type: 'hide', id: 'answer', display: setup.display, value: [{ type: 'key', field: 'name' }],
                    answer: { mode: setup.mode, ...(setup.mode === 'choice_from_field' ? { field: 'choices' } : {}) } }] }] });
        await page.route('**/quiz/entry.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 3, label: '対応', files: ['./answer-preview.json'] }) }));
        await page.route('**/quiz/answer-preview.json', route => route.fulfill({ contentType: 'application/json', body }));
        await page.goto('./');
        await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: 'クイズを開始', exact: true }).click();
        await expect(page.locator('.choices > button')).toHaveCount(4);
        await expect(page.locator('.question-text .answer-blank')).toHaveCount(setup.display === 'inline' ? 1 : 0);
        await expect(page.locator('.option-preview')).toHaveCount(0);
        await page.locator('.choices > button').first().click();
        await expect(page.getByRole('button', { name: '次の問題', exact: true })).toBeEnabled();
        await expect(page.locator('.option-preview')).toHaveCount(setup.preview ? 4 : 0);
        if (setup.preview) {
            for (const choice of await page.locator('.choices > button').all()) {
                const label = (await choice.locator('.choice-content').textContent())?.trim().slice(-1);
                await expect(choice.locator('.option-preview-body svg text')).toHaveText(`構造${label}`);
            }
        }
        if (setup.display === 'none') await expect(page.locator('.answer-blank')).toHaveCount(0);
    });
}
