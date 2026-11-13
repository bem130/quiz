import assert from 'node:assert/strict';
import test from 'node:test';
import { parseQuizJson } from '../../src/core/schema.ts';
import { answerPreviewEnabled } from '../../src/web/answer-preview.ts';

for (const display of ['inline', 'none']) {
    for (const mode of ['choice_from_entities', 'choice_from_field']) {
        await test(`${mode} / ${display} の選択肢対応表示`, () => {
            const parsed = parseQuizJson(JSON.stringify({ version: 3, title: '対応', description: '対応の表示条件',
                table: [{ id: 'a', name: 'A', choices: [['A'], ['B']] }, { id: 'b', name: 'B', choices: [['A'], ['B']] }],
                patterns: [{ id: 'p', tokens: [{ type: 'hide', id: 'answer', display,
                    value: [{ type: 'key', field: 'name' }], answer: { mode, ...(mode === 'choice_from_field' ? { field: 'choices' } : {}) } }] }] }));
            assert.ok(parsed.ok);
            const pattern = parsed.value.patterns.at(0); assert.ok(pattern);
            assert.equal(answerPreviewEnabled(pattern), display === 'inline' || mode === 'choice_from_entities');
        });
    }
}
