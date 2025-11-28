import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertToV2, validateDefinition } from '../js/quiz-model.js';

test('convertToV2 converts legacy hide.field to value for v2 data', () => {
    const json = {
        version: 2,
        dataSets: {
            sample: {
                type: 'table',
                data: [{ id: 'r1', text: 'Hello' }]
            }
        },
        questionRules: {
            patterns: [
                {
                    id: 'p1',
                    dataSet: 'sample',
                    tokens: [
                        {
                            type: 'hide',
                            field: 'text',
                            answer: { mode: 'choice_from_entities' }
                        }
                    ]
                }
            ]
        }
    };

    const def = convertToV2(json);
    const hideToken = def.patterns[0].tokens[0];
    assert.equal(hideToken.type, 'hide');
    assert.ok(hideToken.value, 'hide token should have value after conversion');
    assert.equal(hideToken.value.type, 'key');
});

test('convertToV2 converts hideruby tokens inside factSentences for v2 data', () => {
    const json = {
        version: 2,
        dataSets: {
            facts: {
                type: 'factSentences',
                sentences: [
                    {
                        id: 's1',
                        tokens: [
                            {
                                type: 'hideruby',
                                base: { source: 'text', value: 'Base' },
                                ruby: { source: 'text', value: 'Ruby' },
                                answer: { mode: 'choice_ruby_pair' }
                            }
                        ]
                    }
                ]
            }
        },
        questionRules: {
            patterns: [
                {
                    id: 'p1',
                    dataSet: 'facts',
                    tokensFromData: 'sentences'
                }
            ]
        }
    };

    const def = convertToV2(json);
    const token = def.dataSets.facts.sentences[0].tokens[0];
    assert.equal(token.type, 'hide');
    assert.ok(token.value && token.value.type === 'ruby');
});

test('validateDefinition enforces tokensFromData for sentence_fill_choice', () => {
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
                                value: { type: 'text', value: 'hello' },
                                answer: { mode: 'choice_from_group', group: 'g1' }
                            }
                        ]
                    }
                ],
                groups: {
                    g1: { choices: ['hello', 'world'] }
                }
            }
        },
        patterns: [
            {
                id: 'p1',
                dataSet: 'facts',
                questionFormat: 'sentence_fill_choice'
            }
        ],
        modes: [
            { id: 'm1', label: 'Mode', patternWeights: [{ patternId: 'p1', weight: 1 }] }
        ]
    };

    assert.throws(
        () => validateDefinition(definition),
        /tokensFromData to "sentences"/
    );
});
