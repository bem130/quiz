import { err, none, ok, some } from '../core/result.ts';
import type { Option, Result } from '../core/result.ts';
import { resolveHttpUrl } from './network.ts';

export type EditorFile = Readonly<{ source: string; localPath: string }>;
export type SourceInfo = Readonly<{ source: string; packageId: string; questionId: string; rowId: string; patternId: string; jsonPath: string }>;
export type RubyBufferItem = Readonly<{ base: string; reading: string; source: SourceInfo }>;
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function controls(value: string): boolean { return Array.from(value).some((character) => character.charCodeAt(0) < 32); }

/** 明示された絶対local baseと、entryに列挙した相対JSONだけを対応させる。 */
export function editorFilesFromEntry(text: string, entryUrl: string, files: readonly string[]): Result<readonly EditorFile[], string> {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return err('entry JSONを解釈できない。'); }
    if (!object(raw) || raw['editorBasePath'] === undefined) return ok([]);
    const base = raw['editorBasePath'];
    if (typeof base !== 'string') return err('editorBasePathは絶対ローカルパスで指定する。');
    const normalized = base.replaceAll('\\', '/').replace(/\/+$/u, '');
    if (!/^(?:[A-Za-z]:\/|\/(?!\/))/u.test(normalized) || controls(normalized) || /[?#%]/u.test(normalized) || normalized.split('/').some((part) => part === '.' || part === '..')) return err('editorBasePathが不正である。');
    const result: EditorFile[] = [];
    for (const file of files) {
        const relative = file.startsWith('./') ? file.slice(2) : file;
        if (!relative.endsWith('.json') || controls(relative) || /[\\:%?#]/u.test(relative) || relative.split('/').some((part) => !part || part === '.' || part === '..')) continue;
        const source = resolveHttpUrl(file, entryUrl);
        if (source.ok) result.push({ source: source.value, localPath: `${normalized}/${relative}` });
    }
    return ok(result);
}

export function editorFilesFromSetting(text: string): readonly EditorFile[] {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return []; }
    if (!Array.isArray(raw)) return [];
    const result: EditorFile[] = [];
    for (const item of raw) {
        if (!object(item) || typeof item['source'] !== 'string' || typeof item['localPath'] !== 'string') continue;
        const source = resolveHttpUrl(item['source'], item['source']);
        const local = item['localPath'];
        if (source.ok && source.value === item['source'] && /^(?:[A-Za-z]:[/\\]|\/(?!\/))/u.test(local) && !controls(local) && !/[?#%]/u.test(local) && !local.replaceAll('\\', '/').split('/').some((part) => part === '.' || part === '..')) result.push({ source: source.value, localPath: local });
    }
    return result;
}

export function vscodeLink(source: string, files: readonly EditorFile[]): Option<string> {
    const file = files.find((entry) => entry.source === source);
    if (!file) return none;
    // 設定復元境界も再検証し、任意schemeをhrefへ通さない。
    const checked = editorFilesFromSetting(JSON.stringify([file])).at(0);
    if (!checked) return none;
    return some(`vscode://file/${checked.localPath.replaceAll('\\', '/').split('/').map((part) => encodeURIComponent(part)).join('/')}`);
}

export function folderKeys(source: string): readonly string[] {
    let prefix: string; let parts: string[];
    try {
        const url = new URL(source);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
        prefix = `${url.origin}/`; parts = url.pathname.split('/').filter(Boolean);
    } catch { prefix = 'draft:/'; parts = source.split('/').filter(Boolean); }
    const result: string[] = [];
    for (const part of parts.slice(0, -1)) { prefix += `${part}/`; result.push(prefix); }
    return result;
}

export function rubyItems(root: HTMLElement, source: SourceInfo): readonly RubyBufferItem[] {
    const result: RubyBufferItem[] = [];
    for (const ruby of root.tagName === 'RUBY' ? [root] : root.querySelectorAll('ruby')) {
        const reading = ruby.querySelector('rt')?.textContent ?? '';
        const base = ruby.querySelector('rb')?.textContent ?? Array.from(ruby.childNodes).filter((node) => !(node instanceof HTMLElement && (node.tagName === 'RT' || node.tagName === 'RP'))).map((node) => node.textContent ?? '').join('');
        if (base && reading) result.push({ base, reading, source });
    }
    return result;
}

export function addRubyItem(items: readonly RubyBufferItem[], next: RubyBufferItem): readonly RubyBufferItem[] {
    return items.some((item) => item.base === next.base && item.reading === next.reading && item.source.questionId === next.source.questionId) ? items : [...items, next];
}

export type SourceRegion = Readonly<{ root: HTMLElement; source: SourceInfo }>;
export function sourceControls(regions: readonly SourceRegion[], files: readonly EditorFile[], collect: (item: RubyBufferItem) => void, copy: (source: SourceInfo) => Promise<void>): HTMLElement {
    const panel = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = '読みの収集・出典'; panel.append(summary);
    for (const region of regions) {
        region.root.addEventListener('contextmenu', (event) => {
            const target = event.target;
            const ruby = target instanceof Element ? target.closest('ruby') : null;
            if (!(ruby instanceof HTMLElement) || !region.root.contains(ruby)) return;
            const item = rubyItems(ruby, region.source).at(0);
            if (item) { event.preventDefault(); collect(item); }
        });
        for (const item of rubyItems(region.root, region.source)) {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = `${item.base} (${item.reading}) を収集`;
            button.addEventListener('click', () => collect(item)); panel.append(button);
        }
        const label = document.createElement('p'); label.textContent = `${region.source.source} ${region.source.jsonPath}`; panel.append(label);
        const button = document.createElement('button'); button.type = 'button'; button.textContent = '出典をコピー';
        const status = document.createElement('p'); status.setAttribute('role', 'status');
        button.addEventListener('click', () => { copy(region.source).catch(() => { status.textContent = 'コピーできない。表示した出典を選択してコピーできる。'; }); }); panel.append(button, status);
        const link = vscodeLink(region.source.source, files);
        if (link.kind === 'some') {
            const open = document.createElement('a'); open.href = link.value; open.textContent = `ローカルVS Codeで開く: ${files.find((file) => file.source === region.source.source)?.localPath ?? ''}`;
            panel.append(open);
        }
    }
    return panel;
}
