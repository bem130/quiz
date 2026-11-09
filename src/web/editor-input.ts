import type { IDisposable } from './monaco.ts';
import type { Option } from '../core/result.ts';

export type InputMode = 'native' | 'advanced';
export type InputDecoration = Readonly<{ start: number; end: number; className: string }>;
export type InputDiagnostic = Readonly<{ start: number; end: number; message: string }>;
export type InputSurface = Readonly<{
    mode: InputMode;
    getValue(): string; setValue(text: string): void; getOffset(): number; jump(offset: number): void;
    setReadOnly(value: boolean): void; setTheme(theme: 'vs' | 'vs-dark'): void;
    decorate(ranges: readonly InputDecoration[]): void; diagnose(issue: Option<InputDiagnostic>): void;
    onChange(callback: () => void): IDisposable; onCursor(callback: () => void): IDisposable;
    onCompositionStart(callback: () => void): IDisposable; onCompositionEnd(callback: () => void): IDisposable;
    dispose(): void;
}>;

export function defaultInputMode(): InputMode {
    return navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches ? 'native' : 'advanced';
}

function events() {
    const listeners = new Set<() => void>();
    return { emit(): void { listeners.forEach((callback) => callback()); },
        subscribe: (callback: () => void): IDisposable => { listeners.add(callback); return { dispose(): void { listeners.delete(callback); } }; },
        clear(): void { listeners.clear(); } };
}

function revealNativeOffset(input: HTMLTextAreaElement, offset: number): void {
    input.focus(); input.setSelectionRange(offset, offset);
    // soft wrapを含む表示位置を測る。JSONの改行数だけではminified入力を辿れない。
    const mirror = document.createElement('div'); const style = getComputedStyle(input);
    mirror.style.position = 'fixed'; mirror.style.top = '0'; mirror.style.left = '-10000px'; mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap'; mirror.style.overflowWrap = 'break-word'; mirror.style.boxSizing = 'border-box';
    mirror.style.width = `${input.clientWidth}px`; mirror.style.font = style.font; mirror.style.lineHeight = style.lineHeight; mirror.style.padding = style.padding; mirror.style.letterSpacing = style.letterSpacing;
    mirror.textContent = input.value.slice(0, offset); const marker = document.createElement('span'); marker.textContent = '\u200b'; mirror.append(marker); document.body.append(mirror);
    input.scrollTop = Math.max(0, marker.offsetTop - input.clientHeight / 2); mirror.remove();
}

/** nativeではMonacoのmodule/workerを取得しない。入力以外の正本は呼出側が所有する。 */
export async function createInputSurface(mode: InputMode, host: HTMLElement): Promise<InputSurface> {
    const changes = events(); const cursors = events(); const starts = events(); const ends = events();
    let composing = false;
    const start = (): void => { if (!composing) { composing = true; starts.emit(); } };
    const end = (): void => { if (composing) { composing = false; ends.emit(); } };
    const clear = (): void => { changes.clear(); cursors.clear(); starts.clear(); ends.clear(); };
    const common = { mode, onChange: changes.subscribe, onCursor: cursors.subscribe, onCompositionStart: starts.subscribe, onCompositionEnd: ends.subscribe };
    if (mode === 'native') {
        let sourceText = '';
        const input = document.createElement('textarea'); input.dataset['draftInput'] = 'native';
        input.readOnly = true;
        input.setAttribute('aria-label', '問題JSONの編集'); input.spellcheck = false; input.autocapitalize = 'off';
        input.wrap = 'soft'; input.style.width = '100%'; input.style.height = '100%'; input.style.resize = 'none'; input.style.fontFamily = 'monospace';
        const changed = (): void => { sourceText = input.value; changes.emit(); }; const cursor = (): void => cursors.emit();
        input.addEventListener('input', changed); input.addEventListener('select', cursor); input.addEventListener('keyup', cursor); input.addEventListener('click', cursor);
        input.addEventListener('compositionstart', start); input.addEventListener('compositionend', end);
        host.replaceChildren(input);
        return { ...common, getValue: () => sourceText, setValue(text): void { sourceText = text; input.value = text; },
            getOffset(): number {
                // textareaはCRLFをLFへ正規化する。未編集の保存bufferへ逆写像する。
                let raw = 0; let displayed = 0;
                while (displayed < input.selectionStart && raw < sourceText.length) { raw += sourceText.charAt(raw) === '\r' && sourceText.charAt(raw + 1) === '\n' ? 2 : 1; displayed += 1; }
                return raw;
            },
            jump(offset): void { revealNativeOffset(input, sourceText.slice(0, offset).replace(/\r\n?/gu, '\n').length); cursors.emit(); },
            setReadOnly(value): void { input.readOnly = value; }, setTheme(): void {}, decorate(): void {},
            diagnose(issue): void { input.setAttribute('aria-invalid', issue.kind === 'none' ? 'false' : 'true'); },
            dispose(): void { input.removeEventListener('input', changed); input.removeEventListener('select', cursor); input.removeEventListener('keyup', cursor); input.removeEventListener('click', cursor); input.removeEventListener('compositionstart', start); input.removeEventListener('compositionend', end); clear(); input.remove(); }
        };
    }
    const monaco = await import('./monaco.ts');
    const editor = monaco.editor.create(host, { value: '', language: 'json', automaticLayout: true, ariaLabel: '問題JSONの編集',
        minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false, wordWrap: 'on', readOnly: true,
        theme: document.documentElement.dataset['theme'] === 'dark' || document.documentElement.dataset['theme'] === 'black' ? 'vs-dark' : 'vs' });
    const decorations = editor.createDecorationsCollection();
    const subscriptions = [editor.onDidChangeModelContent(() => changes.emit()), editor.onDidChangeCursorPosition(() => cursors.emit()), editor.onDidCompositionStart(start), editor.onDidCompositionEnd(end)];
    host.addEventListener('compositionstart', start, true); host.addEventListener('compositionend', end, true);
    return { ...common, getValue: () => editor.getValue(), setValue(text): void { editor.setValue(text); },
        getOffset(): number { const position = editor.getPosition(); return position === null ? 0 : editor.getModel()?.getOffsetAt(position) ?? 0; },
        jump(offset): void { const model = editor.getModel(); if (model === null) return; const position = model.getPositionAt(offset); editor.setPosition(position); editor.revealPositionInCenter(position); editor.focus(); },
        setReadOnly(value): void { editor.updateOptions({ readOnly: value }); }, setTheme(theme): void { monaco.editor.setTheme(theme); },
        decorate(ranges): void {
            const model = editor.getModel(); if (model === null) return;
            decorations.set(ranges.map((range) => { const start = model.getPositionAt(range.start); const end = model.getPositionAt(range.end); return { range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), options: { inlineClassName: range.className } }; }));
        },
        diagnose(issue): void { const model = editor.getModel(); if (model === null) return;
            if (issue.kind === 'none') { monaco.editor.setModelMarkers(model, 'quiz-schema', []); return; }
            const start = model.getPositionAt(issue.value.start); const end = model.getPositionAt(issue.value.end);
            monaco.editor.setModelMarkers(model, 'quiz-schema', [{ severity: monaco.MarkerSeverity.Error, message: issue.value.message, startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: Math.max(start.column + 1, end.column) }]);
        },
        dispose(): void { subscriptions.forEach((subscription) => subscription.dispose()); host.removeEventListener('compositionstart', start, true); host.removeEventListener('compositionend', end, true); decorations.clear(); const model = editor.getModel(); editor.dispose(); model?.dispose(); clear(); }
    };
}
