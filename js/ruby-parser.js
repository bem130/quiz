/**
 * Ruby Parser for "type": "content" tokens.
 *
 * Implements a parser for the format:
 *   [Base/Reading] -> <ruby><rb>Base</rb><rt>Reading</rt></ruby>
 *   {Term/English} -> <span class="term"><ruby>...</ruby><span class="term-alt">English</span></span>
 *
 * Also handles plain text and escapes.
 */

/**
 * @typedef {Object} SegmentPlain
 * @property {"Plain"} kind
 * @property {string} text
 */

/**
 * @typedef {Object} SegmentAnnotated
 * @property {"Annotated"} kind
 * @property {InlineSegment[]} base
 * @property {string} reading
 */

/**
 * @typedef {Object} SegmentTerm
 * @property {"Term"} kind
 * @property {TermChildSegment[]} children
 * @property {string} english
 */

/**
 * @typedef {Object} SegmentMath
 * @property {"Math"} kind
 * @property {string} tex
 * @property {boolean} display
 */

/**
 * @typedef {SegmentPlain | SegmentAnnotated | SegmentTerm | SegmentMath} Segment
 */

/**
 * @typedef {SegmentPlain | SegmentMath} InlineSegment
 */

/**
 * @typedef {SegmentPlain | SegmentAnnotated | SegmentMath} TermChildSegment
 */

/**
 * @typedef {Object} Token
 * @property {"Symbol"|"Text"} kind
 * @property {string} value
 */

/**
 * HTML escape helper
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Tokenize the input string into a list of tokens.
 * Distinguishes between syntax symbols and plain text (including escaped symbols).
 *
 * Special characters: '[', ']', '/', '{', '}'
 *
 * @param {string} input
 * @returns {Token[]}
 */
function tokenize(input) {
    const tokens = [];
    let i = 0;
    const len = input.length;
    const SPECIAL_CHARS = ['[', ']', '/', '{', '}'];

    while (i < len) {
        const char = input[i];

        if (char === '\\') {
            // Escape sequence
            if (i + 1 < len) {
                const next = input[i + 1];
                // If next is special or backslash, treat as literal text
                if ([...SPECIAL_CHARS, '\\'].includes(next)) {
                    tokens.push({ kind: "Text", value: next });
                    i += 2;
                } else {
                    // Backslash followed by normal char -> keep backslash?
                    // Or just treat backslash as literal?
                    // Usually \a -> \a if a is not special.
                    tokens.push({ kind: "Text", value: '\\' });
                    i++;
                }
            } else {
                // Trailing backslash
                tokens.push({ kind: "Text", value: '\\' });
                i++;
            }
        } else if (SPECIAL_CHARS.includes(char)) {
            tokens.push({ kind: "Symbol", value: char });
            i++;
        } else {
            // Accumulate normal chars
            let j = i;
            while (j < len) {
                const c = input[j];
                if (c === '\\' || SPECIAL_CHARS.includes(c)) {
                    break;
                }
                j++;
            }
            tokens.push({ kind: "Text", value: input.slice(i, j) });
            i = j;
        }
    }
    return tokens;
}

/**
 * Split a string into inline segments (plain or math).
 * Handles escaped dollar signs to allow literal $ characters.
 *
 * @param {string} text
 * @returns {InlineSegment[]}
 */
function splitInlineMathSegments(text) {
    const segments = [];
    let i = 0;
    const len = text.length;
    let plainBuffer = "";

    const flushPlain = () => {
        if (plainBuffer.length > 0) {
            segments.push({ kind: "Plain", text: plainBuffer });
            plainBuffer = "";
        }
    };

    const isEscaped = (idx) => {
        let count = 0;
        for (let j = idx - 1; j >= 0 && text[j] === '\\'; j--) {
            count++;
        }
        return count % 2 === 1;
    };

    while (i < len) {
        if (text.startsWith('$$', i) && !isEscaped(i)) {
            let end = i + 2;
            while (end < len) {
                if (text.startsWith('$$', end) && !isEscaped(end)) break;
                end++;
            }
            if (end < len) {
                flushPlain();
                segments.push({
                    kind: "Math",
                    tex: text.slice(i + 2, end),
                    display: true
                });
                i = end + 2;
                continue;
            }
        }

        if (text[i] === '$' && !isEscaped(i)) {
            let end = i + 1;
            while (end < len) {
                if (text[end] === '$' && !isEscaped(end)) break;
                end++;
            }
            if (end < len) {
                flushPlain();
                segments.push({
                    kind: "Math",
                    tex: text.slice(i + 1, end),
                    display: false
                });
                i = end + 1;
                continue;
            }
        }

        plainBuffer += text[i];
        i++;
    }
    flushPlain();
    return segments;
}

/**
 * Append inline segments, merging adjacent plain nodes.
 *
 * @param {TermChildSegment[]} target
 * @param {InlineSegment[]} incoming
 */
function appendInlineSegments(target, incoming) {
    for (const seg of incoming) {
        if (seg.kind === 'Plain') {
            const last = target[target.length - 1];
            if (last && last.kind === 'Plain') {
                last.text += seg.text;
            } else {
                target.push(seg);
            }
        } else {
            target.push(seg);
        }
    }
}

/**
 * Parse a ruby block: [Base/Reading]
 * Expects the cursor to be at '['.
 *
 * @param {Token[]} tokens
 * @param {number} start
 * @returns {{ segment: SegmentAnnotated, nextIndex: number } | null}
 */
function parseRubyBlock(tokens, start) {
    // 1. Check '['
    if (tokens[start].kind !== 'Symbol' || tokens[start].value !== '[') return null;

    let i = start + 1;
    let base = "";
    let reading = "";
    let foundSlash = false;

    while (i < tokens.length) {
        const t = tokens[i];

        if (t.kind === 'Symbol' && t.value === ']') {
            // End of block
            if (!foundSlash) {
                // [Text] -> treat as plain text
                return null;
            }
            return {
                segment: { kind: "Annotated", base: splitInlineMathSegments(base), reading },
                nextIndex: i + 1
            };
        } else if (t.kind === 'Symbol' && t.value === '/') {
            if (foundSlash) {
                // Second slash -> treat as part of reading
                reading += t.value;
            } else {
                foundSlash = true;
            }
            i++;
        } else if (t.kind === 'Symbol' && t.value === '[') {
            // Nested '['? Not allowed in simple ruby parser.
            return null;
        } else {
            // Text or other symbols (like { } inside ruby?)
            // Treat as content
            if (foundSlash) {
                reading += t.value;
            } else {
                base += t.value;
            }
            i++;
        }
    }

    // Unclosed '['
    return null;
}

/**
 * Parse a term block: {Term/English} or {Term}
 * Expects the cursor to be at '{'.
 *
 * @param {Token[]} tokens
 * @param {number} start
 * @returns {{ segment: SegmentTerm, nextIndex: number } | null}
 */
function parseTermBlock(tokens, start) {
    if (tokens[start].kind !== 'Symbol' || tokens[start].value !== '{') return null;

    let i = start + 1;
    let jpSegments = [];
    let english = "";
    let foundSlash = false;
    let jpBuffer = "";

    const flushJapaneseBuffer = () => {
        if (!jpBuffer) return;
        const inlineSegments = splitInlineMathSegments(jpBuffer);
        appendInlineSegments(jpSegments, inlineSegments);
        jpBuffer = "";
    };

    while (i < tokens.length) {
        const t = tokens[i];

        if (t.kind === 'Symbol' && t.value === '}') {
            flushJapaneseBuffer();
            return {
                segment: { kind: "Term", children: jpSegments, english },
                nextIndex: i + 1
            };
        }

        if (foundSlash) {
            // English part
            english += t.value;
            i++;
            continue;
        }

        if (t.kind === 'Symbol' && t.value === '/') {
            flushJapaneseBuffer();
            foundSlash = true;
            i++;
            continue;
        }

        // Japanese part
        if (t.kind === 'Symbol' && t.value === '[') {
            flushJapaneseBuffer();
            const rubyResult = parseRubyBlock(tokens, i);
            if (rubyResult) {
                jpSegments.push(rubyResult.segment);
                i = rubyResult.nextIndex;
                continue;
            }
        }

        // Plain text or unparsed symbols in Japanese part
        jpBuffer += t.value;
        i++;
    }

    // Unclosed '{'
    return null;
}

/**
 * Parse the line into segments.
 *
 * @param {string} line
 * @returns {Segment[]}
 */
function parseLineToSegments(line) {
    const tokens = tokenize(line);
    const segments = [];
    let i = 0;

    while (i < tokens.length) {
        const t = tokens[i];

        if (t.kind === 'Symbol' && t.value === '{') {
            const result = parseTermBlock(tokens, i);
            if (result) {
                segments.push(result.segment);
                i = result.nextIndex;
                continue;
            }
        }

        if (t.kind === 'Symbol' && t.value === '[') {
            const result = parseRubyBlock(tokens, i);
            if (result) {
                segments.push(result.segment);
                i = result.nextIndex;
                continue;
            }
        }

        // Treat as plain text
        const last = segments[segments.length - 1];
        if (last && last.kind === "Plain") {
            last.text += t.value;
        } else {
            segments.push({ kind: "Plain", text: t.value });
        }
        i++;
    }

    return segments;
}

/**
 * Convert inline segments to plain text (math retains $...$ wrappers).
 *
 * @param {InlineSegment[]} segments
 * @returns {string}
 */
function inlineSegmentsToPlainText(segments) {
    let text = '';
    (segments || []).forEach((seg) => {
        if (seg.kind === 'Plain') {
            text += seg.text || '';
            return;
        }
        if (seg.kind === 'Math') {
            if (seg.tex) {
                text += seg.display ? `$$${seg.tex}$$` : `$${seg.tex}$`;
            }
        }
    });
    return text;
}

/**
 * Convert a ruby-annotated string to HTML.
 *
 * @param {string} line
 * @returns {string}
 */
export function rubyLineToHtml(line) {
    const segments = parseLineToSegments(line);
    return segments.map(seg => {
        if (seg.kind === "Plain") {
            return escapeHtml(seg.text);
        } else if (seg.kind === "Annotated") {
            return `<ruby><rb>${escapeHtml(inlineSegmentsToPlainText(seg.base))}</rb><rt>${escapeHtml(seg.reading)}</rt></ruby>`;
        } else if (seg.kind === "Term") {
            const jpHtml = seg.children.map(child => {
                if (child.kind === "Annotated") {
                    return `<rb>${escapeHtml(inlineSegmentsToPlainText(child.base))}</rb><rt>${escapeHtml(child.reading)}</rt>`;
                }
                if (child.kind === "Math") {
                    return `<rb>${escapeHtml(inlineSegmentsToPlainText([child]))}</rb><rt></rt>`;
                }
                // Plain text inside term ruby
                return `<rb>${escapeHtml(child.text)}</rb><rt></rt>`;
            }).join("");

            let html = `<span class="term"><ruby>${jpHtml}</ruby>`;
            if (seg.english) {
                html += `<span class="term-alt">${escapeHtml(seg.english)}</span>`;
            }
            html += `</span>`;
            return html;
        }
        return "";
    }).join("");
}

/**
 * Split the source string into Math and Plain parts.
 *
 * @param {string} src
 * @returns {Array<{ kind: "plain", text: string } | { kind: "math", tex: string, display: boolean }>}
 */
function splitMathAndPlain(src) {
    const parts = [];
    let i = 0;
    const len = src.length;
    let plainBuffer = "";
    let bracketDepth = 0;
    let braceDepth = 0;

    const flushPlain = () => {
        if (plainBuffer.length > 0) {
            parts.push({ kind: "plain", text: plainBuffer });
            plainBuffer = "";
        }
    };

    while (i < len) {
        const ch = src[i];

        if (ch === '\\') {
            if (i + 1 < len) {
                plainBuffer += src.slice(i, i + 2);
                i += 2;
                continue;
            }
            plainBuffer += ch;
            i++;
            continue;
        }

        if (ch === '[') {
            bracketDepth++;
            plainBuffer += ch;
            i++;
            continue;
        }
        if (ch === ']') {
            bracketDepth = Math.max(0, bracketDepth - 1);
            plainBuffer += ch;
            i++;
            continue;
        }
        if (ch === '{') {
            braceDepth++;
            plainBuffer += ch;
            i++;
            continue;
        }
        if (ch === '}') {
            braceDepth = Math.max(0, braceDepth - 1);
            plainBuffer += ch;
            i++;
            continue;
        }

        const inAnnotation = bracketDepth > 0 || braceDepth > 0;
        if (!inAnnotation) {
            // Check for display math $$...$$
            if (src.startsWith('$$', i)) {
                const end = src.indexOf('$$', i + 2);
                if (end !== -1) {
                    flushPlain();
                    parts.push({ kind: "math", tex: src.slice(i + 2, end), display: true });
                    i = end + 2;
                    continue;
                }
            }

            // Check for inline math $...$
            if (ch === '$') {
                const end = src.indexOf('$', i + 1);
                if (end !== -1) {
                    flushPlain();
                    parts.push({ kind: "math", tex: src.slice(i + 1, end), display: false });
                    i = end + 1;
                    continue;
                }
            }
        }

        plainBuffer += ch;
        i++;
    }
    flushPlain();
    return parts;
}

/**
 * Parse content with Ruby, Term, and Math support.
 *
 * @param {string} line
 * @returns {Segment[]}
 */
export function parseContentToSegments(line) {
    const parts = splitMathAndPlain(line);
    const segments = [];

    for (const part of parts) {
        if (part.kind === 'math') {
            segments.push({ kind: "Math", tex: part.tex, display: part.display });
        } else {
            // Plain text part -> parse for Ruby/Term
            const subSegments = parseLineToSegments(part.text);
            segments.push(...subSegments);
        }
    }
    return segments;
}
