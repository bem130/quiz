import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateQuizCapacity } from '../js/capacity-manager.js';

test('estimateQuizCapacity counts unique patterns across modes', () => {
    const definition = {
        meta: { id: 'test', title: 'Test', description: 'Test' },
        dataSets: {
            table: {
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
                dataSet: 'table',
                tokens: []
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
        meta: { id: 'test', title: 'Test', description: 'Test' },
        dataSets: {
            table: {
                type: 'table',
                data: [
                    { id: 'r1', value: 'Alpha' },
                    { id: 'r2', value: 'Beta' }
                ]
            }
        },
        patterns: [
            {
                id: 'p1',
                dataSet: 'table',
                tokens: []
            },
            {
                id: 'p2',
                dataSet: 'table',
                tokens: []
            }
        ],
        modes: [
            {
                id: 'modeA',
                patternWeights: [
                    { patternId: 'p1', weight: 1 },
                    { patternId: 'p2', weight: 1 }
                ]
            }
        ]
    };

    const estimated = estimateQuizCapacity(definition);
    assert.equal(estimated, 4);
});

test('estimateQuizCapacity ignores zero-capacity patterns', () => {
    const definition = {
        meta: { id: 'test', title: 'Test', description: 'Test' },
        dataSets: {
            emptyTable: {
                type: 'table',
                data: []
            },
            liveTable: {
                type: 'table',
                data: [{ id: 'r1', value: 'Alpha' }]
            }
        },
        patterns: [
            {
                id: 'p-zero',
                dataSet: 'emptyTable',
                tokens: []
            },
            {
                id: 'p-live',
                dataSet: 'liveTable',
                tokens: []
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
