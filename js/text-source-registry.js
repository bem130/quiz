/**
 * @typedef {Object} SourceLocation
 * @property {string} file
 * @property {number} [line]
 * @property {number} [column]
 * @property {number} [endLine]
 * @property {number} [endColumn]
 * @property {string} [dataSetId]
 * @property {string} [rowId]
 * @property {string} [field]
 * @property {number} [tokenIndex]
 */

/**
 * @typedef {Object} RubyBufferItem
 * @property {string} file
 * @property {{line:number,column:number,endLine?:number,endColumn?:number}} [range]
 * @property {string} baseText
 * @property {string} rubyText
 * @property {SourceLocation} source
 */

const textSourceRegistry = new WeakMap();    // HTMLElement -> SourceLocation
const rubyBuffer = [];

/**
 * DOM 要素に元位置情報を紐付ける
 * @param {HTMLElement} el
 * @param {SourceLocation} loc
 */
export function attachSourceInfo(el, loc) {
    if (!el || !loc) return;
    textSourceRegistry.set(el, loc);

    // デバッグ用途: data 属性に軽く載せておく
    if (loc.file) {
        el.dataset.sourceFile = loc.file;
    }
    if (loc.line != null) {
        el.dataset.sourceLine = String(loc.line);
    }
    if (loc.column != null) {
        el.dataset.sourceCol = String(loc.column);
    }
}

/**
 * 要素（または親）から SourceLocation を探す
 * @param {HTMLElement} el
 * @returns {SourceLocation|null}
 */
export function findSourceInfo(el) {
    let cur = el;
    while (cur && cur instanceof HTMLElement) {
        const info = textSourceRegistry.get(cur);
        if (info) return info;
        cur = cur.parentElement;
    }
    return null;
}

export function clearRubyBuffer() {
    rubyBuffer.length = 0;
}

/**
 * @param {RubyBufferItem} item
 */
export function addRubyBufferItem(item) {
    rubyBuffer.push(item);
}

/**
 * 結果画面用にコピーを返す
 */
export function getRubyBufferSnapshot() {
    return rubyBuffer.slice();
}

/**
 * @param {HTMLElement} target
 * @param {SourceLocation} source
 * @returns {RubyBufferItem|null}
 */
export function buildRubyBufferItemFromDom(target, source) {
    const rubyEl = target.closest('ruby');
    if (!rubyEl) return null;

    const baseText = Array.from(rubyEl.querySelectorAll('rb'))
        .map((el) => el.textContent || '')
        .join('');
    const rubyText = Array.from(rubyEl.querySelectorAll('rt'))
        .map((el) => el.textContent || '')
        .join('');

    return {
        file: source.file,
        range: source.line != null
            ? {
                line: source.line,
                column: source.column || 1,
                endLine: source.endLine || source.line,
                endColumn: source.endColumn || source.column || 1
            }
            : undefined,
        baseText,
        rubyText,
        source
    };
}
