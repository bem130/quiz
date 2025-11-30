import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateQuizCapacity } from '../js/capacity-manager.js';

test('estimateQuizCapacity counts unique patterns across modes', () => {
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
                id: 'p-shared',
                dataSet: 'tableSet',
                questionFormat: 'table_fill_choice',
                tokens: [],
                answer: { mode: 'choice_from_entities' }
            }
        ],
        modes: [
            {
                id: 'modeA',
                patternWeights: [{ patternId: 'p-shared', weight: 1 }]
            },
            {
                id: 'modeB',
                patternWeights: [{ patternId: 'p-shared', weight: 2 }]
            }
        ]
    };

    const estimated = estimateQuizCapacity(definition);
    assert.equal(estimated, 3);
});

test('estimateQuizCapacity sums distinct patterns once per quiz', () => {
    const definition = {
        dataSets: {
            tableSet: {
                type: 'table',
                data: [
                    { id: 'r1', value: 'Alpha' },
                    { id: 'r2', value: 'Beta' }
                ]
            },
            sentences: {
                type: 'factSentences',
                sentences: [
                    { id: 's1', tokens: [] },
                    { id: 's2', tokens: [] }
                ]
            }
        },
        patterns: [
            {
                id: 'p-fill',
                dataSet: 'tableSet',
                questionFormat: 'table_fill_choice',
                tokens: [],
                answer: { mode: 'choice_from_entities' }
            },
            {
                id: 'p-match',
                dataSet: 'tableSet',
                questionFormat: 'table_matching',
                matchingSpec: { pairCount: 2 },
                tokens: [],
                answer: { mode: 'matching' }
            },
            {
                id: 'p-sentence',
                dataSet: 'sentences',
                questionFormat: 'sentence_fill_choice',
                tokensFromData: 'sentences',
                tokens: [],
                answer: { mode: 'choice_from_entities' }
            }
        ],
        modes: [
            {
                id: 'modeA',
                patternWeights: [
                    { patternId: 'p-fill', weight: 1 },
                    { patternId: 'p-match', weight: 1 }
                ]
            },
            {
                id: 'modeB',
                patternWeights: [
                    { patternId: 'p-sentence', weight: 1 },
                    { patternId: 'p-match', weight: 1 }
                ]
            }
        ]
    };

    const estimated = estimateQuizCapacity(definition);
    assert.equal(estimated, 5);
});

test('estimateQuizCapacity ignores zero-capacity patterns', () => {
    const definition = {
        dataSets: {
            tableSet: {
                type: 'table',
                data: [
                    { id: 'r1', value: 'Alpha' }
                ]
            }
        },
        patterns: [
            {
                id: 'p-zero',
                dataSet: 'tableSet',
                questionFormat: 'table_fill_choice',
                entityFilter: { eq: { field: 'value', value: 'Nope' } },
                tokens: [],
                answer: { mode: 'choice_from_entities' }
            },
            {
                id: 'p-live',
                dataSet: 'tableSet',
                questionFormat: 'table_fill_choice',
                tokens: [],
                answer: { mode: 'choice_from_entities' }
            }
        ],
        modes: [
            {
                id: 'modeA',
                patternWeights: [
                    { patternId: 'p-zero', weight: 1 },
                    { patternId: 'p-live', weight: 1 }
                ]
            }
        ]
    };

    const estimated = estimateQuizCapacity(definition);
    assert.equal(estimated, 1);
});
