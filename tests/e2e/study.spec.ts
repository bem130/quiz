import assert from 'node:assert/strict';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { validateBackup } from '../../src/web/storage/validation.ts';
import type { BackupSnapshot } from '../../src/web/storage/types.ts';
import { STORE_NAMES } from '../../src/web/storage/types.ts';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
    const received: string[] = []; errors.set(page, received);
    page.on('pageerror', error => received.push(error.message));
});
test.afterEach(({ page }) => { expect(errors.get(page) ?? []).toEqual([]); });

function quiz(title = '学習受入題庫', rows = 2, identical = false): string {
    return JSON.stringify({ version: 3, title, description: '小さな学習題庫',
        table: Array.from({ length: rows }, (_, index) => ({ id: `row-${index}`, prompt: `問題${index}`, term: identical ? '解答0' : `解答${index}` })),
        patterns: [{ id: 'p', label: '学習範囲', tokens: [{ type: 'key', field: 'prompt' }, ' → ',
            { type: 'hide', id: 'answer', value: [{ type: 'key', field: 'term' }], answer: { mode: 'choice_from_entities' } }] }] });
}
async function fixture(page: Page): Promise<Readonly<{ set(value: string): void }>> {
    let body = quiz();
    await page.route('**/quiz/entry.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 3, label: '学習受入', files: ['./test-data/study.json'] }) }));
    await page.route('**/quiz/test-data/study.json', route => body === 'network-failure' ? route.abort('failed') : route.fulfill({ contentType: 'application/json', body }));
    return { set(value) { body = value; } };
}
async function open(page: Page, clock = false): Promise<void> {
    // installをnavigation前に行い、ロード完了後にpauseAtする公式手順。
    // https://playwright.dev/docs/clock — OS時計・実機の休止復帰試験とは区別する。
    if (clock) await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') });
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeEnabled();
    await expect(page.getByText('選択範囲: 2問', { exact: true })).toBeVisible();
    if (clock) await page.clock.pauseAt(new Date('2030-01-01T00:00:10Z'));
    await page.getByLabel('学習・テスト', { exact: true }).selectOption('study');
}
async function start(page: Page, count: number): Promise<void> {
    await page.getByLabel('問題数', { exact: true }).fill(String(count));
    await page.getByRole('button', { name: 'クイズを開始', exact: true }).click();
    await expect(page.locator('.question-text')).toBeVisible();
}
async function choose(page: Page, correct: boolean): Promise<void> {
    const text = await page.locator('.question-text').textContent();
    const expected = text?.includes('問題0') ? '解答0' : '解答1';
    const buttons = page.locator('.choices button');
    const answer = correct ? buttons.filter({ hasText: expected }) : buttons.filter({ hasNotText: expected });
    await answer.click();
    await expect(page.getByRole('button', { name: '次の問題', exact: true })).toBeEnabled();
}

/** 全storeを同じnative readonly transactionで読み、commit後の整合した状態を検証する。 */
async function snapshot(page: Page): Promise<BackupSnapshot> {
    const value: unknown = await page.evaluate(names => new Promise<unknown>((resolve, reject) => {
        const opened = indexedDB.open('bem130-quiz-web-v1');
        opened.onerror = () => reject(new Error('IDB open failed'));
        opened.onsuccess = () => {
            const database = opened.result;
            const transaction = database.transaction([...names], 'readonly');
            const records: Record<string, unknown> = {};
            for (const name of names) {
                const request = transaction.objectStore(name).getAll();
                request.onsuccess = () => {
                    const raw: unknown = request.result;
                    records[name] = name === 'settings' && Array.isArray(raw) ? raw.filter((entry: unknown) =>
                        !(typeof entry === 'object' && entry !== null && 'id' in entry &&
                            (entry.id === '__storage-generation' || entry.id === '__draft-version'))) : raw;
                };
            }
            transaction.oncomplete = () => { database.close(); resolve({ format: 'bem130-quiz-backup', version: 2, records }); };
            transaction.onabort = () => { database.close(); reject(new Error('IDB snapshot aborted')); };
        };
    }), STORE_NAMES);
    const validated = validateBackup(value);
    if (!validated.ok) assert.fail(validated.error.message);
    return validated.value;
}

test('時間指定の締切で未回答をtimeoutとして原子的に保存し正常結果へ進む', async ({ page }) => {
    await fixture(page); await open(page, true);
    await page.getByLabel('終了条件', { exact: true }).selectOption('time');
    await page.getByLabel('制限時間（分）', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'クイズを開始', exact: true }).click();
    await expect(page.locator('.question-text')).toBeVisible();
    await page.clock.runFor(59_000);
    expect((await snapshot(page)).records.attempts).toHaveLength(0);
    await page.clock.runFor(1000);
    await expect(page.getByRole('button', { name: '次の問題', exact: true })).toBeEnabled();
    const saved = (await snapshot(page)).records;
    expect(saved.attempts).toHaveLength(1); expect(saved.schedule).toHaveLength(1);
    expect(saved.confusion).toHaveLength(1); expect(saved.conceptStats).toHaveLength(1);
    const attempt = saved.attempts.at(0); const schedule = saved.schedule.at(0);
    assert.ok(attempt && schedule);
    expect(attempt.result).toBe('timeout'); expect(attempt.answerMs).toBe(60_000);
    expect(schedule.questionId).toBe(attempt.questionId); expect(schedule.state).toBe('RELEARNING');
    expect(schedule.lastAnsweredAt).toEqual({ kind: 'some', value: attempt.answeredAt });
    await page.clock.runFor(1000);
    await expect(page.getByRole('heading', { name: '結果', exact: true })).toBeVisible();
    await expect(page.getByText('終了理由: time', { exact: true })).toBeVisible();
    const finished = (await snapshot(page)).records;
    expect(finished.attempts).toHaveLength(1); expect(finished.sessions).toHaveLength(1);
    expect(finished.sessions.at(0)?.summary).toMatchObject({ kind: 'some', value: { answered: 1, correct: 0 } });
});

test('全候補の学習後はdueまで待ち、同じsessionのまま期限到来した問題を再出題する', async ({ page }) => {
    await fixture(page); await open(page, true); await start(page, 3);
    for (let index = 0; index < 2; index += 1) {
        await choose(page, true);
        await page.getByRole('button', { name: '次の問題', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: '次の復習を待っている', exact: true })).toBeVisible();
    const before = (await snapshot(page)).records;
    expect(before.attempts).toHaveLength(2); expect(before.sessions).toHaveLength(1);
    expect(new Set(before.attempts.map(attempt => attempt.questionId)).size).toBe(2);
    expect(before.schedule.every(schedule => schedule.state === 'LEARNING' && schedule.intervalSec === 30)).toBe(true);
    await page.clock.runFor(29_000);
    await expect(page.getByRole('heading', { name: '次の復習を待っている', exact: true })).toBeVisible();
    expect((await snapshot(page)).records.attempts).toHaveLength(2);
    await page.clock.runFor(1000);
    await expect(page.locator('.question-text')).toBeVisible();
    await choose(page, true);
    const repeated = (await snapshot(page)).records;
    expect(repeated.sessions).toHaveLength(1); expect(repeated.attempts).toHaveLength(3);
    const third = repeated.attempts.find(attempt => !before.attempts.some(previous => previous.id === attempt.id)); assert.ok(third);
    expect(third.sessionId).toBe(before.sessions.at(0)?.id);
    expect(before.attempts.some(attempt => attempt.questionId === third.questionId)).toBe(true);
    expect(repeated.schedule.find(schedule => schedule.questionId === third.questionId)?.version).toBe(2);
    await page.getByRole('button', { name: '次の問題', exact: true }).click();
    await expect(page.getByText('終了理由: target', { exact: true })).toBeVisible();
});

test('学習の間違い再挑戦は元sessionを変更せず新しいsessionで直ちに出題する', async ({ page }) => {
    await fixture(page); await open(page, true); await start(page, 1);
    await choose(page, false);
    await page.getByRole('button', { name: '次の問題', exact: true }).click();
    await expect(page.getByRole('heading', { name: '結果', exact: true })).toBeVisible();
    const before = (await snapshot(page)).records;
    expect(before.attempts.at(0)?.result).toBe('wrong');
    await page.getByRole('button', { name: '間違えた問題を再挑戦', exact: true }).click();
    await expect(page.locator('.question-text')).toBeVisible();
    await choose(page, true);
    await page.getByRole('button', { name: '次の問題', exact: true }).click();
    await expect(page.getByRole('heading', { name: '結果', exact: true })).toBeVisible();
    const after = (await snapshot(page)).records;
    expect(after.sessions).toHaveLength(2); expect(after.attempts).toHaveLength(2);
    expect(new Set(after.sessions.map(session => session.id)).size).toBe(2);
    expect(after.sessions.find(session => session.id === before.sessions.at(0)?.id)).toEqual(before.sessions.at(0));
    const retry = after.attempts.find(attempt => attempt.id !== before.attempts.at(0)?.id); assert.ok(retry);
    expect(retry.questionId).toBe(before.attempts.at(0)?.questionId);
    expect(retry.sessionId).not.toBe(before.attempts.at(0)?.sessionId);
    expect(after.sessions.find(session => session.id === retry.sessionId)?.replay.retry).toBe(true);
    expect(after.schedule.find(schedule => schedule.questionId === retry.questionId)?.version).toBe(2);
});

test('同URLの容量増減を再計算し、不正schemaと取得失敗では有効版を保持して回復する', async ({ page }) => {
    const source = await fixture(page); await open(page);
    await page.locator('summary').filter({ hasText: 'ユーザー・表示・問題一覧' }).click();
    const reload = async (): Promise<void> => {
        const summary = page.locator('summary').filter({ hasText: 'ユーザー・表示・問題一覧' });
        if (await summary.locator('..').getAttribute('open') === null) await summary.click();
        await page.getByLabel('問題一覧のURL', { exact: true }).fill(new URL('entry.json', page.url()).href);
        await page.getByRole('button', { name: '問題一覧を読み込む', exact: true }).click();
        await expect(page.getByRole('button', { name: '問題一覧を読み込む', exact: true, includeHidden: true })).toBeEnabled();
    };
    source.set(quiz('容量を増やした題庫', 3)); await reload();
    await expect(page.getByText('選択範囲: 3問', { exact: true })).toBeVisible();
    const updated = (await snapshot(page)).records.packages;
    expect(updated).toHaveLength(1);
    for (const failure of [JSON.stringify({ version: 3, title: '不正な更新', table: 'not-an-array' }), 'network-failure']) {
        source.set(failure); await reload();
        await expect(page.getByRole('status')).toContainText('以前の有効版は保持している');
        expect((await snapshot(page)).records.packages).toEqual(updated);
        await expect(page.getByText('選択範囲: 3問', { exact: true })).toBeVisible();
    }
    source.set(quiz('誤答候補がない題庫', 2, true)); await reload();
    await expect(page.getByText('選択範囲: 0問', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeDisabled();
    source.set(quiz('回復した題庫')); await reload();
    await expect(page.getByText('選択範囲: 2問', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'クイズを開始', exact: true })).toBeEnabled();
    const recovered = (await snapshot(page)).records.packages;
    expect(recovered).toHaveLength(1); expect(recovered.at(0)?.id).toBe(updated.at(0)?.id);
    expect(recovered.at(0)?.revision).not.toBe(updated.at(0)?.revision);
    await start(page, 1); await choose(page, true);
    expect((await snapshot(page)).records.attempts).toHaveLength(1);
});
