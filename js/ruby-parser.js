/**
 * Ruby Parser for "type": "content" tokens.
 *
 * Implements a parser for the format:
 *   (Base/Reading) -> <ruby><rb>Base</rb><rt>Reading</rt></ruby>
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
 * @property {string} base
 * @property {string} reading
 */

/**
 * @typedef {Object} SegmentMath
 * @property {"Math"} kind
 * @property {string} tex
 * @property {boolean} display
 */

/**
 * @typedef {SegmentPlain | SegmentAnnotated | SegmentMath} Segment
 */

/**
 * @typedef {Object} Word
 * @property {Segment[]} segments
 */

/**
 * @typedef {Object} Line
 * @property {Word[]} words
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
 * Tokenize the input string into a list of raw tokens.
 * This is a simplified version of the Rust tokenizer.
 *
 * Special characters: '(', ')', '/', '\'
 * Everything else is a char.
 *
 * @param {string} input
 * @returns {string[]}
 */
function tokenize(input) {
    const tokens = [];
    let i = 0;
    const len = input.length;

    while (i < len) {
        const char = input[i];

        if (char === '\\') {
            // Escape sequence
            if (i + 1 < len) {
                const next = input[i + 1];
                // In Rust parser: only special chars are escaped, others are kept as backslash + char?
                // Actually, for simplicity here:
                // If it's \, (, ), /, treat as literal.
                // Otherwise just keep the backslash?
                // Let's follow the Rust logic:
                // if next is special, push next. else push \ then next.
                if (['(', ')', '/', '\\'].includes(next)) {
                    tokens.push(next);
                    i += 2;
                } else {
                    tokens.push('\\');
                    i++;
                }
            } else {
                tokens.push('\\');
                i++;
            }
        } else if (['(', ')', '/'].includes(char)) {
            tokens.push(char);
            i++;
        } else {
            // Accumulate normal chars to avoid too many tokens?
            // Or just push char by char. Rust pushes char by char or special tokens.
            // Let's push char by char for simplicity, or optimize slightly.
            let j = i;
            while (j < len && !['(', ')', '/', '\\'].includes(input[j])) {
                j++;
            }
            tokens.push(input.slice(i, j));
            i = j;
        }
    }
    return tokens;
}

/**
 * Parse a ruby block: (Base/Reading)
 * Expects the cursor to be at '('.
 *
 * @param {string[]} tokens
 * @param {number} start
 * @returns {{ segment: SegmentAnnotated, nextIndex: number } | null}
 */
function parseRubyBlock(tokens, start) {
    // 1. Check '('
    if (tokens[start] !== '(') return null;

    let i = start + 1;
    let base = "";
    let reading = "";
    let foundSlash = false;

    while (i < tokens.length) {
        const t = tokens[i];
        if (t === ')') {
            // End of block
            if (!foundSlash) {
                // (Text) -> treat as plain text "(Text)"
                // In our logic, we return null to indicate "not a valid ruby block",
                // so the caller treats '(' as plain text.
                return null;
            }
            return {
                segment: { kind: "Annotated", base, reading },
                nextIndex: i + 1
            };
        } else if (t === '/') {
            if (foundSlash) {
                // Second slash? Treat as part of reading?
                // Or invalid? Rust parser usually splits at the first slash.
                // If we want to allow slashes in reading, we should have escaped them.
                // But if unescaped, it's ambiguous.
                // Let's assume it's part of reading.
                reading += t;
            } else {
                foundSlash = true;
            }
            i++;
        } else if (t === '(') {
            // Nested '('? Not allowed in simple ruby parser.
            // Treat as invalid ruby block.
            return null;
        } else {
            if (foundSlash) {
                reading += t;
            } else {
                base += t;
            }
            i++;
        }
    }

    // Unclosed '('
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

        if (t === '(') {
            const result = parseRubyBlock(tokens, i);
            if (result) {
                segments.push(result.segment);
                i = result.nextIndex;
                continue;
            }
        }

        // Treat as plain text
        // If previous segment is Plain, merge it?
        // Or just push new Plain.
        const last = segments[segments.length - 1];
        if (last && last.kind === "Plain") {
            last.text += t;
        } else {
            segments.push({ kind: "Plain", text: t });
        }
        i++;
    }

    return segments;
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
        } else {
            return `<ruby><rb>${escapeHtml(seg.base)}</rb><rt>${escapeHtml(seg.reading)}</rt></ruby>`;
        }
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

    const flushPlain = () => {
        if (plainBuffer.length > 0) {
            parts.push({ kind: "plain", text: plainBuffer });
            plainBuffer = "";
        }
    };

    while (i < len) {
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
        if (src[i] === '$') {
            const end = src.indexOf('$', i + 1);
            if (end !== -1) {
                flushPlain();
                parts.push({ kind: "math", tex: src.slice(i + 1, end), display: false });
                i = end + 1;
                continue;
            }
        }

        plainBuffer += src[i];
        i++;
    }
    flushPlain();
    return parts;
}

/**
 * Parse content with Ruby and Math support.
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
            // Plain text part -> parse for Ruby
            const subSegments = parseLineToSegments(part.text);
            segments.push(...subSegments);
        }
    }
    return segments;
}
