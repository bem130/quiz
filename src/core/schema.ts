import { domainError, err, none, ok, some } from './result.ts';
import type { DomainError, DomainErrorCode, Option, Result } from './result.ts';
import { getRowValue } from './model.ts';
import type {
    EntryFile, JsonObject, JsonValue, Pattern, QuizFile, Row, RowValue, Style,
    SvgSource, TextSource, TipBlock, Token
} from './model.ts';

const MAX_DEPTH = 64;
/** 各row×patternのhideを完全列挙できる範囲。超過を切り捨てて出題しない。 */
export const MAX_ANSWER_VARIANTS = 1024;

class SchemaFailure extends Error {
    readonly issue: DomainError;
    constructor(issue: DomainError) {
        super(issue.code);
        this.issue = issue;
    }
}
function fail(code: DomainErrorCode, path: string, detail: string): never {
    throw new SchemaFailure(domainError(code, path, detail));
}
function isArray(value: unknown): value is readonly unknown[] { return Array.isArray(value); }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !isArray(value);
}
function object(value: unknown, path: string): Readonly<Record<string, unknown>> {
    if (!isRecord(value)) fail('expected-object', path, 'object required');
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail('expected-object', path, 'plain object required');
    return value;
}
function array(value: unknown, path: string): readonly unknown[] {
    if (!isArray(value)) fail('expected-array', path, 'array required');
    return value;
}
function text(value: unknown, path: string, nonempty = true): string {
    if (typeof value !== 'string') fail('expected-string', path, 'string required');
    if (nonempty && !value.trim()) fail('invalid-value', path, 'nonempty string required');
    return value;
}
function optionalText(value: unknown, path: string, fallback: string): string {
    return value === undefined ? fallback : text(value, path, false);
}
function keys(value: Readonly<Record<string, unknown>>, allowed: readonly string[], path: string): void {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) fail('unsupported-field', `${path}.${key}`, key);
    }
}
function depth(value: number, path: string): void {
    if (value > MAX_DEPTH) fail('too-deep', path, 'maximum token nesting exceeded');
}
function optionalNumber(value: unknown, path: string): Option<number> {
    if (value === undefined) return none;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail('invalid-value', path, 'positive finite number required');
    return some(value);
}
function styles(value: unknown, path: string): readonly Style[] {
    if (value === undefined) return [];
    const result: Style[] = [];
    for (const [index, item] of array(value, path).entries()) {
        const style = text(item, `${path}[${index}]`);
        if (style === 'bold' || style === 'italic' || style === 'sans' || style === 'serif') {
            if (!result.includes(style)) result.push(style);
        }
        // v3の拡張スタイルは文字列なら無視する。非文字列は構造不正である。
    }
    return result;
}
function tokenList(value: unknown, path: string, allowHide: boolean, level: number): readonly Token[] {
    depth(level, path);
    return array(value, path).map((item, index) => token(item, `${path}[${index}]`, allowHide, level + 1));
}
function subTokens(value: unknown, path: string, level: number): readonly Token[] {
    return isArray(value) ? tokenList(value, path, false, level) : [token(value, path, false, level)];
}
function source(value: Readonly<Record<string, unknown>>, path: string): TextSource {
    const hasValue = Object.hasOwn(value, 'value');
    const hasField = Object.hasOwn(value, 'field');
    if (hasValue === hasField) fail('invalid-value', path, 'exactly one of value or field is required');
    return hasValue
        ? { kind: 'literal', value: text(value['value'], `${path}.value`, false) }
        : { kind: 'field', field: text(value['field'], `${path}.field`) };
}
function svgSource(value: Readonly<Record<string, unknown>>, path: string): SvgSource {
    const fields = ['value', 'src', 'field'].filter(key => Object.hasOwn(value, key));
    if (fields.length !== 1) fail('invalid-value', path, 'exactly one SVG source is required');
    if (Object.hasOwn(value, 'value')) return { kind: 'inline', value: text(value['value'], `${path}.value`) };
    if (Object.hasOwn(value, 'src')) return { kind: 'file', src: text(value['src'], `${path}.src`) };
    return { kind: 'field', field: text(value['field'], `${path}.field`) };
}
function token(value: unknown, path: string, allowHide: boolean, level: number): Token {
    depth(level, path);
    if (typeof value === 'string') return value;
    const data = object(value, path);
    const type = text(data['type'], `${path}.type`);
    const decoration = styles(data['styles'], `${path}.styles`);
    switch (type) {
        case 'key':
            keys(data, ['type', 'field', 'styles'], path);
            return { type, field: text(data['field'], `${path}.field`), styles: decoration };
        case 'listkey':
            keys(data, ['type', 'field', 'separatorTokens', 'styles'], path);
            return {
                type, field: text(data['field'], `${path}.field`), styles: decoration,
                separatorTokens: data['separatorTokens'] === undefined ? [] : tokenList(data['separatorTokens'], `${path}.separatorTokens`, false, level + 1)
            };
        case 'ruby':
            keys(data, ['type', 'base', 'ruby', 'styles'], path);
            return {
                type, styles: decoration,
                base: subTokens(data['base'], `${path}.base`, level + 1),
                ruby: subTokens(data['ruby'], `${path}.ruby`, level + 1)
            };
        case 'katex':
            keys(data, ['type', 'value', 'field', 'styles'], path);
            return { type, styles: decoration, source: source(data, path) };
        case 'smiles':
            keys(data, ['type', 'value', 'field', 'styles', 'maxHeightEm', 'maxHeightPx', 'zoomPadding'], path);
            return {
                type, styles: decoration, source: source(data, path),
                maxHeightEm: optionalNumber(data['maxHeightEm'], `${path}.maxHeightEm`),
                maxHeightPx: optionalNumber(data['maxHeightPx'], `${path}.maxHeightPx`),
                zoomPadding: optionalNumber(data['zoomPadding'], `${path}.zoomPadding`)
            };
        case 'svg':
            keys(data, ['type', 'value', 'src', 'field', 'alt', 'styles'], path);
            return { type, styles: decoration, source: svgSource(data, path), alt: text(data['alt'], `${path}.alt`) };
        case 'hide': {
            if (!allowHide) fail('nested-hide', path, 'hide is only allowed directly in pattern tokens');
            keys(data, ['type', 'id', 'value', 'answer', 'styles'], path);
            const answer = object(data['answer'], `${path}.answer`);
            keys(answer, ['mode', 'distractorSource'], `${path}.answer`);
            if (answer['mode'] !== 'choice_from_entities') fail('invalid-value', `${path}.answer.mode`, 'choice_from_entities required');
            let groupField: Option<string> = none;
            if (answer['distractorSource'] !== undefined) {
                const distractor = object(answer['distractorSource'], `${path}.answer.distractorSource`);
                keys(distractor, ['groupField'], `${path}.answer.distractorSource`);
                if (distractor['groupField'] !== undefined) groupField = some(text(distractor['groupField'], `${path}.answer.distractorSource.groupField`));
            }
            const values = tokenList(data['value'], `${path}.value`, false, level + 1);
            if (!values.length) fail('invalid-value', `${path}.value`, 'hide value must contain tokens');
            return { type, id: text(data['id'], `${path}.id`), value: values, answer: { mode: 'choice_from_entities', groupField }, styles: decoration };
        }
        case 'br': case 'hr':
            keys(data, ['type', 'styles'], path);
            return { type, styles: decoration };
        default:
            return fail('unsupported-token', `${path}.type`, type);
    }
}
function rowValue(value: unknown, path: string): RowValue {
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) fail('invalid-value', path, 'finite number required');
        return value;
    }
    if (isArray(value)) {
        if (value.some(isArray)) {
            if (!value.every(isArray)) fail('invalid-value', path, 'mixed token list and matrix');
            return value.map((entry, index) => tokenList(entry, `${path}[${index}]`, false, 0));
        }
        return tokenList(value, path, false, 0);
    }
    return token(value, path, false, 0);
}
function row(value: unknown, path: string): Row {
    const data = object(value, path);
    const id = text(data['id'], `${path}.id`);
    const concept = data['conceptId'] === undefined ? none : some(text(data['conceptId'], `${path}.conceptId`));
    const fields: Record<string, RowValue> = {};
    for (const key of Object.keys(data)) {
        if (key === 'id' || key === 'conceptId') continue;
        Object.defineProperty(fields, key, { value: rowValue(data[key], `${path}.${key}`), enumerable: true });
    }
    return { id, conceptId: concept, fields };
}
function tips(value: unknown, path: string): readonly TipBlock[] {
    if (value === undefined) return [];
    const ids = new Set<string>();
    return array(value, path).map((item, index) => {
        const current = `${path}[${index}]`;
        const data = object(item, current);
        keys(data, ['id', 'when', 'tokens'], current);
        const id = text(data['id'], `${current}.id`);
        if (ids.has(id)) fail('duplicate-id', `${current}.id`, id);
        ids.add(id);
        const when = data['when'] === undefined ? 'after_answer' : data['when'];
        if (when !== 'after_answer' && when !== 'after_correct' && when !== 'after_incorrect') fail('invalid-value', `${current}.when`, 'invalid tip timing');
        return { id, when, tokens: tokenList(data['tokens'], `${current}.tokens`, false, 0) };
    });
}
function pattern(value: unknown, path: string): Pattern {
    const data = object(value, path);
    keys(data, ['id', 'label', 'description', 'tokens', 'tips'], path);
    const id = text(data['id'], `${path}.id`);
    const tokens = tokenList(data['tokens'], `${path}.tokens`, true, 0);
    if (tokens.filter(item => typeof item !== 'string' && item.type === 'hide').length !== 1) {
        fail('hide-count', `${path}.tokens`, 'exactly one top-level hide is required');
    }
    return { id, label: optionalText(data['label'], `${path}.label`, id), description: optionalText(data['description'], `${path}.description`, ''), tokens, tips: tips(data['tips'], `${path}.tips`) };
}
function unique<T extends Readonly<{ id: string }>>(items: readonly T[], path: string): void {
    const ids = new Set<string>();
    for (const [index, item] of items.entries()) {
        if (ids.has(item.id)) fail('duplicate-id', `${path}[${index}].id`, item.id);
        ids.add(item.id);
    }
}
function isToken(value: RowValue): value is Token { return typeof value === 'string' || (!isArray(value) && typeof value === 'object'); }
function isTokenArray(value: RowValue): value is readonly Token[] { return isArray(value) && !value.some(isArray); }
function isTokenMatrix(value: RowValue): value is readonly (readonly Token[])[] { return isArray(value) && value.every(isArray); }

/** 全参照を辿り、欠損・型違い・行内keyの循環を読み込み時に排除する。 */
function references(tokens: readonly Token[], currentRow: Row, path: string, active: readonly string[], level: number): void {
    depth(level, path);
    function field(name: string): RowValue {
        const found = getRowValue(currentRow, name);
        if (found.kind === 'none') fail('invalid-reference', path, name);
        if (active.includes(name)) fail('cyclic-reference', path, name);
        return found.value;
    }
    for (const item of tokens) {
        if (typeof item === 'string') continue;
        switch (item.type) {
            case 'key': {
                const value = field(item.field);
                if (isArray(value)) {
                    if (!isTokenArray(value)) fail('invalid-reference', path, `key cannot reference matrix: ${item.field}`);
                    references(value, currentRow, path, [...active, item.field], level + 1);
                } else if (isToken(value)) references([value], currentRow, path, [...active, item.field], level + 1);
                break;
            }
            case 'listkey': {
                const value = field(item.field);
                if (!isTokenMatrix(value)) fail('invalid-reference', path, `listkey requires token matrix: ${item.field}`);
                for (const entry of value) references(entry, currentRow, path, [...active, item.field], level + 1);
                references(item.separatorTokens, currentRow, path, active, level + 1);
                break;
            }
            case 'ruby':
                references(item.base, currentRow, path, active, level + 1);
                references(item.ruby, currentRow, path, active, level + 1);
                break;
            case 'hide':
                references(item.value, currentRow, path, active, level + 1);
                if (item.answer.groupField.kind === 'some') {
                    const group = getRowValue(currentRow, item.answer.groupField.value);
                    if (group.kind === 'some' && typeof group.value !== 'string' && typeof group.value !== 'number' && typeof group.value !== 'boolean') {
                        fail('invalid-reference', path, 'group field must be scalar');
                    }
                }
                break;
            case 'katex': case 'smiles': case 'svg':
                if (item.source.kind === 'field' && typeof field(item.source.field) !== 'string') fail('invalid-reference', path, `${item.type} field must be string`);
                break;
            case 'br': case 'hr': break;
        }
    }
}
function answerVariantCount(tokens: readonly Token[], currentRow: Row, path: string, level: number): number {
    depth(level, path);
    let product = 1;
    for (const item of tokens) {
        let count = 1;
        if (typeof item !== 'string' && item.type === 'listkey') {
            const value = getRowValue(currentRow, item.field);
            if (value.kind === 'none' || !isTokenMatrix(value.value)) fail('invalid-reference', path, item.field);
            count = 0;
            for (const entry of value.value) {
                count += answerVariantCount(entry, currentRow, path, level + 1);
                if (count > MAX_ANSWER_VARIANTS) fail('too-many-variants', path, String(MAX_ANSWER_VARIANTS));
            }
        } else if (typeof item !== 'string' && item.type === 'key') {
            const value = getRowValue(currentRow, item.field);
            if (value.kind === 'some' && isTokenArray(value.value)) count = answerVariantCount(value.value, currentRow, path, level + 1);
            else if (value.kind === 'some' && typeof value.value !== 'string' && isToken(value.value)) count = answerVariantCount([value.value], currentRow, path, level + 1);
        }
        product *= count;
        if (product > MAX_ANSWER_VARIANTS) fail('too-many-variants', path, String(MAX_ANSWER_VARIANTS));
    }
    return product;
}
function boundary<T>(operation: () => T): Result<T, DomainError> {
    try { return ok(operation()); }
    catch (error) {
        return err(error instanceof SchemaFailure ? error.issue : domainError('invalid-value', '$', 'invalid or cyclic input'));
    }
}
function parseText<T>(value: string, parse: (input: unknown) => Result<T, DomainError>): Result<T, DomainError> {
    let decoded: unknown;
    try { decoded = JSON.parse(value); }
    catch { return err(domainError('invalid-json', '$', 'strict JSON required', 'syntax')); }
    return parse(decoded);
}
export function parseQuiz(value: unknown): Result<QuizFile, DomainError> {
    return boundary(() => {
        const data = object(value, '$');
        keys(data, ['version', 'title', 'description', 'table', 'patterns'], '$');
        if (data['version'] !== undefined && data['version'] !== 3) fail('invalid-version', '$.version', 'v3 required');
        const table = array(data['table'], '$.table').map((entry, index) => row(entry, `$.table[${index}]`));
        const patterns = array(data['patterns'], '$.patterns').map((entry, index) => pattern(entry, `$.patterns[${index}]`));
        if (!table.length || !patterns.length) fail('invalid-value', '$', 'table and patterns must be nonempty');
        unique(table, '$.table');
        unique(patterns, '$.patterns');
        for (const [rowIndex, current] of table.entries()) {
            for (const [patternIndex, item] of patterns.entries()) {
                const path = `$.table[${rowIndex}]:patterns[${patternIndex}]`;
                references(item.tokens, current, path, [], 0);
                for (const tip of item.tips) references(tip.tokens, current, path, [], 0);
                for (const itemToken of item.tokens) {
                    if (typeof itemToken !== 'string' && itemToken.type === 'hide') answerVariantCount(itemToken.value, current, path, 0);
                }
            }
        }
        return { version: 3, title: text(data['title'], '$.title'), description: text(data['description'], '$.description'), table, patterns };
    });
}
export function parseQuizJson(value: string): Result<QuizFile, DomainError> { return parseText(value, parseQuiz); }
export function parseEntry(value: unknown): Result<EntryFile, DomainError> {
    return boundary(() => {
        const data = object(value, '$');
        keys(data, ['version', 'label', 'files', 'editorBasePath', 'editorFileMap'], '$');
        if (data['version'] !== undefined && data['version'] !== 3) fail('invalid-version', '$.version', 'v3 required');
        const files = array(data['files'], '$.files').map((item, index) => text(item, `$.files[${index}]`));
        if (new Set(files).size !== files.length) fail('duplicate-id', '$.files', 'duplicate file path');
        const editorFileMap: Record<string, string> = {};
        if (data['editorFileMap'] !== undefined) {
            const mapping = object(data['editorFileMap'], '$.editorFileMap');
            for (const key of Object.keys(mapping)) Object.defineProperty(editorFileMap, key, { value: text(mapping[key], `$.editorFileMap.${key}`), enumerable: true });
        }
        return {
            version: 3, label: optionalText(data['label'], '$.label', 'Quiz'), files,
            editorBasePath: data['editorBasePath'] === undefined ? none : some(text(data['editorBasePath'], '$.editorBasePath')),
            editorFileMap
        };
    });
}
export function parseEntryJson(value: string): Result<EntryFile, DomainError> { return parseText(value, parseEntry); }

function sourceJson(value: TextSource): JsonObject {
    return value.kind === 'literal' ? { value: value.value } : { field: value.field };
}
function tokenJson(value: Token): JsonValue {
    if (typeof value === 'string') return value;
    const base = { type: value.type, styles: value.styles };
    switch (value.type) {
        case 'key': return { ...base, field: value.field };
        case 'listkey': return { ...base, field: value.field, separatorTokens: value.separatorTokens.map(tokenJson) };
        case 'ruby': return { ...base, base: value.base.map(tokenJson), ruby: value.ruby.map(tokenJson) };
        case 'katex': return { ...base, ...sourceJson(value.source) };
        case 'smiles': return {
            ...base, ...sourceJson(value.source),
            ...(value.maxHeightEm.kind === 'some' ? { maxHeightEm: value.maxHeightEm.value } : {}),
            ...(value.maxHeightPx.kind === 'some' ? { maxHeightPx: value.maxHeightPx.value } : {}),
            ...(value.zoomPadding.kind === 'some' ? { zoomPadding: value.zoomPadding.value } : {})
        };
        case 'svg': return {
            ...base, alt: value.alt,
            ...(value.source.kind === 'inline' ? { value: value.source.value } : value.source.kind === 'file' ? { src: value.source.src } : { field: value.source.field })
        };
        case 'hide': return {
            ...base, id: value.id, value: value.value.map(tokenJson),
            answer: {
                mode: value.answer.mode,
                ...(value.answer.groupField.kind === 'some' ? { distractorSource: { groupField: value.answer.groupField.value } } : {})
            }
        };
        case 'br': case 'hr': return base;
    }
}
function valueJson(value: RowValue): JsonValue {
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (isTokenMatrix(value)) return value.map(item => item.map(tokenJson));
    if (isTokenArray(value)) return value.map(tokenJson);
    return tokenJson(value);
}
/** 保存domainを外部v3へ戻す。backupはこの値をparseQuizで再検証して復元する。 */
export function quizToJson(value: QuizFile): JsonObject {
    return {
        version: 3, title: value.title, description: value.description,
        table: value.table.map(item => ({
            ...Object.fromEntries(Object.entries(item.fields).map(([key, fieldValue]) => [key, valueJson(fieldValue)])),
            id: item.id, ...(item.conceptId.kind === 'some' ? { conceptId: item.conceptId.value } : {})
        })),
        patterns: value.patterns.map(item => ({
            id: item.id, label: item.label, description: item.description, tokens: item.tokens.map(tokenJson),
            tips: item.tips.map(tip => ({ id: tip.id, when: tip.when, tokens: tip.tokens.map(tokenJson) }))
        }))
    };
}
export function serializeQuiz(value: QuizFile): string { return JSON.stringify(quizToJson(value), null, 2); }
