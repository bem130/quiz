/** ハイライト用の分類であり、TeXの構文の妥当性を表すものではない。 */
export type KatexSegmentKind = 'Command' | 'Brace' | 'Symbol' | 'Comment' | 'Plain';

/** 元文字列に対応する半開区間と、その区間を変更せず切り出した文字列。 */
export type KatexSegment = Readonly<{
    kind: KatexSegmentKind;
    text: string;
    start: number;
    end: number;
}>;

const BRACE_CHARS: ReadonlySet<string> = new Set(['{', '}', '(', ')', '[', ']', '|']);
const SYMBOL_CHARS: ReadonlySet<string> = new Set(['_', '^', '&', "'", '+', '-', '=', ',', '.']);

/**
 * TeXを編集器のハイライト用に分割する純粋関数。
 *
 * 区間はJavaScript文字列・編集器と同じUTF-16コード単位で数え、
 * `start`を含み`end`を含まない。`baseOffset`は元文書内の開始位置を渡す。
 * 結果は入力全体を重複も欠落もなく覆い、textの連結で入力に戻る。
 * ASCII英字のコマンドは任意の末尾`*`まで、その他のエスケープは
 * 次の1コード単位までを含める。末尾の単独バックスラッシュも保持する。
 * コメントはLFの直前までとし、改行自体は次のPlain区間へ残す。
 * 不完全な編集中の式も受け取り、TeXの意味や構文の正否は判定しない。
 *
 * 計算量は入力長nに対して時間O(n)、返却文字列を含む空間O(n)。
 */
export function tokenizeKatex(tex: string, baseOffset = 0): ReadonlyArray<KatexSegment> {
    const segments: KatexSegment[] = [];
    let i = 0;
    const len = tex.length;

    while (i < len) {
        const char = tex.charAt(i);

        if (char === '\\') {
            let j = i + 1;
            if (j < len) {
                if (/[a-zA-Z]/.test(tex.charAt(j))) {
                    while (j < len && /[a-zA-Z]/.test(tex.charAt(j))) {
                        j += 1;
                    }
                    if (j < len && tex.charAt(j) === '*') {
                        j += 1;
                    }
                } else {
                    j += 1;
                }
            }
            segments.push({ kind: 'Command', text: tex.slice(i, j), start: baseOffset + i, end: baseOffset + j });
            i = j;
            continue;
        }

        if (char === '%') {
            let j = i + 1;
            while (j < len && tex.charAt(j) !== '\n') {
                j += 1;
            }
            segments.push({ kind: 'Comment', text: tex.slice(i, j), start: baseOffset + i, end: baseOffset + j });
            i = j;
            continue;
        }

        if (BRACE_CHARS.has(char) || SYMBOL_CHARS.has(char)) {
            segments.push({
                kind: BRACE_CHARS.has(char) ? 'Brace' : 'Symbol',
                text: char,
                start: baseOffset + i,
                end: baseOffset + i + 1
            });
            i += 1;
            continue;
        }

        let end = i;
        while (end < len) {
            const current = tex.charAt(end);
            if (current === '\\' || current === '%' || BRACE_CHARS.has(current) || SYMBOL_CHARS.has(current)) {
                break;
            }
            end += 1;
        }
        segments.push({ kind: 'Plain', text: tex.slice(i, end), start: baseOffset + i, end: baseOffset + end });
        i = end;
    }

    return segments;
}
