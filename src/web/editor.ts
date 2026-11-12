import { createInputSurface, defaultInputMode } from './editor-input.ts';
import type { InputDecoration, InputMode, InputSurface } from './editor-input.ts';
import { parseContentToSegments, plainText } from '../core/content.ts';
import type { ContentSegment } from '../core/content.ts';
import { tokenizeKatex } from '../core/katex-parser.ts';
import type { QuizFile } from '../core/model.ts';
import { parseQuizJson } from '../core/schema.ts';
import { err, none, ok, some } from '../core/result.ts';
import type { Option, Result } from '../core/result.ts';
import type { DraftRecord } from '../core/records.ts';
import type { QuizStorage } from './storage/database.ts';
import { renderTokens, richText } from './content.ts';

export type EditorError = Readonly<{
    kind: 'storage' | 'conflict' | 'invalid-path' | 'composition' | 'disposed' | 'initialization';
    detail: string;
}>;
export type EditorController = Readonly<{
    flush(): Promise<Result<true, EditorError>>;
    isDirty(): boolean;
    dispose(): void;
}>;
export type EditorOptions = Readonly<{ onClose(): Promise<void>; onSaved(): void }>;
/** テスト境界も同じ保存契約を使い、IndexedDBを表示層から直接操作しない。 */
export type EditorStorage = Pick<QuizStorage,
    'listDrafts' | 'saveDraft' | 'moveDraft' | 'deleteDraft' | 'moveDraftTree' |
    'deleteDraftTree' | 'getSetting' | 'setSetting' | 'getAsset' | 'saveAsset'>;

type SourceRange = Readonly<{ start: number; end: number }>;
type StringSource = Readonly<{ range: SourceRange; value: string; offsets: readonly number[] }>;
type SourceIndex = Readonly<{ ranges: ReadonlyMap<string, SourceRange>; strings: readonly StringSource[] }>;
type BufferState = Readonly<{ record: DraftRecord; text: string; savedText: string }>;
type DraftTreeNode = Readonly<{ name: string; path: string; folder: boolean; children: DraftTreeNode[] }>;

function failure(kind: EditorError['kind'], detail: string): Result<never, EditorError> { return err({ kind, detail }); }
function message(error: unknown): string { return error instanceof Error ? error.message : '編集器で不明な失敗が発生した。'; }
function button(label: string): HTMLButtonElement {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = label; return node;
}
function labelControl(text: string, control: HTMLElement): HTMLLabelElement {
    const label = document.createElement('label'); label.append(text, control); return label;
}
function editorTheme(): 'vs' | 'vs-dark' {
    const theme = document.documentElement.dataset['theme'];
    return theme === 'dark' || theme === 'black' ? 'vs-dark' : 'vs';
}
function normalizePath(value: string, folder: boolean): Result<string, EditorError> {
    const normalized = value.trim().replaceAll('\\', '/').replace(/\/+$/u, '');
    if (!normalized || normalized.startsWith('/') || normalized.includes('\0') || normalized.includes(':') ||
        normalized.split('/').some((part) => part === '' || part === '.' || part === '..')) {
        return failure('invalid-path', '相対パスを指定する。空の区切り、.、..、絶対パスは使用できない。');
    }
    return ok(folder ? `${normalized}/` : normalized.endsWith('.json') ? normalized : `${normalized}.json`);
}
function defaultDraft(path: string): string {
    return JSON.stringify({ version: 3, title: path.split('/').at(-1) ?? '草稿', description: '問題の説明',
        table: [{ id: 'a', term: '用語A', definition: '定義A' }, { id: 'b', term: '用語B', definition: '定義B' }],
        patterns: [{ id: 'definition', label: '定義から用語', tokens: [
            { type: 'key', field: 'definition' }, ' に対応する用語は ',
            { type: 'hide', id: 'answer', value: [{ type: 'key', field: 'term' }], answer: { mode: 'choice_from_entities' } }
        ] }] }, null, 2);
}

/** strict JSONの成功後だけ呼ぶ位置scanner。schemaとは別の受理条件を作らない。 */
function sourceIndex(text: string): SourceIndex {
    const ranges = new Map<string, SourceRange>();
    const strings: StringSource[] = [];
    let offset = 0;
    const whitespace = (): void => { while (/\s/u.test(text.charAt(offset)) && offset < text.length) offset += 1; };
    const literal = (): StringSource => {
        const start = offset;
        offset += 1;
        const offsets: number[] = [];
        while (offset < text.length && text.charAt(offset) !== '"') {
            offsets.push(offset);
            offset += text.charAt(offset) === '\\' ? (text.charAt(offset + 1) === 'u' ? 6 : 2) : 1;
        }
        offsets.push(offset);
        offset += 1;
        const parsed: unknown = JSON.parse(text.slice(start, offset));
        const source = { range: { start, end: offset }, value: typeof parsed === 'string' ? parsed : '', offsets };
        strings.push(source);
        return source;
    };
    const scan = (path: string, depth: number): void => {
        whitespace();
        const start = offset;
        if (depth > 80) return;
        const char = text.charAt(offset);
        if (char === '{') {
            offset += 1; whitespace();
            while (offset < text.length && text.charAt(offset) !== '}') {
                const key = literal(); whitespace(); offset += 1;
                scan(`${path}.${key.value}`, depth + 1); whitespace();
                if (text.charAt(offset) !== ',') break;
                offset += 1; whitespace();
            }
            offset += 1;
        } else if (char === '[') {
            offset += 1; whitespace(); let index = 0;
            while (offset < text.length && text.charAt(offset) !== ']') {
                scan(`${path}[${index}]`, depth + 1); whitespace(); index += 1;
                if (text.charAt(offset) !== ',') break;
                offset += 1; whitespace();
            }
            offset += 1;
        } else if (char === '"') literal();
        else { while (offset < text.length && !/[\s,}\]]/u.test(text.charAt(offset))) offset += 1; }
        ranges.set(path, { start, end: offset });
    };
    scan('$', 0);
    return { ranges, strings };
}

/**
 * 草稿操作の正本はbuffer、保存済みversionはrecordに保持する。
 * 保存は固定したpath/text/versionで直列化し、navigationはflushのcommitを待つ。
 * disposeはflush成功後に呼ぶ。UIの閉じる操作は必ずこの順序を守る。
 */
export async function mountDraftEditor(
    host: HTMLElement, storage: EditorStorage, options: EditorOptions
): Promise<Result<EditorController, EditorError>> {
    const initial = await storage.listDrafts();
    if (!initial.ok) return failure(initial.error.kind === 'conflict' ? 'conflict' : 'storage', initial.error.message);
    let records = initial.value;
    let active: Option<BufferState> = none;
    let selected: Option<string> = none;
    let disposed = false;
    let loading = false;
    let composing = false;
    let busy = true;
    let generation = 0;
    let timer: Option<number> = none;
    let parseTimer: Option<number> = none;
    let saveTail: Promise<void> = Promise.resolve();
    let navigationTail: Promise<void> = Promise.resolve();
    let index: SourceIndex = { ranges: new Map(), strings: [] };
    let parsed: Option<QuizFile> = none;
    const collapsedFolders = new Set<string>();
    const section = document.createElement('section'); section.className = 'draft-editor';
    const heading = document.createElement('h2'); heading.textContent = 'ローカル問題の編集';
    const toolbar = document.createElement('div'); toolbar.className = 'draft-toolbar';
    const pathInput = document.createElement('input'); pathInput.type = 'text'; pathInput.placeholder = 'drafts/example.json';
    pathInput.setAttribute('aria-label', '草稿のパス');
    const openButton = button('開く'); const newButton = button('新規ファイル'); const folderButton = button('新規フォルダ');
    const renameButton = button('名前を変更'); const moveButton = button('移動'); const deleteButton = button('削除');
    const saveButton = button('保存・再試行'); const saveAsButton = button('別名で保存'); const closeButton = button('編集を閉じる');
    const modeSelect = document.createElement('select'); modeSelect.setAttribute('aria-label', '入力方式');
    modeSelect.append(new Option('標準入力（textarea）', 'native'), new Option('高度編集（Monaco・デスクトップ向け）', 'advanced'));
    const modeNotice = document.createElement('p'); modeNotice.setAttribute('role', 'status');
    toolbar.append(pathInput, openButton, newButton, folderButton, renameButton, moveButton, deleteButton, saveButton, saveAsButton, closeButton, labelControl('入力方式 ', modeSelect));
    const status = document.createElement('p'); status.className = 'draft-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const diagnostic = document.createElement('p'); diagnostic.className = 'draft-diagnostic'; diagnostic.setAttribute('role', 'status');
    const tree = document.createElement('nav'); tree.setAttribute('aria-label', '草稿一覧'); tree.className = 'draft-tree';
    const sidebar = document.createElement('div'); sidebar.className = 'draft-sidebar';
    const sidebarHead = document.createElement('div'); sidebarHead.className = 'draft-sidebar-head'; sidebarHead.textContent = '草稿';
    sidebar.append(sidebarHead, tree);
    const body = document.createElement('div'); body.className = 'draft-body';
    const main = document.createElement('div'); main.className = 'draft-main';
    const editorHost = document.createElement('div'); editorHost.className = 'draft-code'; editorHost.style.height = 'min(60vh, 620px)';
    editorHost.style.minHeight = '280px';
    editorHost.style.position = 'relative';
    let inputHost = document.createElement('div'); inputHost.style.height = '100%'; editorHost.append(inputHost);
    const selectors = document.createElement('div'); selectors.className = 'draft-selectors';
    const rowSelect = document.createElement('select'); rowSelect.setAttribute('aria-label', 'プレビューする行');
    const patternSelect = document.createElement('select'); patternSelect.setAttribute('aria-label', 'プレビューするパターン');
    const renderedTab = button('問題プレビュー'); const jsonTab = button('JSONプレビュー');
    renderedTab.setAttribute('aria-pressed', 'true'); jsonTab.setAttribute('aria-pressed', 'false');
    selectors.append(labelControl('行 ', rowSelect), labelControl('パターン ', patternSelect), renderedTab, jsonTab);
    const preview = document.createElement('div'); preview.className = 'draft-preview'; preview.setAttribute('aria-label', '問題プレビュー');
    const jsonPreview = document.createElement('pre'); jsonPreview.className = 'draft-json-preview'; jsonPreview.hidden = true;
    jsonPreview.setAttribute('aria-label', 'JSONプレビュー');
    const style = document.createElement('style');
    style.textContent = `.draft-editor .draft-toolbar,.draft-editor .draft-selectors{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}.draft-editor{display:flex;flex-direction:column;min-height:100%}.draft-editor .draft-main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1rem;flex:1 1 auto;min-width:0;padding-left:1rem}.draft-editor .draft-body{display:flex;align-items:stretch;flex:1 1 auto;min-height:0}.draft-editor .draft-sidebar{flex:0 0 16rem;min-width:0;display:flex;flex-direction:column;border-right:1px solid var(--border,#8090a0)}.draft-editor .draft-sidebar-head{flex:0 0 auto;padding:.35rem .45rem;border-bottom:1px solid var(--border,#8090a0);font-size:.85rem;font-weight:bold;letter-spacing:.05em}.draft-editor .draft-tree{flex:1 1 auto;min-height:0;overflow-y:auto;padding:.25rem}.draft-editor .draft-status{flex:0 0 auto;margin:0;border-top:1px solid var(--border,#8090a0);padding:.25rem .45rem;font-size:.85rem}.draft-editor .draft-tree button{display:flex;align-items:center;gap:.35rem;width:100%;min-height:0;margin:0;padding:.3rem .45rem;border:1px solid transparent;border-radius:.35rem;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden}.draft-editor .draft-tree button:hover{background:var(--disabled-surface,#e5ebf1)}.draft-editor .draft-tree button[aria-current=true]{font-weight:bold;background:var(--disabled-surface,#e5ebf1);outline:2px solid currentColor}.draft-editor .draft-tree-chevron{flex:0 0 1em;text-align:center}.draft-editor .draft-tree-icon{flex:0 0 1.2em;text-align:center}.draft-editor .draft-tree-name{min-width:0;overflow:hidden;text-overflow:ellipsis}.draft-editor .draft-preview,.draft-editor .draft-json-preview{overflow:auto;max-height:65vh;white-space:pre-wrap;overflow-wrap:anywhere}.draft-editor .draft-pattern{padding:.75rem;border:1px solid #8090a0;border-radius:.4rem;margin-block:.5rem}.draft-editor .source-preview{cursor:pointer}.draft-editor .json-current{outline:2px solid #347ed0}.quiz-editor-ruby{background:#d0eaff55}.quiz-editor-gloss{background:#d6f8d655}.quiz-editor-math{background:#f5e7bb66}.quiz-editor-command{color:#7d39ae!important}@media(max-width:760px){.draft-editor .draft-main{grid-template-columns:1fr;padding-left:0}.draft-editor .draft-body{flex-direction:column}.draft-editor .draft-sidebar{flex:0 0 auto;border-right:none;border-bottom:1px solid var(--border,#8090a0)}.draft-editor .draft-tree{max-height:35vh}}`;
    const right = document.createElement('div'); right.append(selectors, diagnostic, preview, jsonPreview);
    // 入力surfaceと初期草稿の準備が終わる前に操作を公開しない。
    // dynamic import中にもtoolbar自体は描画されるため、listener登録前のclickを防ぐ。
    for (const control of [pathInput, openButton, newButton, folderButton, renameButton, moveButton, deleteButton,
        saveButton, saveAsButton, closeButton, modeSelect, rowSelect, patternSelect, renderedTab, jsonTab]) control.disabled = true;
    status.textContent = '編集器を準備中…'; status.dataset['state'] = 'loading';
    main.append(editorHost, right); body.append(sidebar, main);
    section.append(style, heading, toolbar, modeNotice, body, status); host.replaceChildren(section);
    let editor: InputSurface;
    try {
        editor = await createInputSurface(defaultInputMode(), inputHost);
    } catch (error) {
        inputHost.replaceChildren();
        try { editor = await createInputSurface('native', inputHost); }
        catch (fallbackError) { host.replaceChildren(); return failure('initialization', message(fallbackError)); }
        modeNotice.textContent = `高度編集を読み込めないため標準入力を使用する。${message(error)}`;
    }
    modeSelect.value = editor.mode; editorHost.dataset['inputMode'] = editor.mode;
    let subscriptions: ReadonlyArray<Readonly<{ dispose(): void }>> = [];
    const isDirty = (): boolean => composing || (active.kind === 'some' && active.value.text !== active.value.savedText);
    const report = (issue: EditorError): void => { if (!disposed) { status.textContent = `${issue.kind === 'initialization' ? '入力方式' : '未保存'}: ${issue.detail}`; status.dataset['state'] = 'error'; } };
    const stopTimer = (): void => { if (timer.kind === 'some') window.clearTimeout(timer.value); timer = none; };
    const stopParseTimer = (): void => { if (parseTimer.kind === 'some') window.clearTimeout(parseTimer.value); parseTimer = none; };
    const action = (operation: () => Promise<unknown>): void => {
        operation().catch((error: unknown) => report({ kind: 'storage', detail: message(error) }));
    };
    const updateControls = (): void => {
        for (const control of [openButton, newButton, folderButton, renameButton, moveButton, deleteButton, closeButton]) control.disabled = busy || composing;
        saveButton.disabled = busy || composing || active.kind === 'none';
        saveAsButton.disabled = busy || composing || active.kind === 'none';
        pathInput.disabled = busy || composing;
        modeSelect.disabled = busy || composing;
        for (const control of [rowSelect, patternSelect, renderedTab, jsonTab]) control.disabled = busy;
        editor.setReadOnly(busy || active.kind === 'none');
    };
    const jump = (range: SourceRange): void => {
        if (!disposed) editor.jump(range.start);
    };
    const bindSource = (element: HTMLElement, path: string): void => {
        const range = index.ranges.get(path);
        if (range === undefined) return;
        element.classList.add('source-preview'); element.title = 'クリックして編集位置へ移動';
        element.addEventListener('click', () => jump(range));
    };
    const decorate = (): void => {
        if (editor.mode === 'native') return;
        const next: InputDecoration[] = [];
        for (const source of index.strings) {
            const add = (start: number, end: number, className: string): void => {
                const rawStart = source.offsets.at(start); const rawEnd = source.offsets.at(end);
                if (rawStart === undefined || rawEnd === undefined || rawStart >= rawEnd) return;
                next.push({ start: rawStart, end: rawEnd, className });
            };
            const segments = (entries: readonly ContentSegment[]): void => {
                for (const entry of entries) {
                    switch (entry.kind) {
                        case 'Plain': case 'Escape': break;
                        case 'Annotated': add(entry.range.start, entry.range.end, 'quiz-editor-ruby'); segments(entry.base); break;
                        case 'Gloss': add(entry.range.start, entry.range.end, 'quiz-editor-gloss'); segments(entry.base); entry.glosses.forEach(segments); break;
                        case 'Math': {
                            add(entry.range.start, entry.range.end, 'quiz-editor-math');
                            for (const part of tokenizeKatex(entry.tex, entry.range.start + (entry.display ? 2 : 1))) {
                                if (part.kind === 'Command') add(part.start, part.end, 'quiz-editor-command');
                            }
                            break;
                        }
                    }
                }
            };
            segments(parseContentToSegments(source.value));
        }
        editor.decorate(next);
    };
    const renderJson = (): void => {
        if (active.kind === 'none') { jsonPreview.replaceChildren(); return; }
        const text = active.value.text; const cursor = editor.getOffset();
        const fragment = document.createDocumentFragment(); let offset = 0;
        for (const source of index.strings) {
            fragment.append(text.slice(offset, source.range.start), '"');
            const span = richText(source.value); span.classList.add('source-preview');
            if (source.range.start <= cursor && cursor <= source.range.end) span.classList.add('json-current');
            span.addEventListener('click', () => jump(source.range)); fragment.append(span, '"'); offset = source.range.end;
        }
        fragment.append(text.slice(offset)); jsonPreview.replaceChildren(fragment);
    };
    const renderPreview = (): void => {
        generation += 1; const current = generation;
        preview.replaceChildren();
        if (parsed.kind === 'none') return;
        const quiz = parsed.value;
        const rowIndex = Number(rowSelect.value); const row = quiz.table.at(Number.isInteger(rowIndex) ? rowIndex : 0);
        if (row === undefined) return;
        const title = document.createElement('h3'); title.append(richText(quiz.title)); bindSource(title, '$.title');
        const description = document.createElement('p'); description.append(richText(quiz.description)); bindSource(description, '$.description');
        preview.append(title, description);
        const context = { baseUrl: location.href, answer: none, assets: storage, isCurrent: () => !disposed && current === generation };
        for (const [patternIndex, pattern] of quiz.patterns.entries()) {
            if (patternSelect.value !== 'all' && patternSelect.value !== pattern.id) continue;
            const block = document.createElement('article'); block.className = 'draft-pattern';
            const label = document.createElement('h4'); label.append(richText(pattern.label)); bindSource(label, `$.patterns[${patternIndex}].label`); block.append(label);
            for (const [tokenIndex, token] of pattern.tokens.entries()) {
                const shown = renderTokens([token], row, context);
                const field = typeof token !== 'string' && (token.type === 'key' || token.type === 'listkey') ? some(token.field) :
                    typeof token !== 'string' && (token.type === 'svg' || token.type === 'katex' || token.type === 'smiles') && token.source.kind === 'field' ? some(token.source.field) : none;
                bindSource(shown, field.kind === 'some' ? `$.table[${rowIndex}].${field.value}` : `$.patterns[${patternIndex}].tokens[${tokenIndex}]`);
                block.append(shown);
                if (typeof token !== 'string' && token.type === 'hide') {
                    const answer = document.createElement('p'); answer.append('正答候補: ', renderTokens(token.value, row, context));
                    bindSource(answer, `$.patterns[${patternIndex}].tokens[${tokenIndex}].value`); block.append(answer);
                }
            }
            for (const [tipIndex, tip] of pattern.tips.entries()) {
                const tipNode = document.createElement('p'); tipNode.append(`Tips (${tip.when}): `, renderTokens(tip.tokens, row, context));
                bindSource(tipNode, `$.patterns[${patternIndex}].tips[${tipIndex}].tokens`); block.append(tipNode);
            }
            preview.append(block);
        }
    };
    const validate = (): void => {
        if (active.kind === 'none') { parsed = none; preview.replaceChildren(); jsonPreview.replaceChildren(); diagnostic.textContent = 'ファイルを作成または選択する。'; return; }
        const text = active.value.text;
        try { const unknown: unknown = JSON.parse(text); void unknown; index = sourceIndex(text); }
        catch { index = { ranges: new Map(), strings: [] }; }
        const result = parseQuizJson(text);
        if (!result.ok) {
            parsed = none; generation += 1; preview.replaceChildren();
            diagnostic.textContent = `検証エラー: ${result.error.code} ${result.error.path} ${result.error.detail}`;
            const range = index.ranges.get(result.error.path) ?? { start: 0, end: 1 };
            editor.diagnose(some({ ...range, message: diagnostic.textContent }));
        } else {
            parsed = some(result.value); diagnostic.textContent = 'JSONと問題定義は有効';
            editor.diagnose(none);
            const oldRow = rowSelect.value; const oldPattern = patternSelect.value;
            rowSelect.replaceChildren(...result.value.table.map((row, rowIndex) => new Option(row.id, String(rowIndex))));
            rowSelect.value = result.value.table.at(Number(oldRow)) === undefined ? '0' : oldRow || '0';
            patternSelect.replaceChildren(new Option('すべて', 'all'), ...result.value.patterns.map((pattern) => new Option(plainText(pattern.label), pattern.id)));
            patternSelect.value = result.value.patterns.some((pattern) => pattern.id === oldPattern) ? oldPattern : 'all';
            renderPreview();
        }
        decorate(); renderJson();
    };
    const refreshTree = (): void => {
        tree.replaceChildren();
        const paths = new Set<string>();
        for (const record of records) {
            paths.add(record.id);
            const parts = record.id.split('/'); parts.pop(); let prefix = '';
            for (const part of parts) { prefix += `${part}/`; paths.add(prefix); }
        }
        const roots: DraftTreeNode[] = [];
        const knownFolders = new Map<string, DraftTreeNode>();
        const ensureFolder = (path: string, name: string, siblings: DraftTreeNode[]): DraftTreeNode => {
            const existing = knownFolders.get(path);
            if (existing !== undefined) return existing;
            const node: DraftTreeNode = { name, path, folder: true, children: [] };
            knownFolders.set(path, node); siblings.push(node); return node;
        };
        for (const path of [...paths].sort()) {
            const folder = path.endsWith('/');
            const segments = (folder ? path.slice(0, -1) : path).split('/');
            let siblings = roots; let prefix = '';
            segments.forEach((segment, segmentIndex) => {
                prefix += segment;
                if (segmentIndex < segments.length - 1 || folder) {
                    prefix += '/';
                    siblings = ensureFolder(prefix, segment, siblings).children;
                } else siblings.push({ name: segment, path, folder: false, children: [] });
            });
        }
        const byKindThenName = (a: DraftTreeNode, b: DraftTreeNode): number =>
            a.folder === b.folder ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.folder ? -1 : 1;
        const sortNodes = (nodes: DraftTreeNode[]): void => {
            nodes.sort(byKindThenName);
            for (const node of nodes) sortNodes(node.children);
        };
        sortNodes(roots);
        const renderNodes = (nodes: readonly DraftTreeNode[], depth: number): void => {
            for (const node of nodes) {
                const expanded = node.folder && !collapsedFolders.has(node.path);
                const item = button('');
                item.dataset['path'] = node.path;
                item.setAttribute('aria-current', selected.kind === 'some' && selected.value === node.path ? 'true' : 'false');
                item.style.paddingLeft = `${0.45 + depth * 1.15}rem`;
                const chevron = document.createElement('span');
                chevron.className = 'draft-tree-chevron'; chevron.setAttribute('aria-hidden', 'true');
                chevron.textContent = node.folder ? (expanded ? '▾' : '▸') : '';
                const icon = document.createElement('span');
                icon.className = 'draft-tree-icon'; icon.setAttribute('aria-hidden', 'true');
                icon.textContent = node.folder ? (expanded ? '📂' : '📁') : '📄';
                const name = document.createElement('span');
                name.className = 'draft-tree-name'; name.textContent = node.name;
                item.append(chevron, icon, name);
                if (node.folder) item.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                const path = node.path; const folder = node.folder;
                item.addEventListener('click', () => {
                    if (busy || composing) return;
                    if (folder) {
                        if (collapsedFolders.has(path)) collapsedFolders.delete(path); else collapsedFolders.add(path);
                        selected = some(path); pathInput.value = path; refreshTree();
                    }
                    else navigate(() => openDraft(path));
                });
                tree.append(item);
                if (expanded) renderNodes(node.children, depth + 1);
            }
        };
        renderNodes(roots, 0);
    };
    const reloadRecords = async (): Promise<Result<true, EditorError>> => {
        const result = await storage.listDrafts();
        if (!result.ok) return failure(result.error.kind === 'conflict' ? 'conflict' : 'storage', result.error.message);
        records = result.value; if (!disposed) refreshTree(); return ok(true);
    };
    const flush = (): Promise<Result<true, EditorError>> => {
        stopTimer();
        const pending = saveTail.then(async (): Promise<Result<true, EditorError>> => {
            if (disposed) return failure('disposed', '編集器は閉じられている。');
            if (composing) return failure('composition', '文字の変換を確定してから操作する。');
            while (active.kind === 'some' && active.value.text !== active.value.savedText) {
                const snapshot = active.value;
                status.textContent = `${snapshot.record.id} を保存中…`; status.dataset['state'] = 'saving';
                const saved = await storage.saveDraft({ id: snapshot.record.id, text: snapshot.text,
                    updatedAt: Date.now(), expectedVersion: snapshot.record.version });
                if (!saved.ok) {
                    const issue: EditorError = { kind: saved.error.kind === 'conflict' ? 'conflict' : 'storage', detail: saved.error.message };
                    report(issue); return err(issue);
                }
                if (active.kind === 'some' && active.value.record.id === snapshot.record.id) {
                    active = some({ ...active.value, record: saved.value, savedText: snapshot.text });
                }
                records = [...records.filter((record) => record.id !== saved.value.id), saved.value];
                options.onSaved();
            }
            if (!disposed) { status.textContent = active.kind === 'some' ? `${active.value.record.id} 保存済み` : 'ファイル未選択'; status.dataset['state'] = 'saved'; refreshTree(); }
            return ok(true);
        }).catch((error: unknown): Result<true, EditorError> => { const issue: EditorError = { kind: 'storage', detail: message(error) }; report(issue); return err(issue); });
        saveTail = pending.then(() => undefined);
        return pending;
    };
    const scheduleSave = (): void => {
        stopTimer();
        if (composing || disposed) return;
        timer = some(window.setTimeout(() => { timer = none; action(flush); }, 500));
    };
    const openDraft = async (path: string): Promise<Result<true, EditorError>> => {
        const refreshed = await reloadRecords(); if (!refreshed.ok) return refreshed;
        const record = records.find((entry) => entry.id === path && !path.endsWith('/'));
        if (record === undefined) return failure('storage', '指定した草稿が存在しない。');
        active = some({ record, text: record.text, savedText: record.text }); selected = some(path); pathInput.value = path;
        loading = true; editor.setValue(record.text); loading = false;
        validate(); refreshTree();
        const setting = await storage.setSetting({ id: 'editor.activePath', value: path });
        if (!setting.ok) return failure('storage', setting.error.message);
        status.textContent = `${path} 保存済み`; status.dataset['state'] = 'saved'; return ok(true);
    };
    function navigate(operation: () => Promise<Result<true, EditorError>>, saveBefore = true): void {
        action(async () => {
            const pending = navigationTail.then(async () => {
                if (disposed) return;
                if (composing) { report({ kind: 'composition', detail: '文字の変換を確定してから操作する。' }); return; }
                busy = true; updateControls();
                try {
                    if (saveBefore) {
                        const saved = await flush();
                        if (!saved.ok) { report(saved.error); return; }
                    } else { stopTimer(); await saveTail; }
                    const result = await operation(); if (!result.ok) report(result.error);
                } finally { busy = false; if (!disposed) updateControls(); }
            });
            navigationTail = pending.catch((error: unknown) => report({ kind: 'storage', detail: message(error) }));
            await navigationTail;
        });
    }
    const createEntry = async (folder: boolean): Promise<Result<true, EditorError>> => {
        const path = normalizePath(pathInput.value, folder); if (!path.ok) return path;
        const saved = await storage.saveDraft({ id: path.value, text: folder ? '' : defaultDraft(path.value), updatedAt: Date.now(), expectedVersion: 0 });
        if (!saved.ok) return failure(saved.error.kind === 'conflict' ? 'conflict' : 'storage', saved.error.message);
        options.onSaved(); const refreshed = await reloadRecords(); if (!refreshed.ok) return refreshed;
        if (folder) { selected = some(path.value); pathInput.value = path.value; refreshTree(); return ok(true); }
        return openDraft(path.value);
    };
    const saveAs = async (): Promise<Result<true, EditorError>> => {
        if (active.kind === 'none') return failure('storage', '保存する草稿が選択されていない。');
        const path = normalizePath(pathInput.value, false); if (!path.ok) return path;
        if (path.value === active.value.record.id) return flush();
        const text = active.value.text;
        const saved = await storage.saveDraft({ id: path.value, text, updatedAt: Date.now(), expectedVersion: 0 });
        if (!saved.ok) return failure(saved.error.kind === 'conflict' ? 'conflict' : 'storage', saved.error.message);
        active = some({ record: saved.value, text, savedText: text }); selected = some(path.value);
        pathInput.value = path.value; options.onSaved();
        const setting = await storage.setSetting({ id: 'editor.activePath', value: path.value });
        if (!setting.ok) return failure('storage', setting.error.message);
        status.textContent = `${path.value} 保存済み`; status.dataset['state'] = 'saved';
        return reloadRecords();
    };
    const moveEntry = async (rename: boolean): Promise<Result<true, EditorError>> => {
        if (selected.kind === 'none') return failure('invalid-path', '移動する項目を選択する。');
        const from = selected.value; const folder = from.endsWith('/');
        const trimmed = from.replace(/\/$/u, ''); const parent = trimmed.slice(0, trimmed.lastIndexOf('/') + 1);
        const input = window.prompt(rename ? '新しい名前' : '移動先の相対パス', rename ? trimmed.slice(parent.length) : from);
        if (input === null) return ok(true);
        const to = normalizePath(rename ? `${parent}${input}` : input, folder); if (!to.ok) return to;
        if (to.value === from) return ok(true);
        const refreshed = await reloadRecords(); if (!refreshed.ok) return refreshed;
        if (folder) {
            const expected = records.filter((record) => record.id.startsWith(from)).map((record) => ({ id: record.id, version: record.version }));
            const moved = await storage.moveDraftTree(from, to.value, expected, Date.now());
            if (!moved.ok) return failure(moved.error.kind === 'conflict' ? 'conflict' : 'storage', moved.error.message);
        } else {
            const record = records.find((entry) => entry.id === from); if (record === undefined) return failure('storage', '移動元が存在しない。');
            const moved = await storage.moveDraft(from, to.value, record.version, Date.now());
            if (!moved.ok) return failure(moved.error.kind === 'conflict' ? 'conflict' : 'storage', moved.error.message);
        }
        options.onSaved();
        if (active.kind === 'some' && (active.value.record.id === from || (folder && active.value.record.id.startsWith(from)))) {
            const target = to.value + active.value.record.id.slice(from.length);
            return openDraft(target);
        }
        selected = some(to.value); pathInput.value = to.value; return reloadRecords();
    };
    const deleteEntry = async (): Promise<Result<true, EditorError>> => {
        if (selected.kind === 'none') return failure('invalid-path', '削除する項目を選択する。');
        const path = selected.value; const folder = path.endsWith('/');
        if (!window.confirm(`${path}${folder ? ' と配下の全草稿' : ''} を削除する。よいか。`)) return ok(true);
        const refreshed = await reloadRecords(); if (!refreshed.ok) return refreshed;
        const deleted = folder ? await storage.deleteDraftTree(path,
            records.filter((record) => record.id.startsWith(path)).map((record) => ({ id: record.id, version: record.version }))) :
            await storage.deleteDraft(path, records.find((record) => record.id === path)?.version ?? 0);
        if (!deleted.ok) return failure(deleted.error.kind === 'conflict' ? 'conflict' : 'storage', deleted.error.message);
        options.onSaved();
        if (active.kind === 'some' && (active.value.record.id === path || (folder && active.value.record.id.startsWith(path)))) {
            active = none; loading = true; editor.setValue(''); loading = false; validate();
        }
        selected = none; pathInput.value = '';
        const reloaded = await reloadRecords(); if (!reloaded.ok) return reloaded;
        const next = records.find((record) => !record.id.endsWith('/'));
        return next === undefined ? ok(true) : openDraft(next.id);
    };
    const changed = (): void => {
        if (loading || active.kind === 'none') return;
        const buffer = { ...active.value, text: editor.getValue() };
        active = some(buffer);
        generation += 1;
        status.textContent = `${buffer.record.id} 未保存`; status.dataset['state'] = 'dirty';
        stopParseTimer();
        if (!composing) {
            parseTimer = some(window.setTimeout(() => { parseTimer = none; if (!disposed) validate(); }, 140));
            scheduleSave();
        }
    };
    const compositionStarted = (): void => { composing = true; stopTimer(); stopParseTimer(); updateControls(); };
    const compositionEnded = (): void => { composing = false; updateControls(); validate(); scheduleSave(); };
    const cursorChanged = (): void => {
        if (parsed.kind === 'none') return;
        const offset = editor.getOffset();
        for (let row = 0; row < parsed.value.table.length; row += 1) {
            const range = index.ranges.get(`$.table[${row}]`);
            if (range !== undefined && range.start <= offset && offset < range.end && rowSelect.value !== String(row)) {
                rowSelect.value = String(row); renderPreview(); break;
            }
        }
        if (!jsonPreview.hidden) renderJson();
    };
    const wireInput = (): void => {
        subscriptions = [editor.onChange(changed), editor.onCompositionStart(compositionStarted), editor.onCompositionEnd(compositionEnded), editor.onCursor(cursorChanged)];
    };
    wireInput();
    const switchInput = async (mode: InputMode): Promise<Result<true, EditorError>> => {
        if (mode === editor.mode) return ok(true);
        const offset = editor.getOffset();
        const nextHost = document.createElement('div'); nextHost.style.height = '100%';
        nextHost.style.position = 'absolute'; nextHost.style.inset = '0'; nextHost.style.visibility = 'hidden'; editorHost.append(nextHost);
        modeNotice.textContent = '入力方式を準備中…';
        try {
            const next = await createInputSurface(mode, nextHost);
            if (disposed) { next.dispose(); nextHost.remove(); return failure('disposed', '編集器は閉じられている。'); }
            next.setValue(active.kind === 'some' ? active.value.text : '');
            subscriptions.forEach((subscription) => subscription.dispose()); editor.dispose();
            inputHost = nextHost; inputHost.style.position = 'relative'; inputHost.style.inset = ''; inputHost.style.visibility = '';
            editorHost.replaceChildren(inputHost); editor = next; wireInput();
            modeSelect.value = mode; editorHost.dataset['inputMode'] = mode; modeNotice.textContent = '';
            validate(); editor.jump(offset); return ok(true);
        } catch (error) {
            nextHost.remove(); modeSelect.value = editor.mode; modeNotice.textContent = '';
            return failure('initialization', `元の入力内容を保持した。${message(error)}`);
        }
    };
    modeSelect.addEventListener('change', () => {
        const mode = modeSelect.value; modeSelect.value = editor.mode;
        if (mode !== 'native' && mode !== 'advanced') return;
        navigate(() => switchInput(mode));
    });
    rowSelect.addEventListener('change', renderPreview); patternSelect.addEventListener('change', renderPreview);
    renderedTab.addEventListener('click', () => { preview.hidden = false; jsonPreview.hidden = true; renderedTab.setAttribute('aria-pressed', 'true'); jsonTab.setAttribute('aria-pressed', 'false'); renderPreview(); });
    jsonTab.addEventListener('click', () => { preview.hidden = true; jsonPreview.hidden = false; renderedTab.setAttribute('aria-pressed', 'false'); jsonTab.setAttribute('aria-pressed', 'true'); renderJson(); });
    openButton.addEventListener('click', () => { const path = normalizePath(pathInput.value, false); if (path.ok) navigate(() => openDraft(path.value)); else report(path.error); });
    newButton.addEventListener('click', () => navigate(() => createEntry(false)));
    folderButton.addEventListener('click', () => navigate(() => createEntry(true)));
    renameButton.addEventListener('click', () => navigate(() => moveEntry(true)));
    moveButton.addEventListener('click', () => navigate(() => moveEntry(false)));
    deleteButton.addEventListener('click', () => navigate(deleteEntry));
    saveButton.addEventListener('click', () => action(flush));
    saveAsButton.addEventListener('click', () => navigate(saveAs, false));
    closeButton.addEventListener('click', () => navigate(async () => { await options.onClose(); return ok(true); }));
    const beforeUnload = (event: BeforeUnloadEvent): void => { if (isDirty()) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    const themeObserver = new MutationObserver(() => editor.setTheme(editorTheme()));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const controller: EditorController = {
        flush, isDirty,
        dispose(): void {
            disposed = true; generation += 1; stopTimer(); stopParseTimer(); themeObserver.disconnect();
            window.removeEventListener('beforeunload', beforeUnload);
            subscriptions.forEach((subscription) => subscription.dispose()); editor.dispose();
            host.replaceChildren();
        }
    };
    refreshTree();
    const savedPath = await storage.getSetting('editor.activePath');
    const previous = savedPath.ok && savedPath.value.kind === 'some' ? savedPath.value.value : '';
    const first = records.find((record) => record.id === previous && !record.id.endsWith('/')) ?? records.find((record) => !record.id.endsWith('/'));
    if (first !== undefined) { const opened = await openDraft(first.id); if (!opened.ok) report(opened.error); }
    else { validate(); status.textContent = 'ファイル未選択'; status.dataset['state'] = 'saved'; }
    busy = false;
    updateControls();
    return ok(controller);
}
