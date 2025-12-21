import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QuizEngine } from '../js/quiz-engine.js';
import { optionToText, tokensToPlainText } from '../js/text-utils.js';

function buildDefinition(tableData, patterns) {
    return {
        meta: { id: 'test', title: 'Test Quiz', description: 'Test' },
        dataSets: {
            table: {
                type: 'table',
                data: tableData
            }
        },
        patterns,
        modes: [
            {
                id: 'm1',
                label: 'Mode',
                patternWeights: patterns.map((p) => ({ patternId: p.id, weight: 1 }))
            }
        ]
    };
}

test('QuizEngine generates table_fill_choice with 4 options', () => {
    const data = [
        { id: 'r1', name: 'Alpha' },
        { id: 'r2', name: 'Beta' },
        { id: 'r3', name: 'Gamma' },
        { id: 'r4', name: 'Delta' }
    ];
    const patterns = [
        {
            id: 'p1',
            dataSet: 'table',
            tokens: [
                'Name: ',
                {
                    type: 'hide',
                    id: 'h1',
                    value: [{ type: 'key', field: 'name' }],
                    answer: { mode: 'choice_from_entities' }
                }
            ]
        }
    ];

    const engine = new QuizEngine(buildDefinition(data, patterns));
    engine.setMode('m1');
    const question = engine.generateQuestion();

    assert.equal(question.format, 'table_fill_choice');
    assert.equal(question.patternId, 'p1');
    assert.equal(question.answers.length, 1);
    assert.equal(question.answers[0].options.length, 4);
});

test('QuizEngine falls back to 2 choices when only two rows exist', () => {
    const data = [
        { id: 'r1', name: 'Alpha' },
        { id: 'r2', name: 'Beta' }
    ];
    const patterns = [
        {
            id: 'p1',
            dataSet: 'table',
            tokens: [
                'Pick: ',
                {
                    type: 'hide',
                    id: 'h1',
                    value: [{ type: 'key', field: 'name' }],
                    answer: { mode: 'choice_from_entities' }
                }
            ]
        }
    ];

    const engine = new QuizEngine(buildDefinition(data, patterns));
    engine.setMode('m1');
    const question = engine.generateQuestion();

    assert.equal(question.answers[0].options.length, 2);
});

test('QuizEngine listkey answers avoid correct set in distractors', () => {
    const data = [
        {
            id: 'set1',
            conditionTokens: ['x^2 = 4'],
            answersTokens: [['-2'], ['2']]
        },
        {
            id: 'set2',
            conditionTokens: ['x^2 = 9'],
            answersTokens: [['-3'], ['3']]
        },
        {
            id: 'set3',
            conditionTokens: ['x^2 = 16'],
            answersTokens: [['-4'], ['4']]
        },
        {
            id: 'set4',
            conditionTokens: ['x^2 = 1'],
            answersTokens: [['-1'], ['1']]
        }
    ];
    const patterns = [
        {
            id: 'p1',
            dataSet: 'table',
            tokens: [
                { type: 'key', field: 'conditionTokens' },
                {
                    type: 'hide',
                    id: 'h1',
                    value: [{ type: 'listkey', field: 'answersTokens' }],
                    answer: { mode: 'choice_from_entities' }
                }
            ]
        }
    ];

    const engine = new QuizEngine(buildDefinition(data, patterns));
    engine.setMode('m1');
    const question = engine.generateQuestion();
    const answer = question.answers[0];

    const correctRow = data.find((row) => row.id === answer.meta.correctRowId);
    const correctSet = new Set(
        correctRow.answersTokens.map((tokens) => tokensToPlainText(tokens, correctRow))
    );

    const optionTexts = answer.options.map((opt) =>
        optionToText(opt, { table: { type: 'table', data } }, question)
    );

    assert.ok(correctSet.has(optionTexts[answer.correctIndex]));
    optionTexts.forEach((text, idx) => {
        if (idx === answer.correctIndex) return;
        assert.ok(!correctSet.has(text));
    });
});

test('estimateModeCapacity counts each pattern once per mode', () => {
    const data = [
        { id: 'r1', value: 'Alpha' },
        { id: 'r2', value: 'Beta' },
        { id: 'r3', value: 'Gamma' }
    ];
    const patterns = [
        {
            id: 'p1',
            dataSet: 'table',
            tokens: []
        }
    ];
    const definition = buildDefinition(data, patterns);

    const engine = new QuizEngine(definition);
    assert.equal(engine.getPatternCapacity('p1'), 3);
    assert.equal(engine.estimateModeCapacity('m1'), 3);
});
