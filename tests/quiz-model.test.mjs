import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    buildDefinitionFromQuizFile,
    loadQuizDefinitionFromPath
} from '../js/quiz-model.js';

function buildBaseFile() {
    return {
        title: 'Sample Quiz',
        description: 'Sample description.',
        version: 3,
        table: [
            { id: 'r1', name: 'Alpha' },
            { id: 'r2', name: 'Beta' }
        ],
        patterns: [
            {
                id: 'p1',
                tokens: [
                    'Name: ',
                    {
                        type: 'hide',
                        id: 'h1',
                        value: [{ type: 'key', field: 'name' }],
                        answer: { mode: 'choice_from_entities' }
                    }
                ]
            }
        ]
    };
}

test('buildDefinitionFromQuizFile normalizes pattern ids and datasets', () => {
    const file = buildBaseFile();
    const def = buildDefinitionFromQuizFile(file, 'sample/path.json');

    assert.equal(def.patterns[0].id, 'sample/path::p1');
    assert.ok(def.dataSets['file:sample/path']);
    assert.equal(def.dataSets['file:sample/path'].data.length, 2);
    assert.equal(def.meta.title, 'Sample Quiz');
});

test('buildDefinitionFromQuizFile rejects legacy questionFormat', () => {
    const file = buildBaseFile();
    file.patterns[0].questionFormat = 'table_fill_choice';

    assert.throws(
        () => buildDefinitionFromQuizFile(file, 'sample.json'),
        /questionFormat/
    );
});

test('buildDefinitionFromQuizFile rejects legacy choiceCount', () => {
    const file = buildBaseFile();
    file.patterns[0].tokens[1].answer.choiceCount = 4;

    assert.throws(
        () => buildDefinitionFromQuizFile(file, 'sample.json'),
        /choiceCount/
    );
});

test('buildDefinitionFromQuizFile rejects duplicate row ids', () => {
    const file = buildBaseFile();
    file.table = [
        { id: 'dup', name: 'A' },
        { id: 'dup', name: 'B' }
    ];

    assert.throws(
        () => buildDefinitionFromQuizFile(file, 'sample.json'),
        /duplicated/
    );
});

test('loadQuizDefinitionFromPath loads v3 sample file', async () => {
    const { definition, quizName } = await loadQuizDefinitionFromPath(
        'data/sample/math-v3.json'
    );

    assert.equal(quizName, 'math-v3');
    assert.ok(Array.isArray(definition.patterns));
    assert.ok(definition.patterns.length > 0);
    assert.ok(definition.dataSets && definition.dataSets['file:data/sample/math-v3']);
});
