import { expect, test } from '@playwright/test';

test('entry由来の題庫をメニューから削除でき、再読込で戻せる', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('./');
    const cards = page.locator('fieldset.quiz-card');
    await expect(cards).toHaveCount(3);
    const svgCard = cards.filter({ has: page.locator('legend', { hasText: 'SVG図形のサンプル' }) });
    await expect(svgCard).toHaveCount(1);
    await svgCard.getByRole('button', { name: 'この題庫を削除', exact: true }).click();
    await expect(cards).toHaveCount(2);
    await expect(svgCard).toHaveCount(0);
    await page.reload();
    await expect(cards).toHaveCount(2);
    await page.waitForTimeout(3000);
    await expect(cards).toHaveCount(2);
    await expect(svgCard).toHaveCount(0);
    await page.locator('summary').filter({ hasText: 'ユーザー・表示・問題一覧' }).click();
    await page.getByRole('button', { name: 'サンプルを再読込', exact: true }).click();
    await expect(cards).toHaveCount(3);
    await expect(svgCard).toHaveCount(1);
});
