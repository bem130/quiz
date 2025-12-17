import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    convertToV2,
    resolveImportUrl,
    resolveQuizJsonFromEntry,
    validateDefinition,
    loadQuizDefinitionFromPath
} from '../js/quiz-model.js';

test('convertToV2 converts legacy hide.field to value for v2 data', () => {
    const json = {
        version: 2,
        dataSets: {
            sample: {
                type: 'table',
                data: [{ id: 'r1', text: 'Hello' }]
            }
        },
        questionRules: {
            patterns: [
                {
                    id: 'p1',
                    dataSet: 'sample',
                    tokens: [
                        {
                            type: 'hide',
                            field: 'text',
                            answer: { mode: 'choice_from_entities' }
                        }
                    ]
                }
            ]
        }
    };

    const def = convertToV2(json);
    const hideToken = def.patterns[0].tokens[0];
    assert.equal(hideToken.type, 'hide');
    assert.ok(hideToken.value, 'hide token should have value after conversion');
    assert.ok(Array.isArray(hideToken.value));
    assert.equal(hideToken.value[0].type, 'key');
});

test('convertToV2 converts hideruby tokens inside factSentences for v2 data', () => {
    const json = {
        version: 2,
        dataSets: {
            facts: {
                type: 'factSentences',
                sentences: [
                    {
                        id: 's1',
                        tokens: [
                            {
                                type: 'hideruby',
                                base: { source: 'text', value: 'Base' },
                                ruby: { source: 'text', value: 'Ruby' },
                                answer: { mode: 'choice_ruby_pair' }
                            }
                        ]
                    }
                ]
            }
        },
        questionRules: {
            patterns: [
                {
                    id: 'p1',
                    dataSet: 'facts',
                    tokensFromData: 'sentences'
                }
            ]
        }
    };

    const def = convertToV2(json);
    const token = def.dataSets.facts.sentences[0].tokens[0];
    assert.equal(token.type, 'hide');
    assert.ok(token.value && token.value.type === 'ruby');
});

test('convertToV2 normalizes nested modes into flat list and modeTree', () => {
    const json = {
        version: 2,
        dataSets: {
            sample: {
                type: 'table',
                data: [{ id: 'r1', name: 'Alpha' }]
            }
        },
        questionRules: {
            patterns: [
                {
                    id: 'p1',
                    dataSet: 'sample',
                    tokens: [
                        {
                            type: 'hide',
                            value: { type: 'key', field: 'name' },
                            answer: { mode: 'choice_from_entities' }
                        }
                    ]
                }
            ],
            modes: [
                {
                    type: 'modes',
                    label: 'Group A',
                    description: 'Root group',
                    value: [
                        {
                            id: 'm1',
                            label: 'Mode 1',
                            description: 'First',
                            patternWeights: [{ patternId: 'p1', weight: 1 }]
                        },
                        {
                            type: 'modes',
                            label: 'Sub',
                            description: 'Sub group',
                            value: [
                                {
                                    id: 'm2',
                                    label: 'Mode 2',
                                    description: 'Second',
                                    patternWeights: [{ patternId: 'p1', weight: 2 }]
                                }
                            ]
                        }
                    ]
                },
                {
                    id: 'm3',
                    label: 'Mode 3',
                    description: 'Third',
                    patternWeights: [{ patternId: 'p1', weight: 3 }]
                }
            ]
        }
    };

    const def = convertToV2(json);

    assert.equal(def.modes.length, 3);
    assert.deepEqual(
        def.modes.map((m) => m.id),
        ['m1', 'm2', 'm3']
    );
    assert.deepEqual(def.modeTree, [
        {
            type: 'modes',
            label: 'Group A',
            description: 'Root group',
            children: [
                { type: 'mode', modeId: 'm1' },
                {
                    type: 'modes',
                    label: 'Sub',
                    description: 'Sub group',
                    children: [{ type: 'mode', modeId: 'm2' }]
                }
            ]
        },
        { type: 'mode', modeId: 'm3' }
    ]);
});

test('loadQuizDefinitionFromPath loads local quiz files', async () => {
    const { definition, quizName } = await loadQuizDefinitionFromPath(
        'data/sample/amino-acid-quiz-ja-v2.json'
    );

    assert.equal(quizName, 'amino-acid-quiz-ja-v2');
    assert.ok(Array.isArray(definition.patterns));
    assert.ok(definition.patterns.length > 0);
    assert.ok(definition.dataSets && definition.dataSets['alpha-amino-acids']);
});

test('convertToV2 generates default mode and modeTree when modes are missing', () => {
    const json = {
        version: 2,
        dataSets: {
            sample: {
                type: 'table',
                data: [{ id: 'r1', name: 'Alpha' }]
            }
        },
        questionRules: {
            patterns: [
                {
                    id: 'p1',
                    dataSet: 'sample',
                    tokens: [
                        {
                            type: 'hide',
                            value: { type: 'key', field: 'name' },
                            answer: { mode: 'choice_from_entities' }
                        }
                    ]
                }
            ]
        }
    };

    const def = convertToV2(json);

    assert.equal(def.modes.length, 1);
    assert.equal(def.modes[0].id, 'default');
    assert.equal(def.modes[0].label, 'Standard');
    assert.deepEqual(def.modeTree, [{ type: 'mode', modeId: 'default' }]);
});

test('convertToV2 allows skipping validation for main files with imports only', () => {
    const json = {
        version: 2,
        imports: ['bundle.json'],
        questionRules: {
            patterns: [
                {
                    id: 'p1',
                    dataSet: 'bundle',
                    tokens: [
                        {
                            type: 'hide',
                            value: { type: 'text', value: 'value' },
                            answer: { mode: 'choice_from_entities' }
                        }
                    ]
                }
            ],
            modes: [
                { id: 'm1', label: 'Mode', patternWeights: [{ patternId: 'p1', weight: 1 }] }
            ]
        }
    };

    const def = convertToV2(json, { skipValidation: true });
    assert.equal(def.patterns[0].id, 'p1');
    assert.equal(Object.keys(def.dataSets).length, 0);
});

test('validateDefinition succeeds after merging imported data sets', () => {
    const mainJson = {
        version: 2,
        imports: ['bundle.json'],
        questionRules: {
            patterns: [
                {
                    id: 'p1',
                    dataSet: 'bundle',
                    tokens: [
                        {
                            type: 'hide',
                            value: { type: 'key', field: 'name' },
                            answer: { mode: 'choice_from_entities' }
                        }
                    ]
                }
            ],
            modes: [
                { id: 'm1', label: 'Mode', patternWeights: [{ patternId: 'p1', weight: 1 }] }
            ]
        }
    };

    const mainDefinition = convertToV2(mainJson, { skipValidation: true });
    const bundleDefinition = convertToV2(
        {
            version: 2,
            dataSets: {
                bundle: {
                    type: 'table',
                    data: [{ id: 'row1', name: 'Sample' }]
                }
            }
        },
        { skipValidation: true }
    );

    const merged = {
        meta: mainDefinition.meta,
        dataSets: bundleDefinition.dataSets,
        patterns: mainDefinition.patterns,
        modes: mainDefinition.modes
    };

    assert.doesNotThrow(() => validateDefinition(merged));
});

test('validateDefinition enforces tokensFromData for sentence_fill_choice', () => {
    const definition = {
        meta: { id: 'test', title: 'test' },
        dataSets: {
            facts: {
                type: 'factSentences',
                sentences: [
                    {
                        id: 's1',
                        tokens: [
                            {
                                type: 'hide',
                                value: { type: 'text', value: 'hello' },
                                answer: { mode: 'choice_from_group', group: 'g1' }
                            }
                        ]
                    }
                ],
                groups: {
                    g1: { choices: ['hello', 'world'] }
                }
            }
        },
        patterns: [
            {
                id: 'p1',
                dataSet: 'facts',
                questionFormat: 'sentence_fill_choice'
            }
        ],
        modes: [
            { id: 'm1', label: 'Mode', patternWeights: [{ patternId: 'p1', weight: 1 }] }
        ]
    };

    assert.throws(
        () => validateDefinition(definition),
        /tokensFromData to "sentences"/
    );
});

test('validateDefinition rejects hide tokens without values', () => {
    const definition = {
        meta: { id: 'test', title: 'test' },
        dataSets: {
            table: {
                type: 'table',
                data: [{ id: 'r1', name: 'Row1' }]
            }
        },
        patterns: [
            {
                id: 'p1',
                dataSet: 'table',
                questionFormat: 'table_fill_choice',
                tokens: [
                    {
                        type: 'hide',
                        answer: { mode: 'choice_from_entities' }
                    }
                ]
            }
        ],
        modes: [
            { id: 'm1', label: 'Mode', patternWeights: [{ patternId: 'p1', weight: 1 }] }
        ]
    };

    assert.throws(
        () => validateDefinition(definition),
        /Hide token.*non-empty value array/
    );
});

test('resolveQuizJsonFromEntry resolves relative paths against entry base', () => {
    const entry = {
        id: 'sample-quiz',
        dir: 'data/quizzes',
        _entryBaseUrl: 'https://example.com/quiz/entry.php'
    };

    const url = resolveQuizJsonFromEntry(entry);
    assert.equal(url, 'https://example.com/quiz/data/quizzes/sample-quiz.json');
});

test('resolveQuizJsonFromEntry respects file field', () => {
    const entry = {
        id: 'custom',
        file: './data/custom/custom.json',
        _entryBaseUrl: 'https://example.com/app/entry.php'
    };

    const url = resolveQuizJsonFromEntry(entry);
    assert.equal(url, 'https://example.com/app/data/custom/custom.json');
});

test('validateDefinition requires value or field for katex tokens', () => {
    const definition = {
        meta: { id: 'test', title: 'test' },
        dataSets: {
            table: {
                type: 'table',
                data: [{ id: 'r1', text: 'Hello' }]
            }
        },
        patterns: [
            {
                id: 'p1',
                dataSet: 'table',
                questionFormat: 'table_fill_choice',
                tokens: [
                    { type: 'katex' },
                    {
                        type: 'hide',
                        value: { type: 'text', value: 'answer' },
                        answer: { mode: 'choice_from_entities' }
                    }
                ]
            }
        ],
        modes: [
            { id: 'm1', label: 'Mode', patternWeights: [{ patternId: 'p1', weight: 1 }] }
        ]
    };

    assert.throws(
        () => validateDefinition(definition),
        /requires value or field/
    );
});

test('resolveImportUrl resolves imports relative to the current JSON file', () => {
    const originalWindow = global.window;
    global.window = { location: { href: 'http://localhost/index.html' } };

    const mainPath = 'http://127.0.0.1:8000/quizzes/nature/geo-main-nature.json';
    const importPath = './geo-nature-climate-basic.data.json';

    const resolved = resolveImportUrl(mainPath, importPath);
    assert.equal(
        resolved,
        'http://127.0.0.1:8000/quizzes/nature/geo-nature-climate-basic.data.json'
    );

    global.window = originalWindow;
});
