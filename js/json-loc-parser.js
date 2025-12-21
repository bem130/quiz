/**
 * Simple recursive descent JSON parser that produces an AST with location info.
 * 
 * AST Node Structure:
 * {
 *   type: 'Object' | 'Array' | 'String' | 'Number' | 'Boolean' | 'Null',
 *   value: any, // The parsed JS value
 *   loc: {
 *     start: { line, column, offset }, // 1-based line/column, 0-based offset
 *     end: { line, column, offset }
 *   },
 *   children: [] // For Object (Property nodes) and Array (Value nodes)
 * }
 * 
 * Property Node (for Object children):
 * {
 *   type: 'Property',
 *   key: Node (String),
 *   value: Node (Any),
 *   loc: ...
 * }
 */

export function parseJsonWithLoc(input) {
    let pos = 0;
    let line = 1;
    let column = 1;
    const errors = [];

    function recordError(msg) {
        errors.push({
            message: `${msg} at line ${line} column ${column}`,
            line,
            column,
            offset: pos
        });
    }

    function peek() {
        if (pos >= input.length) return null;
        return input[pos];
    }

    function advance() {
        const char = input[pos];
        if (char === '\n') {
            line++;
            column = 1;
        } else {
            column++;
        }
        pos++;
        return char;
    }

    function skipWhitespace() {
        while (pos < input.length) {
            const char = input[pos];
            if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
                advance();
            } else {
                break;
            }
        }
    }

    function makeLoc(start) {
        return {
            start: start,
            end: { line, column, offset: pos }
        };
    }

    function parseValue() {
        skipWhitespace();
        const start = { line, column, offset: pos };
        const char = peek();

        if (char === '{') return parseObject(start);
        if (char === '[') return parseArray(start);
        if (char === '"') return parseString(start);
        if (char === '-' || (char >= '0' && char <= '9')) return parseNumber(start);
        if (char === 't') return parseTrue(start);
        if (char === 'f') return parseFalse(start);
        if (char === 'n') return parseNull(start);

        if (char === null) {
            recordError('Unexpected end of input');
            return {
                type: 'Null',
                value: null,
                error: true,
                loc: makeLoc(start)
            };
        }
        recordError(`Unexpected character '${char}'`);
        advance();
        return {
            type: 'Null',
            value: null,
            error: true,
            loc: makeLoc(start)
        };
    }

    function parseObject(start) {
        advance(); // eat '{'
        skipWhitespace();

        const children = [];
        const value = {};

        while (peek() !== '}' && peek() !== null) {
            skipWhitespace();
            if (peek() === ',') {
                recordError('Unexpected comma in object');
                advance();
                continue;
            }
            const propStart = { line, column, offset: pos };

            let keyNode = null;
            if (peek() === '"') {
                keyNode = parseString({ line, column, offset: pos });
            } else if (peek() !== '}' && peek() !== null) {
                recordError('Expected string key in object');
                keyNode = parseBareKey(propStart);
            } else {
                break;
            }

            skipWhitespace();
            if (peek() !== ':') {
                recordError('Expected ":" after key');
                recoverTo([':', ',', '}']);
            }
            if (peek() === ':') {
                advance(); // eat ':'
            }

            skipWhitespace();
            let valueNode = null;
            if (peek() === ',' || peek() === '}' || peek() === null) {
                recordError('Missing value in object');
                valueNode = {
                    type: 'Null',
                    value: null,
                    error: true,
                    loc: makeLoc({ line, column, offset: pos })
                };
            } else {
                valueNode = parseValue();
            }

            if (!keyNode) {
                keyNode = {
                    type: 'String',
                    value: '',
                    loc: makeLoc(propStart)
                };
            }

            children.push({
                type: 'Property',
                key: keyNode,
                value: valueNode,
                loc: { start: propStart, end: valueNode.loc.end }
            });
            value[keyNode.value] = valueNode.value;

            skipWhitespace();
            if (peek() === '}') break;
            if (peek() === ',') {
                advance();
                skipWhitespace();
                if (peek() === '}') {
                    recordError('Trailing comma in object');
                    break;
                }
                continue;
            }
            if (peek() === null) break;
            recordError('Expected "," or "}" in object');
            continue;
        }

        if (peek() === '}') {
            advance(); // eat '}'
        } else {
            recordError('Unterminated object');
        }
        return {
            type: 'Object',
            value: value,
            children: children,
            loc: makeLoc(start)
        };
    }

    function parseArray(start) {
        advance(); // eat '['
        skipWhitespace();

        const children = [];
        const value = [];

        while (peek() !== ']' && peek() !== null) {
            skipWhitespace();
            if (peek() === ']') break;
            if (peek() === ',') {
                recordError('Missing value in array');
                const nullNode = {
                    type: 'Null',
                    value: null,
                    error: true,
                    loc: makeLoc({ line, column, offset: pos })
                };
                children.push(nullNode);
                value.push(nullNode.value);
                advance();
                continue;
            }
            const node = parseValue();
            children.push(node);
            value.push(node.value);

            skipWhitespace();
            if (peek() === ']') break;
            if (peek() === ',') {
                advance();
                skipWhitespace();
                if (peek() === ']') {
                    recordError('Trailing comma in array');
                    break;
                }
                if (peek() === ',') {
                    recordError('Missing value in array');
                    const nullNode = {
                        type: 'Null',
                        value: null,
                        error: true,
                        loc: makeLoc({ line, column, offset: pos })
                    };
                    children.push(nullNode);
                    value.push(nullNode.value);
                    advance();
                    continue;
                }
                continue;
            }
            if (peek() === null) break;
            recordError('Expected "," or "]" in array');
            continue;
        }

        if (peek() === ']') {
            advance(); // eat ']'
        } else {
            recordError('Unterminated array');
        }
        return {
            type: 'Array',
            value: value,
            children: children,
            loc: makeLoc(start)
        };
    }

    function parseString(start) {
        advance(); // eat '"'
        let result = '';

        while (pos < input.length) {
            const char = input[pos]; // Don't advance immediately, handle escapes

            if (char === '"') {
                advance(); // eat closing '"'
                return {
                    type: 'String',
                    value: result,
                    loc: makeLoc(start)
                };
            }

            if (char === '\\') {
                advance(); // eat '\'
                const esc = advance();
                if (esc === '"') result += '"';
                else if (esc === '\\') result += '\\';
                else if (esc === '/') result += '/';
                else if (esc === 'b') result += '\b';
                else if (esc === 'f') result += '\f';
                else if (esc === 'n') result += '\n';
                else if (esc === 'r') result += '\r';
                else if (esc === 't') result += '\t';
                else if (esc === 'u') {
                    // unexpected simple handling for uXXXX
                    let hex = '';
                    for (let i = 0; i < 4; i++) {
                        if (pos >= input.length) break;
                        hex += advance();
                    }
                    if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                        result += String.fromCharCode(parseInt(hex, 16));
                    } else {
                        recordError('Invalid unicode escape');
                        result += `\\u${hex}`;
                    }
                } else {
                    recordError('Invalid escape sequence');
                    result += esc;
                }
            } else {
                if (char === '\n' || char === '\r') {
                    recordError('Unterminated string');
                    break;
                }
                result += advance();
            }
        }
        recordError('Unterminated string');
        return {
            type: 'String',
            value: result,
            loc: makeLoc(start)
        };
    }

    function parseNumber(start) {
        let str = '';
        if (peek() === '-') str += advance();

        while (peek() !== null && (peek() >= '0' && peek() <= '9')) {
            str += advance();
        }

        if (peek() === '.') {
            str += advance();
            while (peek() !== null && (peek() >= '0' && peek() <= '9')) {
                str += advance();
            }
        }

        if (peek() === 'e' || peek() === 'E') {
            str += advance();
            if (peek() === '+' || peek() === '-') str += advance();
            while (peek() !== null && (peek() >= '0' && peek() <= '9')) {
                str += advance();
            }
        }

        if (!str || str === '-' || str === '+') {
            recordError('Invalid number');
            return {
                type: 'Number',
                value: NaN,
                error: true,
                loc: makeLoc(start)
            };
        }

        return {
            type: 'Number',
            value: Number(str),
            loc: makeLoc(start)
        };
    }

    function parseTrue(start) {
        return parseLiteral(start, 'true', { type: 'Boolean', value: true });
    }

    function parseFalse(start) {
        return parseLiteral(start, 'false', { type: 'Boolean', value: false });
    }

    function parseNull(start) {
        return parseLiteral(start, 'null', { type: 'Null', value: null });
    }

    function parseLiteral(start, literal, nodeBase) {
        for (let i = 0; i < literal.length; i++) {
            if (peek() !== literal[i]) {
                recordError(`Expected ${literal}`);
                // consume remaining letters to avoid infinite loop
                while (peek() && /[a-zA-Z]/.test(peek())) {
                    advance();
                }
                return {
                    ...nodeBase,
                    error: true,
                    loc: makeLoc(start)
                };
            }
            advance();
        }
        return {
            ...nodeBase,
            loc: makeLoc(start)
        };
    }

    function parseBareKey(start) {
        let result = '';
        while (pos < input.length) {
            const ch = peek();
            if (
                ch === null ||
                ch === ':' ||
                ch === ',' ||
                ch === '}' ||
                ch === ' ' ||
                ch === '\t' ||
                ch === '\n' ||
                ch === '\r'
            ) {
                break;
            }
            result += advance();
        }
        if (!result) {
            result = '';
        }
        return {
            type: 'String',
            value: result,
            loc: makeLoc(start)
        };
    }

    function recoverTo(chars) {
        while (pos < input.length) {
            const ch = peek();
            if (chars.includes(ch)) {
                return;
            }
            advance();
        }
    }

    skipWhitespace();
    const root = parseValue();
    skipWhitespace();
    if (pos < input.length) recordError('Unexpected data after JSON root');

    if (root && typeof root === 'object') {
        root.errors = errors;
    }
    return root;
}
