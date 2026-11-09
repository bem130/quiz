import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tokenizeKatex } from '../../src/core/katex-parser.ts';

await test('ASCIIコマンドと末尾star、括弧、記号を元の区間で分類する', () => {
    assert.deepEqual(tokenizeKatex('\\alpha*{x_1}+y'), [
        { kind: 'Command', text: '\\alpha*', start: 0, end: 7 },
        { kind: 'Brace', text: '{', start: 7, end: 8 },
        { kind: 'Plain', text: 'x', start: 8, end: 9 },
        { kind: 'Symbol', text: '_', start: 9, end: 10 },
        { kind: 'Plain', text: '1', start: 10, end: 11 },
        { kind: 'Brace', text: '}', start: 11, end: 12 },
        { kind: 'Symbol', text: '+', start: 12, end: 13 },
        { kind: 'Plain', text: 'y', start: 13, end: 14 }
    ]);
});

await test('エスケープされた記号をコメントや括弧の開始として扱わない', () => {
    assert.deepEqual(tokenizeKatex('\\%\\{\\\\\\,'), [
        { kind: 'Command', text: '\\%', start: 0, end: 2 },
        { kind: 'Command', text: '\\{', start: 2, end: 4 },
        { kind: 'Command', text: '\\\\', start: 4, end: 6 },
        { kind: 'Command', text: '\\,', start: 6, end: 8 }
    ]);
});

await test('コメントに式の記号を含め、LF改行を次のPlainへ残す', () => {
    assert.deepEqual(tokenizeKatex('x%{\\alpha}\r\ny'), [
        { kind: 'Plain', text: 'x', start: 0, end: 1 },
        { kind: 'Comment', text: '%{\\alpha}\r', start: 1, end: 11 },
        { kind: 'Plain', text: '\ny', start: 11, end: 13 }
    ]);
});

await test('空入力には空配列を返し、末尾escapeと末尾コメントを失わない', () => {
    assert.deepEqual(tokenizeKatex('', 12), []);
    assert.deepEqual(tokenizeKatex('\\', 12), [{ kind: 'Command', text: '\\', start: 12, end: 13 }]);
    assert.deepEqual(tokenizeKatex('%', 12), [{ kind: 'Comment', text: '%', start: 12, end: 13 }]);
    assert.deepEqual(tokenizeKatex('a\\', 12), [
        { kind: 'Plain', text: 'a', start: 12, end: 13 },
        { kind: 'Command', text: '\\', start: 13, end: 14 }
    ]);
});

await test('日本語と補助文字のoffsetをUTF-16コード単位で返す', () => {
    assert.deepEqual(tokenizeKatex('猫😀+x', 20), [
        { kind: 'Plain', text: '猫😀', start: 20, end: 23 },
        { kind: 'Symbol', text: '+', start: 23, end: 24 },
        { kind: 'Plain', text: 'x', start: 24, end: 25 }
    ]);
});

await test('すべての括弧と記号を一文字ずつ分類する', () => {
    for (const symbol of ['{', '}', '(', ')', '[', ']', '|']) {
        assert.deepEqual(tokenizeKatex(symbol), [{ kind: 'Brace', text: symbol, start: 0, end: 1 }]);
    }
    for (const symbol of ['_', '^', '&', "'", '+', '-', '=', ',', '.']) {
        assert.deepEqual(tokenizeKatex(symbol), [{ kind: 'Symbol', text: symbol, start: 0, end: 1 }]);
    }
});

await test('不完全な式を含め、再結合と連続区間の不変条件を満たす', () => {
    const inputs = [
        '', 'abc', '\\', '\\alpha*', '\\*', '\\%', '% comment', '%\n',
        'x_1 + \\frac{日本語😀}{2}', '()[]|{}^&\'=-,.', '\\あ', '\\😀',
        '\\alpha**', 'a%終端\r\nb\\', '\\frac{', 'a\n\r\tb'
    ];
    for (const input of inputs) {
        for (const offset of [0, 13]) {
            const segments = tokenizeKatex(input, offset);
            assert.equal(segments.map((segment) => segment.text).join(''), input);
            let expectedStart = offset;
            for (const segment of segments) {
                assert.equal(segment.start, expectedStart);
                assert.ok(segment.end > segment.start);
                assert.ok(segment.end <= offset + input.length);
                assert.equal(segment.text, input.slice(segment.start - offset, segment.end - offset));
                expectedStart = segment.end;
            }
            assert.equal(expectedStart, offset + input.length);
        }
    }
});

await test('同入力の結果は決定的で、呼び出し間に配列や区間を共有しない', () => {
    const input = '\\sqrt{x}+😀';
    const first = tokenizeKatex(input, 3);
    const second = tokenizeKatex(input, 3);
    assert.deepEqual(first, second);
    assert.notStrictEqual(first, second);
    assert.notStrictEqual(first.at(0), second.at(0));
    assert.equal(input, '\\sqrt{x}+😀');
});
