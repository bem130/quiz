/**
 * KaTeX Syntax Parser for highlighting.
 */

/**
 * @typedef {Object} KatexSegment
 * @property {"Command" | "Brace" | "Symbol" | "Plain"} kind
 * @property {string} text
 * @property {number} start
 * @property {number} end
 */

/**
 * Tokenize a TeX string into segments.
 *
 * @param {string} tex
 * @param {number} baseOffset
 * @returns {KatexSegment[]}
 */
export function tokenizeKatex(tex, baseOffset = 0) {
    const segments = [];
    let i = 0;
    const len = tex.length;

    while (i < len) {
        const char = tex[i];

        if (char === '\\') {
            // Command: \ followed by letters or a single non-letter character
            let j = i + 1;
            if (j < len) {
                if (/[a-zA-Z]/.test(tex[j])) {
                    while (j < len && /[a-zA-Z]/.test(tex[j])) {
                        j++;
                    }
                } else {
                    // Single char command like \, or \{ or \\
                    j++;
                }
            }
            segments.push({
                kind: "Command",
                text: tex.slice(i, j),
                start: baseOffset + i,
                end: baseOffset + j
            });
            i = j;
            continue;
        }

        if (char === '{' || char === '}') {
            segments.push({
                kind: "Brace",
                text: char,
                start: baseOffset + i,
                end: baseOffset + i + 1
            });
            i++;
            continue;
        }

        if (/[_^&]/.test(char)) {
            segments.push({
                kind: "Symbol",
                text: char,
                start: baseOffset + i,
                end: baseOffset + i + 1
            });
            i++;
            continue;
        }

        // Plain text
        let k = i;
        while (k < len) {
            const c = tex[k];
            if (c === '\\' || c === '{' || c === '}' || /[_^&]/.test(c)) {
                break;
            }
            k++;
        }
        segments.push({
            kind: "Plain",
            text: tex.slice(i, k),
            start: baseOffset + i,
            end: baseOffset + k
        });
        i = k;
    }

    return segments;
}
