import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { MAX_ANSWER_VARIANTS, parseEntry, parseEntryJson, parseQuiz, parseQuizJson, quizToJson, serializeQuiz } from '../../src/core/schema.ts';
import { getRowValue } from '../../src/core/model.ts';
import type { DomainError, Result } from '../../src/core/result.ts';

function pattern(tokens: readonly unknown[], extra: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
    return { id: 'p1', tokens, ...extra };
}
function hide(value: readonly unknown[] = [{ type: 'key', field: 'name' }]): Readonly<Record<string, unknown>> {
    return { type: 'hide', id: 'h1', value, answer: { mode: 'choice_from_entities' } };
}
function fixture(extra: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
    return { version: 3, title: '題庫', description: '説明', table: [{ id: 'r1', name: 'A' }, { id: 'r2', name: 'B' }], patterns: [pattern([hide()])], ...extra };
}
function requireOk<T>(result: Result<T, DomainError>): T {
    if (!result.ok) assert.fail(JSON.stringify(result.error));
    return result.value;
}
function rejects(value: unknown, code: DomainError['code']): void {
    const result = parseQuiz(value);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, code, JSON.stringify(result.error));
}

await test('v3サンプルを検証し、正規化済みdomainと外部JSONを往復できる', async () => {
    for (const file of ['math-v3.json', 'multi-answer-v3.json']) {
        const text = await readFile(new URL(`../../data/sample/${file}`, import.meta.url), 'utf8');
        const quiz = requireOk(parseQuizJson(text));
        assert.equal(quiz.version, 3);
        assert.deepEqual(requireOk(parseQuiz(quizToJson(quiz))), quiz);
        assert.deepEqual(requireOk(parseQuizJson(serializeQuiz(quiz))), quiz);
    }
});

await test('全token種、ruby内参照、tips、group、SVG各sourceを検証して往復する', () => {
    const tokens = [
        '前置き', { type: 'key', field: '名前', styles: ['bold', 'future-style'] },
        { type: 'listkey', field: 'answers', separatorTokens: [' / '] },
        { type: 'ruby', base: { type: 'key', field: '名前' }, ruby: ['よみ'] },
        { type: 'katex', value: 'x^2' }, { type: 'katex', field: 'formula' },
        { type: 'smiles', field: 'chemical', maxHeightEm: 7, maxHeightPx: 120, zoomPadding: 0.9 },
        { type: 'svg', value: '<svg viewBox="0 0 1 1"/>', alt: '円' },
        { type: 'svg', src: './figure.svg', alt: '図' },
        { type: 'svg', field: 'figure', alt: '行の図' },
        { type: 'br' }, { type: 'hr' },
        { ...hide([{ type: 'listkey', field: 'answers' }]), answer: { mode: 'choice_from_entities', distractorSource: { groupField: 'group' } } }
    ];
    const quiz = requireOk(parseQuiz(fixture({
        table: [{ id: 'r1', conceptId: 'concept', 名前: 'A', formula: 'x', chemical: 'CC', figure: '<svg/>', group: 'G', answers: [['A'], ['AA']] }],
        patterns: [pattern(tokens, { tips: [{ id: 'tip', when: 'after_correct', tokens: [{ type: 'key', field: '名前' }] }] })]
    })));
    assert.deepEqual(requireOk(parseQuiz(quizToJson(quiz))), quiz);
    const normalized = quiz.patterns[0]?.tokens[1];
    assert.ok(typeof normalized === 'object' && normalized.type === 'key');
    assert.deepEqual(normalized.styles, ['bold']);
});

await test('省略可能フィールドを既定値へ正規化し、入力参照を保持しない', () => {
    const original = { id: 'r1', name: 'before' };
    const quiz = requireOk(parseQuiz(fixture({ table: [original] })));
    original.name = 'after';
    const row = quiz.table[0];
    assert.ok(row);
    assert.equal(row.fields['name'], 'before');
    assert.deepEqual(row.conceptId, { kind: 'none' });
    assert.equal(quiz.patterns[0]?.label, 'p1');
    assert.deepEqual(quiz.patterns[0]?.tips, []);
    assert.deepEqual(getRowValue(row, 'id'), { kind: 'some', value: 'r1' });
    assert.deepEqual(getRowValue(row, 'missing'), { kind: 'none' });
});

await test('JSON.parseと同じ厳密な数値・制御文字の構文を要求する', () => {
    for (const value of ['{"n":01}', '{"n":1.}', '{"n":1e}', '{"x":"a\tb"}', '{} trailing']) {
        const result = parseQuizJson(value);
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.error.kind, 'syntax');
            assert.equal(result.error.code, 'invalid-json');
        }
    }
});

await test('重複する行・pattern・tip IDを場所付きエラーとして拒否する', () => {
    rejects(fixture({ table: [{ id: 'r1', name: 'A' }, { id: 'r1', name: 'B' }] }), 'duplicate-id');
    rejects(fixture({ patterns: [pattern([hide()]), pattern([hide()])] }), 'duplicate-id');
    rejects(fixture({ patterns: [pattern([hide()], { tips: [{ id: 't', tokens: [] }, { id: 't', tokens: [] }] })] }), 'duplicate-id');
});

await test('hideはpattern直下に一つだけ置き、ruby・tips・行token内では許可しない', () => {
    rejects(fixture({ patterns: [pattern(['本文のみ'])] }), 'hide-count');
    rejects(fixture({ patterns: [pattern([hide(), { ...hide(), id: 'h2' }])] }), 'hide-count');
    rejects(fixture({ patterns: [pattern([hide([hide()])])] }), 'nested-hide');
    rejects(fixture({ patterns: [pattern([{ type: 'ruby', base: [hide()], ruby: 'よみ' }, hide()])] }), 'nested-hide');
    rejects(fixture({ table: [{ id: 'r', name: hide() }] }), 'nested-hide');
    rejects(fixture({ patterns: [pattern([hide()], { tips: [{ id: 't', tokens: [hide()] }] })] }), 'nested-hide');
});

await test('廃止仕様、未知token、null、不正な行値、非有限数、無効versionを拒否する', () => {
    rejects(fixture({ imports: [] }), 'unsupported-field');
    rejects(fixture({ patterns: [pattern([hide()], { choiceCount: 4 })] }), 'unsupported-field');
    rejects(fixture({ patterns: [pattern([{ type: 'unknown' }, hide()])] }), 'unsupported-token');
    rejects(fixture({ table: [{ id: 'r', name: null }] }), 'expected-object');
    rejects(fixture({ table: [{ id: 'r', name: { arbitrary: 'object' } }] }), 'expected-string');
    rejects(fixture({ table: [{ id: 'r', name: Number.POSITIVE_INFINITY }] }), 'invalid-value');
    rejects(fixture({ version: 2 }), 'invalid-version');
    rejects(fixture({ table: [] }), 'invalid-value');
});

await test('参照の欠損・型違い・直接と間接の循環を検出する', () => {
    rejects(fixture({ table: [{ id: 'r', other: 'A' }] }), 'invalid-reference');
    rejects(fixture({ table: [{ id: 'r', name: [['A']] }] }), 'invalid-reference');
    rejects(fixture({ patterns: [pattern([hide([{ type: 'listkey', field: 'name' }])])] }), 'invalid-reference');
    rejects(fixture({ table: [{ id: 'r', name: { type: 'key', field: 'name' } }] }), 'cyclic-reference');
    rejects(fixture({ table: [{ id: 'r', name: { type: 'key', field: 'other' }, other: { type: 'key', field: 'name' } }] }), 'cyclic-reference');
    rejects(fixture({ table: [{ id: 'r', name: 'A', formula: ['x'] }], patterns: [pattern([{ type: 'katex', field: 'formula' }, hide()])] }), 'invalid-reference');
});

await test('SVG sourceは一つだけ、altは非空とし、XML安全化はschemaで代用しない', () => {
    for (const svg of [
        { type: 'svg', value: '<svg/>', src: 'a.svg', alt: '図' },
        { type: 'svg', alt: '図' }, { type: 'svg', value: '<svg/>', alt: '' }
    ]) rejects(fixture({ patterns: [pattern([svg, hide()])] }), 'invalid-value');
    // 構造の受理はWeb境界でのsanitize成功を意味しない。
    assert.equal(parseQuiz(fixture({ patterns: [pattern([{ type: 'svg', value: '<svg onload="bad()"/>', alt: '図' }, hide()])] })).ok, true);
});

await test('文字列field sourceと数式literalは排他的であり、SMILES寸法は正数に限る', () => {
    rejects(fixture({ patterns: [pattern([{ type: 'katex', value: 'x', field: 'name' }, hide()])] }), 'invalid-value');
    rejects(fixture({ patterns: [pattern([{ type: 'smiles', value: 'CC', maxHeightEm: 0 }, hide()])] }), 'invalid-value');
});

await test('特殊プロパティ名を行データとして保持しprototypeを書き換えない', () => {
    const raw: unknown = JSON.parse('{"version":3,"title":"T","description":"D","table":[{"id":"r","__proto__":"label"}],"patterns":[{"id":"p","tokens":[{"type":"hide","id":"h","value":[{"type":"key","field":"__proto__"}],"answer":{"mode":"choice_from_entities"}}]}]}');
    const quiz = requireOk(parseQuiz(raw));
    const row = quiz.table[0];
    assert.ok(row);
    assert.equal(Object.getPrototypeOf(row.fields), Object.prototype);
    assert.deepEqual(getRowValue(row, '__proto__'), { kind: 'some', value: 'label' });
    assert.deepEqual(requireOk(parseQuiz(quizToJson(quiz))), quiz);
});

await test('entry一覧と編集補助情報を検証し、重複・未知構造を拒否する', () => {
    const entry = requireOk(parseEntryJson('{"version":3,"files":["./a.json"],"label":"一覧","editorBasePath":"/repo","editorFileMap":{"./a.json":"/repo/a.json"}}'));
    assert.deepEqual(entry.files, ['./a.json']);
    assert.deepEqual(entry.editorBasePath, { kind: 'some', value: '/repo' });
    assert.equal(parseEntry({ version: 3, files: ['a', 'a'] }).ok, false);
    assert.equal(parseEntry({ version: 3, files: [1] }).ok, false);
    assert.equal(parseEntry({ version: 2, files: [] }).ok, false);
    assert.equal(parseEntry({ version: 3, files: [], unknown: true }).ok, false);
    assert.equal(parseEntryJson('{"files":[]} trailing').ok, false);
    assert.equal(requireOk(parseEntry({ files: [] })).files.length, 0);
});

await test('循環objectと過剰な入れ子は例外を漏らさずResultの失敗へ変換する', () => {
    const cyclic: Record<string, unknown> = { type: 'ruby', ruby: 'よみ' };
    cyclic['base'] = cyclic;
    rejects(fixture({ patterns: [pattern([cyclic, hide()])] }), 'too-deep');
});

await test('複数listkeyの直積は1024まで検証し、超過を黙って切り捨てない', () => {
    assert.equal(MAX_ANSWER_VARIANTS, 1024);
    function cartesian(size: number): unknown {
        return fixture({
            table: [{ id: 'r', a: Array.from({ length: size }, (_, index) => [String(index)]), b: Array.from({ length: 32 }, (_, index) => [String(index)]) }],
            patterns: [pattern([hide([{ type: 'listkey', field: 'a' }, '-', { type: 'listkey', field: 'b' }])])]
        });
    }
    assert.equal(parseQuiz(cartesian(32)).ok, true);
    rejects(cartesian(33), 'too-many-variants');
});

await test('単一TokenまたはToken配列へのkey参照でもlistkey直積の1024上限を検証する', () => {
    for (const asArray of [false, true]) {
        for (const size of [32, 33]) {
            const first = { type: 'listkey', field: 'a' };
            const second = { type: 'listkey', field: 'b' };
            const raw = fixture({ table: [{ id: 'r',
                a: Array.from({ length: size }, (_, index) => [String(index)]),
                b: Array.from({ length: 32 }, (_, index) => [String(index)]),
                first: asArray ? [first] : first, second: asArray ? [second] : second
            }], patterns: [pattern([hide([{ type: 'key', field: 'first' }, '-', { type: 'key', field: 'second' }])])] });
            if (size === 32) assert.equal(parseQuiz(raw).ok, true);
            else rejects(raw, 'too-many-variants');
        }
    }
});
