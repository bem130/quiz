import { parseJsonWithLoc } from './js/json-loc-parser.js';
import assert from 'assert';

console.log('--- Verifying JSON Loc Parser ---');

const simpleJson = `
{
    "title": "Hello",
    "count": 123,
    "active": true,
    "list": [1, 2, 3]
}`;

try {
    const ast = parseJsonWithLoc(simpleJson);
    console.log('[OK] Parse simple JSON');

    // Verify values
    assert.strictEqual(ast.value.title, "Hello");
    assert.strictEqual(ast.value.count, 123);
    assert.strictEqual(ast.value.active, true);
    assert.deepStrictEqual(ast.value.list, [1, 2, 3]);
    console.log('[OK] Values match');

    // Verify locations (approximate check)
    // "title" starts on line 3, column 5
    const titleProp = ast.children.find(c => c.key.value === 'title');
    assert.strictEqual(titleProp.key.loc.start.line, 3);

    // "list" starts on line 6
    const listProp = ast.children.find(c => c.key.value === 'list');
    assert.strictEqual(listProp.key.loc.start.line, 6);

    // list values
    const listVal = listProp.value;
    assert.strictEqual(listVal.children[0].loc.start.line, 6); // 1

    console.log('[OK] Locations match expectations');

} catch (e) {
    console.error('[FAIL] Simple JSON parse failed', e);
    process.exit(1);
}

const escapedJson = `{"text": "Hello \\"World\\""}`;
try {
    const ast = parseJsonWithLoc(escapedJson);
    assert.strictEqual(ast.value.text, 'Hello "World"');
    console.log('[OK] Escaped string parsed');
} catch (e) {
    console.error('[FAIL] Escaped JSON parse failed', e);
    process.exit(1);
}

console.log('--- All Tests Passed ---');
