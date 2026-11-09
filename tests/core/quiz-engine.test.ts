import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { packageIdentity } from '../../src/core/identity.ts';
import { generateQuestion, prepareQuiz } from '../../src/core/quiz-engine.ts';
import type { QuestionCandidate } from '../../src/core/quiz-engine.ts';
import { parseQuiz, parseQuizJson } from '../../src/core/schema.ts';
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
function prepare(quiz: QuizFile) { return prepareQuiz(quiz, packageId, 'revision-1'); }
function candidate(rows: readonly unknown[], answer: unknown = { type: 'key', field: 'label' }, group = false): readonly QuestionCandidate[] {
    const quiz = valueOf(parseQuiz({ version: 3, title: '題庫', description: '説明', table: rows,
        patterns: [{ id: 'p', tokens: [{ type: 'hide', id: 'h', value: [answer],
            answer: { mode: 'choice_from_entities', ...(group ? { distractorSource: { groupField: 'group' } } : {}) } }] }] }));
    return prepare(quiz).candidates;
}

await test('既存サンプルを全候補列挙し、容量と実際に生成できる題目数が一致する', () => {
    for (const [name, expected] of [['math-v3', 8], ['multi-answer-v3', 3], ['svg-v3', 6]] as const) {
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
