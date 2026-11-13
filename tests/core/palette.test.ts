import assert from 'node:assert/strict';
import test from 'node:test';
import { parseQuizJson, quizToJson, serializeQuiz } from '../../src/core/schema.ts';

const base = {
    version: 3, title: 'パレット', description: 'パレットの検証',
    table: [{ id: 'a', name: 'A' }],
    patterns: [{ id: 'p', label: 'P', description: '', tokens: [{ type: 'key', field: 'name' },
        { type: 'hide', id: 'answer', value: [{ type: 'key', field: 'name' }], answer: { mode: 'choice_from_entities' } }], tips: [] }]
};
const withPalette = (palette: unknown): string => JSON.stringify({ ...base, palette });

await test('パレットは任意であり、定義した色だけを保持する', () => {
    const parsed = parseQuizJson(withPalette({ ink: { light: '#112233', dark: '#ddeeff' }, accent: { dark: '#fedcba' } }));
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value.palette, { ink: { light: '#112233', dark: '#ddeeff' }, accent: { dark: '#fedcba' } });
    const json = quizToJson(parsed.value);
    assert.deepEqual(json['palette'], { accent: { dark: '#fedcba' }, ink: { light: '#112233', dark: '#ddeeff' } });
    assert.doesNotThrow(() => serializeQuiz(parsed.value));
});

await test('パレットがない問題は従来どおり解釈され、出力にも含まれない', () => {
    const parsed = parseQuizJson(JSON.stringify(base));
    assert.ok(parsed.ok);
    assert.equal(parsed.value.palette, undefined);
    assert.equal('palette' in quizToJson(parsed.value), false);
});

for (const [name, palette] of [
    ['CSS色名と同名のトークン', { red: { light: '#111111' } }],
    ['大文字を含むトークン', { Ink: { light: '#111111' } }],
    ['色を持たないトークン', { ink: {} }],
    ['未知のテーマキー', { ink: { sepia: '#111111' } }],
    ['参照形式の色', { ink: { light: 'url(#x)' } }],
    ['currentColor', { ink: { light: 'currentColor' } }]
] as const) {
    await test(`不正なパレットを拒否する: ${name}`, () => {
        const parsed = parseQuizJson(withPalette(palette));
        assert.equal(parsed.ok, false);
    });
}
