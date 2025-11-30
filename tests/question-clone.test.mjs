import assert from 'node:assert/strict';
import test from 'node:test';
import { cloneQuestionForRetry } from '../js/question-clone.js';

test('cloneQuestionForRetry removes DOM elements and preserves data', () => {
    const originalElement = global.Element;
    class MockElement {}
    global.Element = MockElement;

    const domNode = new MockElement();
    const question = {
        text: 'sample',
        view: domNode,
        nested: {
            element: domNode,
            value: 3
        },
        options: [
            { label: 'a' },
            { label: 'b' }
        ]
    };

    const cloned = cloneQuestionForRetry(question);

    assert.notStrictEqual(cloned, question);
    assert.equal(cloned.text, 'sample');
    assert.equal(cloned.view, null);
    assert.equal(cloned.nested.element, null);
    assert.deepEqual(cloned.options, [
        { label: 'a' },
        { label: 'b' }
    ]);

    global.Element = originalElement;
});

test('cloneQuestionForRetry drops functions while keeping primitives', () => {
    const question = {
        text: 'keep me',
        compute: () => 42,
        count: 2
    };

    const cloned = cloneQuestionForRetry(question);

    assert.equal(cloned.text, 'keep me');
    assert.equal(cloned.count, 2);
    assert.equal(cloned.compute, undefined);
});

