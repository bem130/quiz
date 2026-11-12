import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { packageIdentity } from '../../src/core/identity.ts';
import { generateQuestion, prepareQuiz } from '../../src/core/quiz-engine.ts';
import type { QuestionCandidate } from '../../src/core/quiz-engine.ts';
import { parseQuiz, parseQuizJson, serializeQuiz } from '../../src/core/schema.ts';
import { seedRandom } from '../../src/core/random.ts';
import type { QuizFile } from '../../src/core/model.ts';
import type { Result } from '../../src/core/result.ts';
import { none, some } from '../../src/core/result.ts';
import type { Option } from '../../src/core/result.ts';

function valueOf<T, E>(result: Result<T, E>): T {
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
}
const packageId = valueOf(packageIdentity({ kind: 'remote', url: 'https://example.com/data/math.json' }));
function prepare(quiz: QuizFile) { return prepareQuiz(quiz, packageId, serializeQuiz(quiz)); }
function candidate(rows: readonly unknown[], answer: unknown = { type: 'key', field: 'label' }, group = false): readonly QuestionCandidate[] {
    const quiz = valueOf(parseQuiz({ version: 3, title: '題庫', description: '説明', table: rows,
        patterns: [{ id: 'p', tokens: [{ type: 'hide', id: 'h', value: [answer],
            answer: { mode: 'choice_from_entities', ...(group ? { distractorSource: { groupField: 'group' } } : {}) } }] }] }));
    return prepare(quiz).candidates;
}

await test('既存サンプルを全候補列挙し、容量と実際に生成できる題目数が一致する', () => {
    for (const [name, expected] of [['math-v3', 8], ['multi-answer-v3', 3], ['svg-v3', 6], ['standalone-choice-v3', 1]] as const) {
        const quiz = valueOf(parseQuizJson(readFileSync(new URL(`../../data/sample/${name}.json`, import.meta.url), 'utf8')));
        const prepared = prepare(quiz);
        assert.equal(prepared.capacity, expected);
        assert.equal(prepared.unavailable.length, 0);
        for (const entry of prepared.candidates) {
            const generated = generateQuestion(entry, seedRandom('sample'));
            assert.equal(generated.kind, 'some');
            if (generated.kind !== 'some') continue;
            assert.ok(generated.value.question.options.length >= 2 && generated.value.question.options.length <= 4);
            assert.equal(generated.value.question.options.filter((option) => option.isCorrect).length, 1);
            assert.deepEqual(generated, generateQuestion(entry, seedRandom('sample')));
            assert.equal(generated.value.question.pattern, entry.pattern);
        }
    }
});

await test('同じ表示の答えしかない行や単一行の容量はゼロとなる', () => {
    assert.equal(candidate([{ id: 'a', label: 'same' }]).length, 0);
    assert.equal(candidate([{ id: 'a', label: '[同/どう]' }, { id: 'b', label: '[同/おなじ]' }]).length, 0);
});

await test('listkeyの全正答と同一groupを誤選択肢から除外し、2〜4択へ縮退する', () => {
    const prepared = candidate([
        { id: 'a', group: 'same', labels: [['2'], ['3']] },
        { id: 'b', group: 'other', labels: [['3'], ['5']] },
        { id: 'c', group: 'same', labels: [['7']] },
        { id: 'd', group: 'different', labels: [['11']] }
    ], { type: 'listkey', field: 'labels' }, true);
    const entry = prepared.find((item) => item.row.id === 'a');
    assert.ok(entry);
    for (let seed = 0; seed < 100; seed += 1) {
        const generated = generateQuestion(entry, seedRandom(String(seed)));
        assert.equal(generated.kind, 'some');
        if (generated.kind !== 'some') continue;
        const options = generated.value.question.options;
        assert.equal(options.length, 3);
        assert.ok(options.filter((option) => !option.isCorrect).every((option) => option.text === '5' || option.text === '11'));
        assert.ok(options.some((option) => option.isCorrect && (option.text === '2' || option.text === '3')));
    }
});

await test('誤選択肢戦略は3件に抽出する前の全poolから混同概念を選ぶ', () => {
    const entries = candidate(Array.from({ length: 12 }, (_, index) => ({ id: String(index), label: `選択肢${index}` })));
    const entry = entries.at(0);
    assert.ok(entry);
    const target = entry.distractors.at(-1);
    assert.ok(target);
    let shown = 0;
    for (let seed = 0; seed < 200; seed += 1) {
        const generated = generateQuestion(entry, seedRandom(String(seed)), {
            confusions: [{ conceptId: entry.conceptId, wrongConceptId: target.conceptId, score: 1 }], recentConceptIds: []
        });
        assert.equal(generated.kind, 'some');
        if (generated.kind === 'some' && generated.value.question.options.some((option) => option.conceptId === target.conceptId)) shown += 1;
    }
    assert.ok(shown > 120, `強い混同概念が全候補から優先選択される: ${shown}/200`);
});

await test('SVG画像のaltが同じでも異なるsourceは別の選択肢として保持する', () => {
    const entries = candidate([{ id: 'a', image: 'a.svg' }, { id: 'b', image: 'b.svg' }],
        { type: 'svg', field: 'image', alt: '図形' });
    assert.equal(entries.length, 2);
    const first = entries.at(0);
    assert.ok(first);
    const question = generateQuestion(first, 42);
    assert.equal(question.kind, 'some');
    if (question.kind === 'some') {
        assert.deepEqual(question.value.question.options.map((option) => option.text), ['図形', '図形']);
        assert.equal(new Set(question.value.question.options.map((option) => option.comparisonKey)).size, 2);
        assert.ok(question.value.question.options.every((option) => option.tokens.some((token) => typeof token !== 'string' && token.type === 'svg')));
    }
});

await test('共有索引の容量と候補集合は小規模の全組合せoracleに一致する', () => {
    const sets: readonly (readonly string[])[] = [['A'], ['A', 'B'], ['B']];
    for (let combination = 0; combination < 27; combination += 1) {
        for (let grouping = 0; grouping < 4; grouping += 1) {
            const rows = [0, 1, 2].map((index) => {
                const labels = sets.at(Math.floor(combination / (3 ** index)) % 3);
                assert.ok(labels);
                const group: Option<string> = grouping === 0 || (grouping === 3 && index === 0) ? none :
                    some(grouping === 2 && index % 2 === 1 ? 'H' : 'G');
                return { id: `r${index}`, labels, group };
            });
            const actual = candidate(rows.map((row) => ({ id: row.id, labels: row.labels.map((text) => [text]),
                ...(row.group.kind === 'some' ? { group: row.group.value } : {}) })), { type: 'listkey', field: 'labels' }, grouping !== 0);
            const expected = rows.map((row) => ({ row, pool: rows.filter((other) => other.id !== row.id &&
                (grouping === 0 || row.group.kind === 'none' || other.group.kind === 'none' || row.group.value !== other.group.value))
                .flatMap((other) => other.labels.filter((text) => !row.labels.includes(text)).map((text) => [other.id, text])) }))
                .filter((entry) => entry.pool.length > 0);
            assert.deepEqual(actual.map((entry) => entry.row.id), expected.map((entry) => entry.row.id));
            for (const entry of actual) {
                const expectedEntry = expected.find((item) => item.row.id === entry.row.id);
                assert.ok(expectedEntry);
                assert.deepEqual(entry.distractors.map((variant) => [variant.row.id, variant.text]).sort(), expectedEntry.pool.sort());
            }
        }
    }
});

await test('1000〜10000行でもpool参照と索引処理数は総variant数に比例する', () => {
    for (const kind of ['unique', 'same-label', 'same-group', 'multiple-answers'] as const) {
        const size = kind === 'unique' ? 1000 : 10000;
        const quiz = valueOf(parseQuiz({ title: kind, description: '線形境界の検証',
            table: Array.from({ length: size }, (_, index) => ({ id: `r${index}`,
                labels: kind === 'multiple-answers' ? [[`A${index % 5}`], [`A${(index + 1) % 5}`]] : [[kind === 'same-label' ? 'A' : `A${index}`]],
                group: kind === 'same-group' ? 'G' : `G${index % 4}` })),
            patterns: [{ id: 'p', tokens: [{ type: 'hide', id: 'h', value: [{ type: 'listkey', field: 'labels' }],
                answer: { mode: 'choice_from_entities', ...(kind === 'same-group' || kind === 'multiple-answers' ? { distractorSource: { groupField: 'group' } } : {}) } }] }] }));
        const prepared = prepare(quiz);
        const variants = size * (kind === 'multiple-answers' ? 2 : 1);
        assert.equal(prepared.capacity, kind === 'same-label' || kind === 'same-group' ? 0 : size);
        assert.equal(prepared.statistics.sharedPools, 1);
        assert.equal(prepared.statistics.rowChecks, size);
        assert.equal(prepared.statistics.indexVisits, variants);
        assert.equal(prepared.statistics.capacityKeyChecks, variants);
        if (prepared.capacity > 0) {
            const first = prepared.candidates.at(0);
            assert.ok(first);
            assert.equal(new Set(prepared.candidates.map((entry) => entry.pool)).size, 1);
            assert.equal(first.pool.variants.length, variants);
            assert.ok(prepared.candidates.every((entry) => entry.pool.variants === first.pool.variants));
            assert.equal(generateQuestion(first, 42).kind, 'some');
        }
    }
});

await test('keyが参照する単一TokenとToken配列のlistkeyは同じ全正答集合へ展開する', () => {
    for (const asArray of [false, true]) {
        const indirect = { type: 'listkey', field: 'labels' };
        const prepared = candidate([
            { id: 'a', labels: [['A'], ['AA']], answer: asArray ? [indirect] : indirect },
            { id: 'b', labels: [['AA'], ['B']], answer: asArray ? [indirect] : indirect }
        ], { type: 'key', field: 'answer' });
        const first = prepared.find((item) => item.row.id === 'a');
        assert.ok(first);
        assert.deepEqual(first.answers.map((answer) => answer.text), ['A', 'AA']);
        assert.deepEqual(first.distractors.map((answer) => answer.text), ['B']);
        const generated = generateQuestion(first, seedRandom('indirect'));
        assert.equal(generated.kind, 'some');
        if (generated.kind === 'some') assert.equal(generated.value.question.options.length, 2);
    }
});

function fixedQuiz(display: 'inline' | 'none' = 'none', count = 4): QuizFile {
    return valueOf(parseQuiz({ version: 3, title: '固定選択肢', description: '行ごとの択一問題',
        table: [
            { id: 'first', correct: 'A', choices: ['A', 'B', 'C', 'D'].slice(0, count).map(text => [text]) },
            { id: 'second', correct: 'Z', choices: ['Z', 'Y', 'X', 'W'].slice(0, count).map(text => [text]) }
        ],
        patterns: [{ id: 'fixed', tokens: [{ type: 'hide', id: 'h', display,
            value: [{ type: 'key', field: 'correct' }], answer: { mode: 'choice_from_field', field: 'choices' } }] }]
    }));
}

await test('固定選択肢はinline/noneとも同じ行の2〜4件をすべて出し、正答を1件保持する', () => {
    for (const display of ['inline', 'none'] as const) for (const count of [2, 3, 4]) {
        const prepared = prepare(fixedQuiz(display, count));
        assert.equal(prepared.capacity, 2);
        assert.deepEqual(prepared.unavailable, []);
        for (const entry of prepared.candidates) {
            const generated = generateQuestion(entry, seedRandom('fixed'));
            assert.equal(generated.kind, 'some');
            if (generated.kind !== 'some') continue;
            const question = generated.value.question;
            assert.equal(question.options.length, count);
            assert.equal(question.options.filter(option => option.isCorrect).length, 1);
            assert.ok(question.options.every(option => option.row === entry.row && option.rowId === entry.rowId && option.conceptId === entry.conceptId));
            assert.equal(new Set(question.options.map(option => option.id)).size, count);
            assert.deepEqual(question.options.map(option => option.text).sort(), entry.pool.variants.map(option => option.text).sort());
            assert.ok(question.options.some(option => option.id === question.correctOptionId && option.isCorrect));
            assert.deepEqual(generated, generateQuestion(entry, seedRandom('fixed')));
            assert.deepEqual(generated, generateQuestion(entry, seedRandom('fixed'), {
                confusions: [{ conceptId: entry.conceptId, wrongConceptId: entry.conceptId, score: 1 }], recentConceptIds: [entry.conceptId]
            }));
        }
    }
});

await test('1行だけの固定選択肢も出題可能で、seedにより正答位置が変わる', () => {
    const source = fixedQuiz();
    const prepared = prepare({ ...source, table: source.table.slice(0, 1) });
    assert.equal(prepared.capacity, 1);
    const entry = prepared.candidates.at(0);
    assert.ok(entry);
    const positions = new Set<number>();
    for (let seed = 0; seed < 40; seed += 1) {
        const generated = generateQuestion(entry, seedRandom(String(seed)));
        assert.equal(generated.kind, 'some');
        if (generated.kind === 'some') positions.add(generated.value.question.options.findIndex(option => option.isCorrect));
    }
    assert.equal(positions.size, 4);
});

await test('固定選択肢の空値・重複・正答不一致・不正件数を候補から除外する', () => {
    const source = fixedQuiz();
    const first = source.table.at(0);
    assert.ok(first);
    for (const choices of [[], [['A']], [['A'], ['B'], ['C'], ['D'], ['E']], [['A'], []], [['A'], ['  ']],
        [['A'], ['A']], [['A'], ['[A/えー]']], [['B'], ['C']]]) {
        const row = { ...first, fields: { ...first.fields, choices } };
        const prepared = prepareQuiz({ ...source, table: [row] }, packageId, serializeQuiz(source));
        assert.equal(prepared.capacity, 0, JSON.stringify(choices));
        assert.deepEqual(prepared.unavailable.map(entry => entry.reason), ['invalid-options']);
    }
});

await test('固定選択肢で複数の正答variantを宣言した行は候補から除外する', () => {
    const source = fixedQuiz();
    const first = source.table.at(0);
    const pattern = source.patterns.at(0);
    assert.ok(first && pattern);
    const hide = pattern.tokens.at(0);
    assert.ok(typeof hide === 'object' && hide.type === 'hide');
    const quiz: QuizFile = { ...source,
        table: [{ ...first, fields: { ...first.fields, correct: [['A'], ['B']] } }],
        patterns: [{ ...pattern, tokens: [{ ...hide, value: [{ type: 'listkey', field: 'correct', separatorTokens: [], styles: [] }] }] }]
    };
    const prepared = prepareQuiz(quiz, packageId, serializeQuiz(source));
    assert.equal(prepared.capacity, 0);
    assert.equal(prepared.unavailable.at(0)?.reason, 'invalid-options');
});

await test('固定選択肢のSVGは同じaltでもsourceで区別し、元のtokenを描画用に保持する', () => {
    const source = fixedQuiz();
    const first = source.table.at(0);
    assert.ok(first);
    const image = (src: string) => ({ type: 'svg' as const, source: { kind: 'file' as const, src }, alt: '構造', styles: [] });
    const a = image('a.svg'); const b = image('b.svg');
    const row = { ...first, fields: { ...first.fields, correct: [a], choices: [[a], [b]] } };
    const prepared = prepareQuiz({ ...source, table: [row] }, packageId, serializeQuiz(source));
    assert.equal(prepared.capacity, 1);
    const entry = prepared.candidates.at(0);
    assert.ok(entry);
    const generated = generateQuestion(entry, 42);
    assert.equal(generated.kind, 'some');
    if (generated.kind === 'some') {
        assert.deepEqual(generated.value.question.options.map(option => option.text), ['構造', '構造']);
        assert.equal(new Set(generated.value.question.options.map(option => option.comparisonKey)).size, 2);
        assert.ok(generated.value.question.options.every(option => option.tokens.at(0) === a || option.tokens.at(0) === b));
    }
});
