import { domainError, err, ok } from './result.ts';
import type { DomainError, Result } from './result.ts';

declare const packageBrand: unique symbol;
declare const patternBrand: unique symbol;
declare const rowBrand: unique symbol;
declare const conceptBrand: unique symbol;
declare const questionBrand: unique symbol;
export type PackageId = string & Readonly<{ [packageBrand]: true }>;
export type PatternId = string & Readonly<{ [patternBrand]: true }>;
export type RowId = string & Readonly<{ [rowBrand]: true }>;
export type ConceptId = string & Readonly<{ [conceptBrand]: true }>;
export type QuestionId = string & Readonly<{ [questionBrand]: true }>;
export type PackageSource =
    | Readonly<{ kind: 'remote'; url: string }>
    | Readonly<{ kind: 'draft'; id: string }>;

export function recordKey(parts: readonly string[]): string { return JSON.stringify(parts); }

/** キー中の区切り文字はJSON文字列の一部として保持し、位置で再分割しない。 */
export function parseRecordKey(value: unknown): Result<readonly string[], DomainError> {
    if (typeof value !== 'string') return err(domainError('invalid-identity', '$', 'key must be a string', 'identity'));
    try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed) || !parsed.every((part: unknown) => typeof part === 'string')) {
            return err(domainError('invalid-identity', '$', 'key must encode a string tuple', 'identity'));
        }
        const parts: string[] = [];
        for (const part of parsed) {
            if (typeof part !== 'string') return err(domainError('invalid-identity', '$', 'invalid tuple part', 'identity'));
            parts.push(part);
        }
        if (recordKey(parts) !== value) return err(domainError('invalid-identity', '$', 'key must be canonical JSON', 'identity'));
        return ok(parts);
    } catch {
        return err(domainError('invalid-identity', '$', 'key must encode JSON', 'identity'));
    }
}

function validRemote(value: string): boolean {
    // URLの解決・正規化はWeb境界で行い、coreへはfragmentなしの絶対HTTP(S) URLを渡す。
    return /^https?:\/\/[^\s/?#@]+(?:\/[^\s#]*)?$/u.test(value);
}
export function isPackageId(value: string): value is PackageId {
    const result = parseRecordKey(value);
    if (!result.ok) return false;
    const [kind, source] = result.value;
    return result.value.length === 2 && typeof source === 'string' &&
        ((kind === 'remote' && validRemote(source)) || (kind === 'draft' && source.trim().length > 0));
}
export function packageIdentity(source: PackageSource): Result<PackageId, DomainError> {
    const value = recordKey(source.kind === 'remote' ? ['remote', source.url] : ['draft', source.id]);
    return isPackageId(value) ? ok(value) : err(domainError('invalid-identity', '$.source', 'invalid package source', 'identity'));
}
export function parsePackageId(value: unknown): Result<PackageId, DomainError> {
    return typeof value === 'string' && isPackageId(value)
        ? ok(value) : err(domainError('invalid-identity', '$.packageId', 'invalid package identity', 'identity'));
}
function scoped(value: string, kind: string, length: number): boolean {
    const result = parseRecordKey(value);
    if (!result.ok || result.value.length !== length) return false;
    const packagePart = result.value[1];
    return result.value[0] === kind && typeof packagePart === 'string' && isPackageId(packagePart);
}
export function isPatternId(value: string): value is PatternId { return scoped(value, 'pattern', 3); }
export function isRowId(value: string): value is RowId { return scoped(value, 'row', 3); }
export function isConceptId(value: string): value is ConceptId { return scoped(value, 'concept', 3); }
export function isQuestionId(value: string): value is QuestionId { return scoped(value, 'question', 4); }
export function parsePatternId(value: unknown): Result<PatternId, DomainError> {
    return typeof value === 'string' && isPatternId(value) ? ok(value) : err(domainError('invalid-identity', '$.patternId', 'invalid pattern identity', 'identity'));
}
export function parseRowId(value: unknown): Result<RowId, DomainError> {
    return typeof value === 'string' && isRowId(value) ? ok(value) : err(domainError('invalid-identity', '$.rowId', 'invalid row identity', 'identity'));
}
export function parseConceptId(value: unknown): Result<ConceptId, DomainError> {
    return typeof value === 'string' && isConceptId(value) ? ok(value) : err(domainError('invalid-identity', '$.conceptId', 'invalid concept identity', 'identity'));
}
export function parseQuestionId(value: unknown): Result<QuestionId, DomainError> {
    return typeof value === 'string' && isQuestionId(value) ? ok(value) : err(domainError('invalid-identity', '$.questionId', 'invalid question identity', 'identity'));
}
export function patternId(packageId: PackageId, local: string): PatternId {
    const value = recordKey(['pattern', packageId, local]);
    if (isPatternId(value)) return value;
    throw new Error('Invalid package ID passed to patternId');
}
export function rowId(packageId: PackageId, local: string): RowId {
    const value = recordKey(['row', packageId, local]);
    if (isRowId(value)) return value;
    throw new Error('Invalid package ID passed to rowId');
}
export function conceptId(packageId: PackageId, local: string): ConceptId {
    const value = recordKey(['concept', packageId, local]);
    if (isConceptId(value)) return value;
    throw new Error('Invalid package ID passed to conceptId');
}
export function questionId(packageId: PackageId, patternLocal: string, rowLocal: string): QuestionId {
    const value = recordKey(['question', packageId, patternLocal, rowLocal]);
    if (isQuestionId(value)) return value;
    throw new Error('Invalid package ID passed to questionId');
}
