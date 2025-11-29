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
