import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conceptId, isConceptId, isPatternId, isQuestionId, isRowId, packageIdentity, parsePackageId, parseRecordKey, patternId, questionId, recordKey, rowId } from '../../src/core/identity.ts';
import type { PackageId } from '../../src/core/identity.ts';

function remote(url: string): PackageId {
    const result = packageIdentity({ kind: 'remote', url });
    if (!result.ok) assert.fail(JSON.stringify(result.error));
    return result.value;
}

await test('完全出典URLとdraftの別namespaceで同名行を分離する', () => {
    const first = remote('https://one.example/data/quiz.json');
    const second = remote('https://two.example/data/quiz.json');
    const draft = packageIdentity({ kind: 'draft', id: 'data/quiz.json' });
    assert.ok(draft.ok);
    assert.notEqual(first, second);
    assert.notEqual(first, draft.value);
    assert.notEqual(rowId(first, 'row_1'), rowId(second, 'row_1'));
    assert.notEqual(conceptId(first, 'concept'), conceptId(second, 'concept'));
    assert.equal(parsePackageId(first).ok, true);
});

await test('JSON tupleキーは区切り・日本語・引用符を含むIDを可逆に保持する', () => {
    const packageId = remote('https://example.test/a.json?subject=%E6%95%B0%E5%AD%A6');
    const localPattern = 'file::pattern/"日本語"';
    const localRow = 'row::[]';
    const question = questionId(packageId, localPattern, localRow);
    const decoded = parseRecordKey(question);
    assert.ok(decoded.ok);
    assert.deepEqual(decoded.value, ['question', packageId, localPattern, localRow]);
    assert.equal(isQuestionId(question), true);
    assert.equal(isPatternId(patternId(packageId, localPattern)), true);
    assert.equal(isRowId(rowId(packageId, localRow)), true);
    assert.equal(isConceptId(conceptId(packageId, localRow)), true);
    assert.equal(isPatternId(question), false);
});

await test('曖昧な旧区切りキー、不正JSON、非文字列tuple、非canonicalを拒否する', () => {
    for (const value of ['a::b', '{}', '[1]', '["a",null]', '[ "a" ]', 4]) assert.equal(parseRecordKey(value).ok, false);
    assert.deepEqual(parseRecordKey(recordKey(['a', 'b'])), { ok: true, value: ['a', 'b'] });
    assert.equal(parsePackageId(recordKey(['remote', 'javascript:bad'])).ok, false);
});

await test('出典はfragmentなしの絶対HTTP(S)、draft IDは非空とする', () => {
    for (const url of ['./data/quiz.json', 'file:///quiz.json', 'javascript:bad', 'https://example.test/x#fragment', 'https://user@example.test/x']) {
        assert.equal(packageIdentity({ kind: 'remote', url }).ok, false);
    }
    assert.equal(packageIdentity({ kind: 'draft', id: ' ' }).ok, false);
});
