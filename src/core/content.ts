/** 表示記法の位置はUTF-16の半開区間。HTMLや外部資産はこの層では扱わない。 */
export type SourceRange = Readonly<{ start: number; end: number }>;
export type ContentSegment =
    | Readonly<{ kind: 'Plain'; text: string; range: SourceRange }>
    | Readonly<{ kind: 'Escape'; value: '\n'; range: SourceRange }>
    | Readonly<{ kind: 'Math'; tex: string; display: boolean; range: SourceRange }>
    | Readonly<{ kind: 'Annotated'; base: readonly ContentSegment[]; reading: string; range: SourceRange }>
    | Readonly<{ kind: 'Gloss'; base: readonly ContentSegment[]; glosses: readonly (readonly ContentSegment[])[]; range: SourceRange }>;

type MathPart = Readonly<{ tex: string; display: boolean; end: number }>;
type SyntaxIndex = Readonly<{ closes: ReadonlyMap<number, number>; maths: ReadonlyMap<number, MathPart> }>;
const ESCAPABLE = new Set(['[', ']', '{', '}', '/', '\\', '$']);

function syntaxIndex(text: string): SyntaxIndex {
    const closes = new Map<number, number>();
    const maths = new Map<number, MathPart>();
    const stack: { char: string; start: number }[] = [];
    let i = 0;
    while (i < text.length) {
        const char = text.charAt(i);
        if (char === '\\') { i += 2; continue; }
        if (char === '$') {
            const delimiter = text.startsWith('$$', i) ? '$$' : '$';
            let end = i + delimiter.length;
            while (end < text.length) {
                if (text.charAt(end) === '\\') { end += 2; continue; }
                if (text.startsWith(delimiter, end)) break;
                end += 1;
            }
            if (end < text.length) {
                maths.set(i, { tex: text.slice(i + delimiter.length, end), display: delimiter === '$$', end: end + delimiter.length });
                i = end + delimiter.length;
                continue;
            }
        }
        if (char === '[' || char === '{') stack.push({ char, start: i });
        if (char === ']' || char === '}') {
            const top = stack.at(-1);
            if (top && ((top.char === '[' && char === ']') || (top.char === '{' && char === '}'))) {
                closes.set(top.start, i);
                stack.pop();
            }
        }
        i += 1;
    }
    return { closes, maths };
}

/** 最上位の区切りだけを取り出す。数式と入れ子のruby/gloss内のslashを保護する。 */
function divisions(text: string, start: number, end: number, index: SyntaxIndex): readonly number[] {
    const result: number[] = [];
    let i = start;
    while (i < end) {
        if (text.charAt(i) === '\\') { i += 2; continue; }
        const math = index.maths.get(i);
        if (math && math.end <= end) { i = math.end; continue; }
        const close = index.closes.get(i);
        if (close !== undefined && close < end) { i = close + 1; continue; }
        if (text.charAt(i) === '/') result.push(i);
        i += 1;
    }
    return result;
}

function readRange(text: string, start: number, end: number, index: SyntaxIndex, depth: number): readonly ContentSegment[] {
    const segments: ContentSegment[] = [];
    let buffer = '';
    let bufferStart = start;
    let i = start;
    const flush = (): void => {
        if (buffer.length > 0) segments.push({ kind: 'Plain', text: buffer, range: { start: bufferStart, end: i } });
        buffer = '';
    };
    while (i < end) {
        const char = text.charAt(i);
        if (char === '\\' && ESCAPABLE.has(text.charAt(i + 1))) {
            if (!buffer) bufferStart = i;
            buffer += text.charAt(i + 1);
            i += 2;
            continue;
        }
        const math = index.maths.get(i);
        if (math && math.end <= end) {
            flush();
            segments.push({ kind: 'Math', tex: math.tex, display: math.display, range: { start: i, end: math.end } });
            i = math.end;
            continue;
        }
        const close = index.closes.get(i);
        if (close !== undefined && close < end && depth < 32) {
            const slashes = divisions(text, i + 1, close, index);
            const slash = slashes.at(0);
            if (char === '{' || (char === '[' && slash !== undefined)) {
                flush();
                const range = { start: i, end: close + 1 };
                if (char === '[' && slash !== undefined) {
                    const reading = text.slice(slash + 1, close).replace(/\\([[\]{}/\\$])/g, '$1');
                    segments.push({ kind: 'Annotated', base: readRange(text, i + 1, slash, index, depth + 1), reading, range });
                } else {
                    const boundaries = [i, ...slashes, close];
                    const parts: (readonly ContentSegment[])[] = [];
                    for (let p = 0; p < boundaries.length - 1; p += 1) {
                        const left = boundaries.at(p);
                        const right = boundaries.at(p + 1);
                        if (left !== undefined && right !== undefined) parts.push(readRange(text, left + 1, right, index, depth + 1));
                    }
                    segments.push({ kind: 'Gloss', base: parts.at(0) ?? [], glosses: parts.slice(1), range });
                }
                i = close + 1;
                continue;
            }
        }
        if (char === '\n') {
            flush();
            segments.push({ kind: 'Escape', value: '\n', range: { start: i, end: i + 1 } });
            i += 1;
            continue;
        }
        if (!buffer) bufferStart = i;
        buffer += char;
        i += 1;
    }
    flush();
    return segments;
}

/** ruby/glossの入れ子は32段まで解釈し、それ以上や閉じていない記法は文字列として保持する。 */
export function parseContentToSegments(text: string): readonly ContentSegment[] {
    return readRange(text, 0, text.length, syntaxIndex(text), 0);
}

export function segmentsToPlainText(segments: readonly ContentSegment[]): string {
    return segments.map((segment) => {
        switch (segment.kind) {
            case 'Plain': return segment.text;
            case 'Escape': return segment.value;
            case 'Math': return segment.display ? `$$${segment.tex}$$` : `$${segment.tex}$`;
            case 'Annotated': return segmentsToPlainText(segment.base);
            case 'Gloss': {
                const alternatives = segment.glosses.map(segmentsToPlainText).filter((value) => value.length > 0);
                return segmentsToPlainText(segment.base) + (alternatives.length > 0 ? ` (${alternatives.join(' / ')})` : '');
            }
        }
    }).join('');
}

export function plainText(text: string): string {
    return segmentsToPlainText(parseContentToSegments(text));
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/** HTMLが必要な検証・出力用。入力文字列は常にescapeし、SVG等の生HTMLは受け入れない。 */
export function rubyLineToHtml(text: string): string {
    const render = (segments: readonly ContentSegment[]): string => segments.map((segment): string => {
        switch (segment.kind) {
            case 'Plain': return escapeHtml(segment.text);
            case 'Escape': return '<br/>';
            case 'Math': return escapeHtml(segment.display ? `$$${segment.tex}$$` : `$${segment.tex}$`);
            case 'Annotated': return `<ruby><rb>${render(segment.base)}</rb><rt>${escapeHtml(segment.reading)}</rt></ruby>`;
            case 'Gloss': return `<span class="gloss">${render(segment.base)}${segment.glosses.length > 0 ? `<span class="gloss-alts">${segment.glosses.map((alternative) => `<span class="gloss-alt">${render(alternative)}</span>`).join('')}</span>` : ''}</span>`;
        }
    }).join('');
    return render(parseContentToSegments(text));
}
