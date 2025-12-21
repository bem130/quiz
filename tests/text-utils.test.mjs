import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveQuestionContext, tokensToPlainText } from '../js/text-utils.js';

const sampleDefinition = {
    dataSets: {
        sample: {
            type: 'table',
            data: [
                { id: 'r1', text: 'Alpha', detail: [{ type: 'text', value: 'Detail' }] }
            ]
        }
    }
};

const sampleQuestion = {
    meta: { dataSetId: 'sample', entityId: 'r1' }
};

test('tokensToPlainText flattens hide tokens and line breaks', () => {
    const tokens = [
        { type: 'text', value: 'Line1' },
        { type: 'br' },
        {
            type: 'hide',
            value: [{ type: 'key', field: 'text' }]
        }
    ];
    const text = tokensToPlainText(tokens, sampleDefinition.dataSets.sample.data[0]);
    assert.equal(text, 'Line1\nAlpha');
});

test('resolveQuestionContext finds table row by entityId', () => {
    const row = resolveQuestionContext(sampleQuestion, sampleDefinition.dataSets);
    assert.ok(row);
    assert.equal(row.text, 'Alpha');
});

test('tokensToPlainText expands gloss content with alternates', () => {
    const tokens = [
        {
            type: 'content',
            value: 'A{[Base/Read]/[Alt/AltRead]/Alt2}C'
        }
    ];
    const text = tokensToPlainText(tokens, null);
    assert.equal(text, 'ABase (Alt / Alt2)C');
});

test('tokensToPlainText omits parentheses when gloss has no alternates', () => {
    const tokens = [
        {
            type: 'content',
            value: '{Solo}'
        }
    ];
    const text = tokensToPlainText(tokens, null);
    assert.equal(text, 'Solo');
});
