import { none, some } from './result.ts';
import type { Option } from './result.ts';

export type Style = 'bold' | 'italic' | 'sans' | 'serif';
type Styled = Readonly<{ styles: readonly Style[] }>;

export type TextSource =
    | Readonly<{ kind: 'literal'; value: string }>
    | Readonly<{ kind: 'field'; field: string }>;
export type KeyToken = Styled & Readonly<{ type: 'key'; field: string }>;
export type ListKeyToken = Styled & Readonly<{
    type: 'listkey'; field: string; separatorTokens: readonly Token[];
}>;
export type RubyToken = Styled & Readonly<{
    type: 'ruby'; base: readonly Token[]; ruby: readonly Token[];
}>;
export type KatexToken = Styled & Readonly<{ type: 'katex'; source: TextSource }>;
export type SmilesToken = Styled & Readonly<{
    type: 'smiles'; source: TextSource;
    maxHeightEm: Option<number>; maxHeightPx: Option<number>; zoomPadding: Option<number>;
}>;
export type SvgSource =
    | Readonly<{ kind: 'inline'; value: string }>
    | Readonly<{ kind: 'file'; src: string }>
    | Readonly<{ kind: 'field'; field: string }>;
export type SvgToken = Styled & Readonly<{ type: 'svg'; source: SvgSource; alt: string }>;
export type HideToken = Styled & Readonly<{
    type: 'hide'; id: string; value: readonly Token[];
    display: 'inline' | 'none';
    answer:
        | Readonly<{ mode: 'choice_from_entities'; groupField: Option<string> }>
        | Readonly<{ mode: 'choice_from_field'; field: string }>;
}>;
export type BreakToken = Styled & Readonly<{ type: 'br' | 'hr' }>;
export type Token = string | KeyToken | ListKeyToken | RubyToken | KatexToken | SmilesToken | SvgToken | HideToken | BreakToken;

export type RowValue = number | boolean | Token | readonly Token[] | readonly (readonly Token[])[];
export type Row = Readonly<{
    id: string; conceptId: Option<string>; fields: Readonly<Record<string, RowValue>>;
}>;
export type TipWhen = 'after_answer' | 'after_correct' | 'after_incorrect';
export type TipBlock = Readonly<{ id: string; when: TipWhen; tokens: readonly Token[] }>;
export type Pattern = Readonly<{
    id: string; label: string; description: string; tokens: readonly Token[]; tips: readonly TipBlock[];
}>;
export type PaletteColor = Readonly<{ light?: string; dark?: string; black?: string }>;
export type Palette = Readonly<Record<string, PaletteColor>>;
export type QuizFile = Readonly<{
    version: 3; title: string; description: string; table: readonly Row[]; patterns: readonly Pattern[];
    palette?: Palette;
}>;
export type EntryFile = Readonly<{
    version: 3; label: string; files: readonly string[];
    editorBasePath: Option<string>; editorFileMap: Readonly<Record<string, string>>;
}>;

/** JSON出力用の型。外部入力はこの型へ断言せずunknownから検証する。 */
export type JsonValue = string | number | boolean | readonly JsonValue[] | JsonObject;
export type JsonObject = Readonly<{ [key: string]: JsonValue }>;

export function getRowValue(row: Row, field: string): Option<RowValue> {
    if (field === 'id') return some(row.id);
    if (field === 'conceptId') return row.conceptId;
    const value = row.fields[field];
    return Object.hasOwn(row.fields, field) && value !== undefined ? some(value) : none;
}
