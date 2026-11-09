import { tokenizeKatex } from '../../src/core/katex-parser.ts';
import type { KatexSegment, KatexSegmentKind } from '../../src/core/katex-parser.ts';

// 返却配列と各区間の変更をコンパイル時に拒否する契約。
const segments = tokenizeKatex('x');
const segment: KatexSegment = { kind: 'Plain', text: 'x', start: 0, end: 1 };

// @ts-expect-error 読み取り専用の返却値を変更可能な配列として扱えない。
const mutableSegments: KatexSegment[] = segments;

// @ts-expect-error 区間の種別は読み取り専用である。
segment.kind = 'Symbol';

// @ts-expect-error 元位置の変更は禁止する。
segment.end = 4;

// @ts-expect-error 定義していない分類は受理しない。
const invalidKind: KatexSegmentKind = 'Unknown';

// @ts-expect-error 文字列以外の入力を受理しない。
tokenizeKatex(42);

// @ts-expect-error 開始位置は数値に限る。
tokenizeKatex('x', '10');

void invalidKind;
void mutableSegments;
