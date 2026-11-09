import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawRandom, seedRandom, shuffle } from '../../src/core/random.ts';

await test('同じseedと状態から常に同じ乱数列を生成し、値は[0,1)を保つ', () => {
    let state = seedRandom('日本語 seed');
    for (let count = 0; count < 1000; count += 1) {
        const first = drawRandom(state);
        assert.deepEqual(first, drawRandom(state));
        assert.ok(first.value >= 0 && first.value < 1);
        assert.ok(Number.isInteger(first.state));
        state = first.state;
    }
    assert.notEqual(seedRandom('first'), seedRandom('second'));
});

await test('shuffleは入力集合を変更せず、空配列を含め再現可能である', () => {
    const input = Object.freeze(Array.from({ length: 30 }, (_, index) => index));
    const first = shuffle(input, seedRandom('order'));
    assert.deepEqual(first, shuffle(input, seedRandom('order')));
    assert.deepEqual([...first.items].sort((left, right) => left - right), input);
    assert.notDeepEqual(first.items, input);
    assert.deepEqual(shuffle([], 42), { items: [], state: 42 });
});
