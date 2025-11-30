import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateQuizCapacity } from '../js/capacity-manager.js';

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
            patternWeights: [{ patternId: 'p-sentence', weight: 1 }]
        }
    ]
};

test('estimateQuizCapacity sums per-mode capacities', () => {
    const estimated = estimateQuizCapacity(definition);
    assert.equal(estimated, 5);
});
