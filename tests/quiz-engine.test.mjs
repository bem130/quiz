import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QuizEngine } from '../js/quiz-engine.js';

test('QuizEngine generates sentence_fill_choice from factSentences', () => {
    const definition = {
        meta: { id: 'test', title: 'test' },
        dataSets: {
            facts: {
                type: 'factSentences',
                sentences: [
                    {
                        id: 's1',
                        tokens: [
                            {
                                type: 'hide',
                                value: { type: 'text', value: 'alpha' },
                                answer: { mode: 'choice_from_group', group: 'g1' }
                            }
                        ]
                    }
                ],
                groups: {
                    g1: { choices: ['alpha', 'beta', 'gamma', 'delta'] }
                }
            }
        },
        patterns: [
            {
                id: 'p1',
                dataSet: 'facts',
                questionFormat: 'sentence_fill_choice',
                tokensFromData: 'sentences'
            }
        ],
        modes: [
            { id: 'm1', label: 'Mode', patternWeights: [{ patternId: 'p1', weight: 1 }] }
        ]
    };

    const engine = new QuizEngine(definition);
    engine.setMode('m1');
    const question = engine.generateQuestion();

    assert.equal(question.format, 'sentence_fill_choice');
    assert.equal(question.patternId, 'p1');
    assert.equal(question.answers.length, 1);
    assert.equal(question.answers[0].options.length, 4);
    assert.ok(question.meta && question.meta.sentenceId === 's1');
    assert.ok(Array.isArray(question.tokens));
    assert.ok(question.tokens.some((token) => token.type === 'hide'));
});

test('QuizEngine supports KaTeX tokens in group choices', () => {
    const definition = {
        meta: { id: 'test', title: 'test' },
        dataSets: {
            facts: {
                type: 'factSentences',
                sentences: [
                    {
                        id: 's1',
                        tokens: [
                            {
                                type: 'hide',
                                value: { type: 'katex', value: 'F_\\text{net}' },
                                answer: { mode: 'choice_from_group', group: 'symbolGroup' }
                            }
                        ]
                    }
                ],
                groups: {
                    symbolGroup: {
                        choices: [
                            { type: 'katex', value: 'F_\\text{net}' },
                            { type: 'katex', value: 'p' },
                            { type: 'katex', value: 'v' },
                            { type: 'katex', value: 'J' }
                        ]
                    }
                }
            }
        },
        patterns: [
            {
                id: 'p1',
                dataSet: 'facts',
                questionFormat: 'sentence_fill_choice',
                tokensFromData: 'sentences'
            }
        ],
        modes: [
            { id: 'm1', label: 'Mode', patternWeights: [{ patternId: 'p1', weight: 1 }] }
        ]
    };

    const engine = new QuizEngine(definition);
    engine.setMode('m1');
    const question = engine.generateQuestion();

    assert.equal(question.answers.length, 1);
    const answer = question.answers[0];

    // 4 options as usual
    assert.equal(answer.options.length, 4);

    // At least one option must have labelTokens with a katex token
    assert.ok(
        answer.options.some(
            (opt) =>
                Array.isArray(opt.labelTokens) &&
                opt.labelTokens.some((t) => t.type === 'katex')
        )
    );
});

test('estimateModeCapacity counts each pattern once per mode', () => {
    const definition = {
        dataSets: {
            tableSet: {
                type: 'table',
                data: [
                    { id: 'r1', value: 'Alpha' },
                    { id: 'r2', value: 'Beta' },
                    { id: 'r3', value: 'Gamma' }
                ]
            }
        },
        patterns: [
            {
                id: 'p1',
                dataSet: 'tableSet',
                questionFormat: 'table_fill_choice',
                tokens: []
            }
        ],
        modes: [
            {
                id: 'modeA',
                patternWeights: [
                    { patternId: 'p1', weight: 1 },
                    { patternId: 'p1', weight: 2 }
                ]
            }
        ]
    };

    const engine = new QuizEngine(definition);
    assert.equal(engine.getPatternCapacity('p1'), 3);
    assert.equal(engine.estimateModeCapacity('modeA'), 3);
});
