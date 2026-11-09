import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tokensToText } from '../../src/core/quiz-engine.ts';
import { parseQuiz } from '../../src/core/schema.ts';

function fixture() {
    const parsed = parseQuiz({ version: 3, title: '文字列化', description: '表示と結果出力の共通投影',
        table: [{ id: 'r1', text: '[日本語/にほんご]', items: [['Α'], ['Б'], ['漢字']] }, { id: 'r2', text: '別の答え', items: [['別']] }],
        patterns: [{ id: 'p', tokens: ['Line1', { type: 'br' }, { type: 'hide', id: 'h', value: [{ type: 'key', field: 'text' }], answer: { mode: 'choice_from_entities' } }] }] });
    if (!parsed.ok) assert.fail(JSON.stringify(parsed.error));
    const row = parsed.value.table.at(0); const pattern = parsed.value.patterns.at(0);
    assert.ok(row); assert.ok(pattern);
    return { row, pattern };
}

await test('問題本文のhideと行参照を展開し、改行と多言語の文字を保持する', () => {
    const { row, pattern } = fixture();
    assert.equal(tokensToText(pattern.tokens, row), 'Line1\n日本語');
    assert.equal(tokensToText([{ type: 'listkey', field: 'items', separatorTokens: [','], styles: [] }], row), 'Α,Б,漢字');
});

await test('結果のplainラベルはrubyのbaseとglossの全別訳を保持し、空の括弧を作らない', () => {
    const { row } = fixture();
    assert.equal(tokensToText(['A{[Base/Read]/[Alt/AltRead]/Alt2}C'], row), 'ABase (Alt / Alt2)C');
    assert.equal(tokensToText(['{Solo}'], row), 'Solo');
});

await test('旧questionFormatとhide.answer.choiceCountをschema境界で明示的に拒否する', () => {
    const base = { version: 3, title: 'v3', description: '旧仕様を混在させない',
        table: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] };
    const hide = { type: 'hide', id: 'h', value: [{ type: 'key', field: 'text' }], answer: { mode: 'choice_from_entities' } };
    for (const pattern of [
        { id: 'p', questionFormat: 'table_fill_choice', tokens: [hide] },
        { id: 'p', tokens: [{ ...hide, answer: { ...hide.answer, choiceCount: 4 } }] }
    ]) {
        const parsed = parseQuiz({ ...base, patterns: [pattern] });
        assert.equal(parsed.ok, false);
        if (!parsed.ok) assert.equal(parsed.error.code, 'unsupported-field');
    }
});
