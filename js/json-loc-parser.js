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

    function error(msg) {
        throw new Error(`${msg} at line ${line} column ${column}`);
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

        if (char === null) error('Unexpected end of input');
        error(`Unexpected character '${char}'`);
    }

    function parseObject(start) {
        advance(); // eat '{'
        skipWhitespace();

        const children = [];
        const value = {};

        if (peek() !== '}') {
            while (true) {
                skipWhitespace();
                const propStart = { line, column, offset: pos };

                if (peek() !== '"') error('Expected string key in object');
                const keyNode = parseString({ line, column, offset: pos });

                skipWhitespace();
                if (peek() !== ':') error('Expected ":" after key');
                advance(); // eat ':'

                const valueNode = parseValue();

                children.push({
                    type: 'Property',
                    key: keyNode,
                    value: valueNode,
                    loc: { start: propStart, end: valueNode.loc.end }
                });
                value[keyNode.value] = valueNode.value;

                skipWhitespace();
                if (peek() === '}') break;
                if (peek() !== ',') error('Expected "," or "}" in object');
                advance(); // eat ','
            }
        }

        advance(); // eat '}'
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

        if (peek() !== ']') {
            while (true) {
                const node = parseValue();
                children.push(node);
                value.push(node.value);

                skipWhitespace();
                if (peek() === ']') break;
                if (peek() !== ',') error('Expected "," or "]" in array');
                advance(); // eat ','
            }
        }

        advance(); // eat ']'
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
                    for (let i = 0; i < 4; i++) hex += advance();
                    result += String.fromCharCode(parseInt(hex, 16));
                } else {
                    result += esc;
                }
            } else {
                result += advance();
            }
        }
        error('Unterminated string');
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

        return {
            type: 'Number',
            value: Number(str),
            loc: makeLoc(start)
        };
    }

    function parseTrue(start) {
        if (input.substr(pos, 4) === 'true') {
            pos += 4;
            column += 4; // approximate column update (assuming no newlines in 'true')
            return { type: 'Boolean', value: true, loc: makeLoc(start) };
        }
        error('Expected true');
    }

    function parseFalse(start) {
        if (input.substr(pos, 5) === 'false') {
            pos += 5;
            column += 5;
            return { type: 'Boolean', value: false, loc: makeLoc(start) };
        }
        error('Expected false');
    }

    function parseNull(start) {
        if (input.substr(pos, 4) === 'null') {
            pos += 4;
            column += 4;
            return { type: 'Null', value: null, loc: makeLoc(start) };
        }
        error('Expected null');
    }

    skipWhitespace();
    const root = parseValue();
    skipWhitespace();
    if (pos < input.length) error('Unexpected data after JSON root');

    return root;
}
