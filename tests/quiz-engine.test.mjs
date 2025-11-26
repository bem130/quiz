import test from 'node:test';
import assert from 'node:assert/strict';
import { QuizEngine } from '../js/quiz-engine.js';

test('generateQuestion returns pattern tips for current pattern', () => {
    const definition = {
        meta: {},
        entitySet: {
            entities: {
                a: { name: 'Alpha' },
                b: { name: 'Beta' },
                c: { name: 'Gamma' },
                d: { name: 'Delta' }
            }
        },
        patterns: [
            {
                id: 'p1',
                tokens: [
                    {
                        type: 'hide',
                        field: 'name',
                        answer: { mode: 'choice' }
                    }
                ],
                tips: [
                    { id: 't1', when: 'always', tokens: [{ type: 'text', value: 'Tip text' }] }
                ]
            }
        ],
        modes: [
            {
                id: 'default',
                patternWeights: [{ patternId: 'p1', weight: 1 }]
            }
        ]
    };

    const engine = new QuizEngine(definition);
    engine.setMode('default');

    const question = engine.generateQuestion();

    assert.equal(question.patternId, 'p1');
    assert.ok(Array.isArray(question.patternTips));
    assert.equal(question.patternTips.length, 1);
    assert.equal(question.patternTips[0].id, 't1');
});
