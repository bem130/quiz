import katex from 'katex';
import 'katex/dist/katex.min.css';
import './rich-text.css';
import initRDKit from '@rdkit/rdkit';
import type { MainModule } from '@rdkit/rdkit';
import rdkitWasmUrl from '@rdkit/rdkit/RDKit_minimal.wasm?url';
import { parseContentToSegments, plainText } from '../core/content.ts';
import type { ContentSegment } from '../core/content.ts';
import { getRowValue } from '../core/model.ts';
import type { Row, RowValue, SmilesToken, Token, TextSource } from '../core/model.ts';
import { none, some } from '../core/result.ts';
import type { Option } from '../core/result.ts';
import { fetchText, resolveHttpUrl } from './network.ts';
import { sanitizeSvg } from './svg.ts';
import type { QuizStorage } from './storage/database.ts';

export type RenderContext = Readonly<{
    baseUrl: string;
    answer: Option<Readonly<{ tokens: readonly Token[]; row: Row }>>;
    isCurrent: () => boolean;
    assets?: Pick<QuizStorage, 'getAsset' | 'saveAsset'>;
}>;
let rdkit: Option<Promise<MainModule>> = none;
const DEFAULT_ROW: Row = { id: 'display', conceptId: none, fields: {} };

function appendSegments(parent: HTMLElement, segments: readonly ContentSegment[]): void {
    for (const segment of segments) {
        switch (segment.kind) {
            case 'Plain': parent.append(document.createTextNode(segment.text)); break;
            case 'Escape': parent.append(document.createElement('br')); break;
            case 'Math': {
                const span = document.createElement('span');
                span.className = 'math';
                katex.render(segment.tex, span, { throwOnError: false, trust: false, strict: 'warn', maxExpand: 1000, displayMode: segment.display });
                parent.append(span);
                break;
            }
            case 'Annotated': {
                const ruby = document.createElement('ruby');
                const rb = document.createElement('rb');
                const rt = document.createElement('rt');
                appendSegments(rb, segment.base);
                rt.textContent = segment.reading;
                ruby.append(rb, rt);
                parent.append(ruby);
                break;
            }
            case 'Gloss': {
                const gloss = document.createElement('span');
                gloss.className = 'gloss';
                const base = document.createElement('span');
                base.className = 'gloss-base';
                appendSegments(base, segment.base);
                gloss.append(base);
                if (segment.glosses.length) {
                    const alternatives = document.createElement('span');
                    alternatives.className = 'gloss-alts';
                    const notes = document.createElement('span');
                    notes.className = 'gloss-notes';
                    const flow = document.createElement('span');
                    flow.className = 'gloss-note-flow';
                    for (const alternative of segment.glosses) {
                        const item = document.createElement('span');
                        item.className = 'gloss-alt';
                        appendSegments(item, alternative);
                        flow.append(item);
                    }
                    notes.append(flow);
                    alternatives.append(notes);
                    gloss.append(alternatives);
                }
                parent.append(gloss);
                break;
            }
        }
    }
}
export function richText(text: string): HTMLElement {
    const span = document.createElement('span');
    span.className = 'rich-text';
    appendSegments(span, parseContentToSegments(text));
    return span;
}
function tokenList(value: RowValue): value is readonly Token[] { return Array.isArray(value) && value.every((item: unknown) => !Array.isArray(item)); }
function tokenMatrix(value: RowValue): value is readonly (readonly Token[])[] { return Array.isArray(value) && value.every((item: unknown) => Array.isArray(item)); }
function valueTokens(value: RowValue): readonly Token[] {
    if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
    if (tokenMatrix(value)) return value.flatMap((entry, index) => index === 0 ? entry : [' / ', ...entry]);
    if (tokenList(value)) return value;
    return [value];
}
function sourceText(source: TextSource, row: Row): string {
    if (source.kind === 'literal') return source.value;
    const value = getRowValue(row, source.field);
    return value.kind === 'some' && (typeof value.value === 'string' || typeof value.value === 'number') ? String(value.value) : '';
}
function graphicFailure(target: HTMLElement, alt: string, detail: string): void {
    target.textContent = `${alt}（図を表示できない: ${detail}）`;
    target.classList.add('graphic-error');
}
function svgMarkup(target: HTMLElement, source: string, alt: string, context: RenderContext, limits?: SmilesToken): void {
    if (!context.isCurrent() || !target.isConnected) return;
    const parsed = sanitizeSvg(source, alt);
    if (!parsed.ok) { graphicFailure(target, limits === undefined ? plainText(alt) : alt, parsed.error.detail); return; }
    if (limits) {
        const em = limits.maxHeightEm.kind === 'some' ? Math.min(24, limits.maxHeightEm.value) : 24;
        const padding = limits.zoomPadding.kind === 'some' ? Math.min(1, limits.zoomPadding.value) : 1;
        const px = limits.maxHeightPx.kind === 'some' ? limits.maxHeightPx.value : 100_000;
        const ratio = 480 / 280;
        parsed.value.style.width = `min(100%, 480px, ${ratio * em * padding}em, ${ratio * px * padding}px, ${ratio * 70 * padding}vh)`;
        parsed.value.style.maxHeight = `min(${em * padding}em, ${px * padding}px, ${70 * padding}vh)`;
    }
    target.replaceChildren(parsed.value);
    target.classList.add('diagram');
}
async function renderSmiles(target: HTMLElement, smiles: string, context: RenderContext, token: SmilesToken): Promise<void> {
    try {
        const loading = rdkit.kind === 'some' ? rdkit.value : initRDKit({ locateFile: () => rdkitWasmUrl });
        rdkit = some(loading);
        const module = await loading;
        const molecule = module.get_mol(smiles) ?? module.get_qmol(smiles);
        if (!molecule) { if (context.isCurrent() && target.isConnected) graphicFailure(target, smiles, 'SMILESが不正'); return; }
        try { svgMarkup(target, molecule.get_svg(480, 280), `化学構造: ${smiles}`, context, token); }
        finally { molecule.delete(); }
    } catch (error) {
        rdkit = none;
        if (context.isCurrent() && target.isConnected) graphicFailure(target, smiles, error instanceof Error ? error.message : '化学描画の初期化失敗');
    }
}
async function renderFileSvg(target: HTMLElement, src: string, alt: string, context: RenderContext): Promise<void> {
    const label = plainText(alt);
    const url = resolveHttpUrl(src, context.baseUrl);
    if (!url.ok) { graphicFailure(target, label, '画像URLが不正'); return; }
    const requestedAt = Date.now();
    let cached = false;
    if (context.assets) {
        const stored = await context.assets.getAsset(url.value);
        if (stored.ok && stored.value.kind === 'some') {
            const parsed = sanitizeSvg(stored.value.value.text, alt);
            if (parsed.ok) {
                cached = true;
                if (context.isCurrent() && target.isConnected) target.replaceChildren(parsed.value);
            }
        }
    }
    const fetched = await fetchText(url.value, 2_000_000);
    if (!fetched.ok) {
        if (!cached && context.isCurrent() && target.isConnected) graphicFailure(target, label, '未取得または取得に失敗');
        return;
    }
    // 保存するのは元のSVG文字列。保存済み・復元済みデータも表示のたびに再検証する。
    const parsed = sanitizeSvg(fetched.value.text, alt);
    if (!parsed.ok) {
        if (!cached && context.isCurrent() && target.isConnected) graphicFailure(target, label, parsed.error.detail);
        return;
    }
    if (context.isCurrent() && target.isConnected) target.replaceChildren(parsed.value);
    if (!context.isCurrent() || !target.isConnected) return;
    if (context.assets) {
        const saved = await context.assets.saveAsset({ id: url.value, text: fetched.value.text, updatedAt: requestedAt });
        if (!saved.ok && saved.error.kind !== 'conflict' && context.isCurrent() && target.isConnected) {
            const warning = document.createElement('small');
            warning.textContent = '図を保存できないため、オフライン利用とバックアップには含まれない。';
            target.append(warning);
        }
    }
}

/** 表示にDOMを付けるがdomain値は変更しない。古い非同期描画はcontextで破棄する。 */
export function renderTokens(tokens: readonly Token[], row: Row = DEFAULT_ROW, context: RenderContext = { baseUrl: location.href, answer: none, isCurrent: () => true }, depth = 0): HTMLElement {
    const output = document.createElement('span');
    output.className = 'token-content';
    if (depth > 64) { output.textContent = '表示の入れ子が上限を超えた'; return output; }
    for (const token of tokens) {
        if (typeof token === 'string') { output.append(richText(token)); continue; }
        const wrapper = document.createElement('span');
        for (const style of token.styles) wrapper.classList.add(`text-${style}`);
        switch (token.type) {
            case 'br': wrapper.append(document.createElement('br')); break;
            case 'hr': wrapper.append(document.createElement('hr')); break;
            case 'key': {
                const value = getRowValue(row, token.field);
                if (value.kind === 'some') wrapper.append(renderTokens(valueTokens(value.value), row, context, depth + 1));
                break;
            }
            case 'listkey': {
                const value = getRowValue(row, token.field);
                if (value.kind === 'some' && tokenMatrix(value.value)) value.value.forEach((entry, index) => {
                    if (index > 0) wrapper.append(renderTokens(token.separatorTokens, row, context, depth + 1));
                    wrapper.append(renderTokens(entry, row, context, depth + 1));
                });
                break;
            }
            case 'ruby': {
                const ruby = document.createElement('ruby');
                const rb = document.createElement('rb');
                const rt = document.createElement('rt');
                rb.append(renderTokens(token.base, row, context, depth + 1));
                rt.append(renderTokens(token.ruby, row, context, depth + 1));
                ruby.append(rb, rt);
                wrapper.append(ruby);
                break;
            }
            case 'katex': katex.render(sourceText(token.source, row), wrapper, { throwOnError: false, trust: false, maxExpand: 1000 }); break;
            case 'hide': {
                if (token.display === 'none') continue;
                wrapper.classList.add('answer-blank');
                if (context.answer.kind === 'some') wrapper.append(renderTokens(context.answer.value.tokens, context.answer.value.row, context, depth + 1));
                else { wrapper.textContent = '\u00A0'; wrapper.setAttribute('aria-label', '解答する空欄'); }
                break;
            }
            case 'svg': {
                const alt = plainText(token.alt);
                wrapper.classList.add('diagram');
                wrapper.textContent = `${alt}（読込中）`;
                switch (token.source.kind) {
                    case 'inline': queueMicrotask(() => svgMarkup(wrapper, token.source.kind === 'inline' ? token.source.value : '', token.alt, context)); break;
                    case 'file': renderFileSvg(wrapper, token.source.src, token.alt, context).catch(() => graphicFailure(wrapper, alt, '画像取得に失敗')); break;
                    case 'field': {
                        const value = getRowValue(row, token.source.field);
                        const source = value.kind === 'some' && typeof value.value === 'string' ? value.value : '';
                        if (source.trimStart().startsWith('<')) queueMicrotask(() => svgMarkup(wrapper, source, token.alt, context));
                        else renderFileSvg(wrapper, source, token.alt, context).catch(() => {
                            if (context.isCurrent() && wrapper.isConnected) graphicFailure(wrapper, alt, '画像取得に失敗');
                        });
                        break;
                    }
                }
                break;
            }
            case 'smiles': {
                wrapper.classList.add('diagram');
                const smiles = sourceText(token.source, row);
                wrapper.textContent = `化学構造: ${smiles}（読込中）`;
                renderSmiles(wrapper, smiles, context, token).catch(() => graphicFailure(wrapper, smiles, '化学描画に失敗'));
                break;
            }
        }
        output.append(wrapper);
    }
    return output;
}
