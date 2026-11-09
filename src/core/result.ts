/** 内部の欠損は値として扱い、外部APIのnullableを境界で吸収する。 */
export type Option<T> =
    | Readonly<{ kind: 'some'; value: T }>
    | Readonly<{ kind: 'none' }>;

export type Result<T, E> =
    | Readonly<{ ok: true; value: T }>
    | Readonly<{ ok: false; error: E }>;

export const none: Option<never> = Object.freeze({ kind: 'none' });
export function some<T>(value: T): Option<T> { return { kind: 'some', value }; }
export function ok<T>(value: T): Result<T, never> { return { ok: true, value }; }
export function err<E>(error: E): Result<never, E> { return { ok: false, error }; }

export type DomainErrorCode =
    | 'invalid-json' | 'expected-object' | 'expected-array' | 'expected-string'
    | 'invalid-version' | 'missing-field' | 'unsupported-field' | 'unsupported-token'
    | 'invalid-value' | 'duplicate-id' | 'nested-hide' | 'hide-count'
    | 'invalid-reference' | 'cyclic-reference' | 'too-deep' | 'too-many-variants' | 'invalid-identity';

/** codeと文脈がエラーの正本であり、日本語の表示文はUIが組み立てる。 */
export type DomainError = Readonly<{
    kind: 'syntax' | 'schema' | 'identity';
    code: DomainErrorCode;
    path: string;
    detail: string;
}>;

export function domainError(
    code: DomainErrorCode, path: string, detail: string, kind: DomainError['kind'] = 'schema'
): DomainError { return { kind, code, path, detail }; }
