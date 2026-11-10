import { plainText } from '../core/content.ts';
import { err, ok } from '../core/result.ts';
import type { Result } from '../core/result.ts';

export type SvgError = Readonly<{ kind: 'invalid-svg' | 'unsafe-svg'; detail: string }>;
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
/** 実行時間そのものではなく、受理前に数えられる保守的な資源上限。 */
export const SVG_LIMITS = Object.freeze({
    source: 2_000_000, elements: 5_000, depth: 64, references: 10_000,
    pathCharacters: 200_000, pathNumbers: 20_000, text: 100_000,
    referenceDepth: 16, expandedWork: 100_000
});
const ELEMENTS = new Set(['svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'marker']);
const GRAPHICS = new Set(['svg', 'g', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan']);
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const NUMBER_PART = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g;
const LENGTH = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px|em|ex|pt|pc|mm|cm|in|%)?$/i;
const ID = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/;
const SCALARS = new Set(['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'dx', 'dy', 'stroke-width', 'stroke-dashoffset', 'font-size', 'letter-spacing', 'textLength', 'refX', 'refY', 'markerWidth', 'markerHeight', 'offset', 'fx', 'fy', 'fr']);
const NUMERIC = new Set(['opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'stroke-miterlimit', 'pathLength']);
const PAINT = new Set(['fill', 'stroke', 'stop-color', 'color']);
const REFERENCES = new Set(['clip-path', 'marker-start', 'marker-mid', 'marker-end']);
const ENUMS: Readonly<Record<string, readonly string[]>> = {
    'fill-rule': ['nonzero', 'evenodd'], 'clip-rule': ['nonzero', 'evenodd'],
    'stroke-linecap': ['butt', 'round', 'square'], 'stroke-linejoin': ['miter', 'round', 'bevel'],
    'text-anchor': ['start', 'middle', 'end'], 'dominant-baseline': ['auto', 'middle', 'central', 'hanging', 'alphabetic', 'text-before-edge', 'text-after-edge'],
    'font-style': ['normal', 'italic', 'oblique'], 'font-weight': ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
    'vector-effect': ['none', 'non-scaling-stroke'], 'gradientUnits': ['userSpaceOnUse', 'objectBoundingBox'],
    'clipPathUnits': ['userSpaceOnUse', 'objectBoundingBox'], 'markerUnits': ['strokeWidth', 'userSpaceOnUse'],
    'spreadMethod': ['pad', 'reflect', 'repeat'], 'lengthAdjust': ['spacing', 'spacingAndGlyphs']
};
type Reference = Readonly<{ target: number; kind: 'use' | 'resource' }>;
type SvgNode = {
    input: Element; output: SVGElement; depth: number; children: number[]; references: Reference[];
    ownWork: number; vertices: number;
};
let nextImageId = 0;

function invalid(detail: string): Result<never, SvgError> { return err({ kind: 'invalid-svg', detail }); }
function unsafe(detail: string): Result<never, SvgError> { return err({ kind: 'unsafe-svg', detail }); }
function safeNumber(value: string): boolean { return NUMBER.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1_000_000; }
function safeLength(value: string): boolean { return LENGTH.test(value) && Number.isFinite(Number.parseFloat(value)) && Math.abs(Number.parseFloat(value)) <= 1_000_000; }
function numbers(value: string): readonly string[] { return value.trim().split(/[\s,]+/); }
function localReference(value: string): string { return /^url\(\s*#([A-Za-z_][A-Za-z0-9_.:-]{0,127})\s*\)$/.exec(value)?.at(1) ?? ''; }
function paint(value: string): boolean {
    return /^(?:none|currentColor|transparent|[a-zA-Z]{1,32}|#[0-9a-fA-F]{3,8})$/.test(value) ||
        /^(?:rgb|rgba|hsl|hsla)\([0-9+.,%\s-]+\)$/.test(value) || localReference(value).length > 0;
}
function attributeAllowed(name: string, value: string): boolean {
    if (value.length > 200_000) return false;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) return false;
    }
    if (SCALARS.has(name)) return safeLength(value);
    if (NUMERIC.has(name)) return safeNumber(value);
    if (PAINT.has(name)) return paint(value);
    if (REFERENCES.has(name)) return value === 'none' || localReference(value).length > 0;
    const choices = ENUMS[name];
    if (choices) return choices.includes(value);
    switch (name) {
        case 'id': return ID.test(value);
        case 'class': return /^[A-Za-z0-9_\s-]{0,500}$/.test(value);
        case 'd': return /^[MmZzLlHhVvCcSsQqTtAaEe0-9+.,\s-]*$/.test(value) && (value.match(NUMBER_PART) ?? []).every(safeNumber);
        case 'points': return numbers(value).length % 2 === 0 && numbers(value).every(safeNumber);
        case 'stroke-dasharray': return value === 'none' || numbers(value).every(safeLength);
        case 'viewBox': return numbers(value).length === 4 && numbers(value).every(safeNumber);
        case 'transform':
        case 'gradientTransform': return /^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\(\s*[0-9eE+.,\s-]+\)\s*)+$/.test(value) && (value.match(NUMBER_PART) ?? []).every(safeNumber);
        case 'font-family': return /^[A-Za-z0-9 _,'-]{1,160}$/.test(value);
        case 'preserveAspectRatio': return /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(value);
        case 'orient': return value === 'auto' || value === 'auto-start-reverse' || safeNumber(value);
        case 'version': return value === '1.0' || value === '1.1' || value === '2.0';
        case 'baseProfile': return value === 'full' || value === 'tiny';
        default: return false;
    }
}

/** 再帰呼び出しを使わず、包含と参照の合成グラフを依存先から並べる。 */
function dependencyOrder(nodes: readonly SvgNode[]): Result<readonly number[], SvgError> {
    const remaining = nodes.map((node) => node.children.length + node.references.length);
    const parents: number[][] = nodes.map(() => []);
    for (const [index, node] of nodes.entries()) {
        for (const target of [...node.children, ...node.references.map((reference) => reference.target)]) parents.at(target)?.push(index);
    }
    const ready: number[] = [];
    for (const [index, count] of remaining.entries()) if (count === 0) ready.push(index);
    const order: number[] = [];
    for (let position = 0; position < ready.length; position += 1) {
        const index = ready.at(position);
        if (index === undefined) return invalid('参照グラフを構築できない');
        order.push(index);
        for (const parent of parents.at(index) ?? []) {
            const count = remaining.at(parent);
            if (count === undefined) return invalid('参照グラフを構築できない');
            remaining[parent] = count - 1;
            if (count === 1) ready.push(parent);
        }
    }
    return order.length === nodes.length ? ok(order) : unsafe('循環する内部参照');
}

/**
 * useを含む展開後の頂点数を先に求め、継承するmarker/paint/clipをその数で保守的に重み付けする。
 * 同じtargetを複数回使う辺も省略せず数え、循環のない乗算展開も描画前に拒否する。
 */
function checkWork(nodes: readonly SvgNode[], order: readonly number[]): Result<true, SvgError> {
    const vertices: number[] = nodes.map(() => 0);
    const work: number[] = nodes.map(() => 0);
    const referenceDepth: number[] = nodes.map(() => 0);
    for (const index of order) {
        const node = nodes.at(index);
        if (!node) return invalid('参照グラフを評価できない');
        let totalVertices = node.vertices;
        let depth = 0;
        for (const child of node.children) {
            totalVertices += vertices.at(child) ?? 0;
            depth = Math.max(depth, referenceDepth.at(child) ?? 0);
        }
        for (const reference of node.references) {
            if (reference.kind === 'use') totalVertices += vertices.at(reference.target) ?? 0;
            depth = Math.max(depth, (referenceDepth.at(reference.target) ?? 0) + 1);
        }
        if (depth > SVG_LIMITS.referenceDepth || totalVertices > SVG_LIMITS.expandedWork) return unsafe('参照の深さまたは展開量が上限を超えている');
        vertices[index] = totalVertices;
        referenceDepth[index] = depth;
        let totalWork = node.ownWork;
        for (const child of node.children) totalWork += work.at(child) ?? 0;
        for (const reference of node.references) {
            const multiplier = reference.kind === 'use' ? 1 : Math.max(1, totalVertices);
            totalWork += multiplier * (work.at(reference.target) ?? 0);
            if (totalWork > SVG_LIMITS.expandedWork) return unsafe('参照先を含む描画量が上限を超えている');
        }
        if (totalWork > SVG_LIMITS.expandedWork) return unsafe('描画量が上限を超えている');
        work[index] = totalWork;
    }
    return ok(true);
}

/**
 * 静的SVGの許可部分集合だけを新DOMへ再構成するWeb境界。
 * 生DOM/innerHTMLを挿入せず、URL・CSS・namespace・参照予算を検証する。
 * サブセットと資源上限の契約はdoc/svg-subset.mdに記載する。
 */
export function sanitizeSvg(source: string, alt: string): Result<SVGSVGElement, SvgError> {
    if (!alt.trim() || source.length > SVG_LIMITS.source || /<!DOCTYPE|<!ENTITY|<\?/i.test(source.replace(/^\s*<\?xml\s[^?]*\?>/, ''))) return invalid('説明の欠損、サイズ超過、またはXML宣言の不正');
    const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
    const input = parsed.documentElement;
    if (input.localName !== 'svg' || input.namespaceURI !== SVG_NS || parsed.querySelector('parsererror')) return invalid('SVG文書として解釈できない');
    const elements = [input, ...Array.from(input.querySelectorAll('*'))];
    if (elements.length > SVG_LIMITS.elements) return invalid('要素数が上限を超えている');
    const nodes: SvgNode[] = [];
    const indexes = new Map<Element, number>();
    const targets = new Map<string, number>();
    nextImageId += 1;
    const prefix = `quiz-svg-${nextImageId}-`;
    for (const [index, element] of elements.entries()) {
        if (element.namespaceURI !== SVG_NS || !ELEMENTS.has(element.localName)) return unsafe(`許可されていない要素: ${element.localName}`);
        const parent = element.parentElement;
        const parentIndex = parent ? indexes.get(parent) : undefined;
        const depth = parentIndex === undefined ? 0 : (nodes.at(parentIndex)?.depth ?? SVG_LIMITS.depth) + 1;
        if (depth > SVG_LIMITS.depth) return invalid('要素の深さが上限を超えている');
        const id = element.getAttribute('id');
        if (id !== null) {
            if (!ID.test(id) || targets.has(id)) return unsafe('不正または重複したID');
            targets.set(id, index);
        }
        indexes.set(element, index);
        const node: SvgNode = { input: element, output: document.createElementNS(SVG_NS, element.localName), depth, children: [], references: [], ownWork: 1, vertices: GRAPHICS.has(element.localName) ? 1 : 0 };
        nodes.push(node);
        if (parentIndex !== undefined) nodes.at(parentIndex)?.children.push(index);
    }
    let textCharacters = 0;
    let pathCharacters = 0;
    let pathNumbers = 0;
    let references = 0;
    for (const node of nodes) {
        const reference = (id: string, attribute: string): Result<string, SvgError> => {
            const index = targets.get(id);
            const target = index === undefined ? undefined : nodes.at(index);
            if (!target || index === undefined) return unsafe('参照先が同じSVG内に存在しない');
            const tag = target.input.localName;
            if ((attribute === 'href' && !GRAPHICS.has(tag)) || (attribute === 'clip-path' && tag !== 'clipPath') ||
                (attribute.startsWith('marker-') && tag !== 'marker') ||
                (PAINT.has(attribute) && tag !== 'linearGradient' && tag !== 'radialGradient')) return unsafe('内部参照の要素種別が一致しない');
            references += 1;
            if (references > SVG_LIMITS.references) return unsafe('参照数が上限を超えている');
            node.references.push({ target: index, kind: attribute === 'href' ? 'use' : 'resource' });
            return ok(prefix + id);
        };
        const copyAttribute = (name: string, value: string): Result<true, SvgError> => {
            if (!attributeAllowed(name, value)) return unsafe(`許可されていない属性または値: ${name}`);
            if (name === 'id') node.output.setAttribute('id', prefix + value);
            else if (name === 'class') node.output.setAttribute('class', value.split(/\s+/).filter(Boolean).map((part) => prefix + part).join(' '));
            else {
                const id = localReference(value);
                const mapped = id ? reference(id, name) : ok('');
                if (!mapped.ok) return mapped;
                node.output.setAttribute(name, id ? `url(#${mapped.value})` : value);
            }
            return ok(true);
        };
        const styles: string[] = [];
        for (const attribute of Array.from(node.input.attributes)) {
            if (attribute.namespaceURI === XMLNS_NS) continue;
            const name = attribute.localName;
            if (name === 'href' && (attribute.namespaceURI === null || attribute.namespaceURI === XLINK_NS)) {
                if (node.input.localName !== 'use' || !attribute.value.startsWith('#') || !ID.test(attribute.value.slice(1))) return unsafe('外部参照は許可されていない');
                const target = reference(attribute.value.slice(1), 'href'); if (!target.ok) return target;
                node.output.setAttribute('href', '#' + target.value);
            } else if (attribute.namespaceURI === XML_NS && name === 'space') {
                if (attribute.value !== 'default' && attribute.value !== 'preserve') return unsafe('xml:spaceの値が不正');
                node.output.setAttributeNS(XML_NS, 'xml:space', attribute.value);
            } else if (name === 'style' && attribute.namespaceURI === null) styles.push(attribute.value);
            else if (attribute.namespaceURI === null) {
                const copied = copyAttribute(name, attribute.value.trim()); if (!copied.ok) return copied;
            } else return unsafe('許可されていない属性namespace');
        }
        // CSSのstyleはpresentation属性より優先する。ただし許可した宣言を属性へ展開する。
        for (const style of styles) for (const declaration of style.split(';').filter((part) => part.trim())) {
            const separator = declaration.indexOf(':');
            if (separator < 0) return unsafe('不正なstyle属性');
            const property = declaration.slice(0, separator).trim();
            if (!SCALARS.has(property) && !NUMERIC.has(property) && !PAINT.has(property) && !REFERENCES.has(property) && !Object.hasOwn(ENUMS, property) && property !== 'stroke-dasharray' && property !== 'font-family') return unsafe(`許可されていないstyle: ${property}`);
            const copied = copyAttribute(property, declaration.slice(separator + 1).trim()); if (!copied.ok) return copied;
        }
        for (const child of Array.from(node.input.childNodes)) {
            if (child.nodeType === Node.ELEMENT_NODE && child instanceof Element) {
                const index = indexes.get(child);
                const output = index === undefined ? undefined : nodes.at(index)?.output;
                if (!output) return invalid('子要素を構築できない');
                node.output.append(output);
            } else if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
                const text = child.textContent ?? '';
                if (['text', 'tspan', 'title', 'desc'].includes(node.input.localName)) {
                    textCharacters += text.length;
                    node.ownWork += text.length;
                    node.vertices += text.length;
                    if (textCharacters > SVG_LIMITS.text) return unsafe('文字量が上限を超えている');
                    node.output.append(document.createTextNode(text));
                } else if (text.trim()) return unsafe('図形内の不正なテキスト');
            } else if (child.nodeType !== Node.COMMENT_NODE) return unsafe('許可されていないXML node');
        }
        const data = node.output.getAttribute('d') ?? node.output.getAttribute('points') ?? '';
        const tokens = data.match(NUMBER_PART) ?? [];
        pathCharacters += data.length;
        pathNumbers += tokens.length;
        node.ownWork += tokens.length;
        // 数値・コマンド数は暗黙の反復線分や閉路も含む頂点数の上界となる。
        node.vertices += tokens.length + (data.match(/[MmZzLlHhVvCcSsQqTtAa]/g) ?? []).length;
        if (pathCharacters > SVG_LIMITS.pathCharacters || pathNumbers > SVG_LIMITS.pathNumbers) return unsafe('経路データが上限を超えている');
    }
    const order = dependencyOrder(nodes); if (!order.ok) return order;
    const bounded = checkWork(nodes, order.value); if (!bounded.ok) return bounded;
    const output = nodes.at(0)?.output;
    if (!(output instanceof SVGSVGElement)) return invalid('SVG rootを作成できない');
    const boxAttribute = output.getAttribute('viewBox');
    let width: number;
    let height: number;
    if (boxAttribute !== null) {
        const box = numbers(boxAttribute);
        width = Number(box.at(2)); height = Number(box.at(3));
        if (box.length !== 4 || !box.every(safeNumber) || !(width > 0 && height > 0)) return invalid('viewBoxの幅と高さは正でなければならない');
    } else {
        const inputWidth = output.getAttribute('width') ?? '';
        const inputHeight = output.getAttribute('height') ?? '';
        if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:px)?$/.test(inputWidth) || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:px)?$/.test(inputHeight)) return invalid('正のviewBoxまたはpx単位のwidth/heightが必要');
        width = Number.parseFloat(inputWidth); height = Number.parseFloat(inputHeight);
        if (!(width > 0 && height > 0)) return invalid('図の寸法は正でなければならない');
        output.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }
    output.setAttribute('width', String(width)); output.setAttribute('height', String(height));
    output.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    output.setAttribute('role', 'img'); output.setAttribute('aria-label', plainText(alt));
    output.classList.add('quiz-svg');
    // 包含する文章・選択肢の幅と文字拡大に追随し、原図の比率を保つ。
    output.style.display = 'inline-block'; output.style.verticalAlign = 'middle';
    output.style.width = `min(100%, ${width}px, calc(min(24em, 70vh) * ${width / height}))`;
    output.style.maxWidth = '100%'; output.style.height = 'auto';
    output.style.maxHeight = 'min(24em, 70vh)'; output.style.aspectRatio = `${width} / ${height}`;
    output.style.objectFit = 'contain'; output.style.overflow = 'hidden';
    return ok(output);
}
