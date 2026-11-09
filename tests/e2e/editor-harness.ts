import * as monaco from '../../src/web/monaco.ts';
import { openQuizStorage } from '../../src/web/storage/database.ts';
import { mountDraftEditor } from '../../src/web/editor.ts';
import type { EditorController, EditorStorage } from '../../src/web/editor.ts';
import { none, some } from '../../src/core/result.ts';
import type { Option } from '../../src/core/result.ts';

export type EditorHarness = Readonly<{
    ready: boolean;
    setText(text: string): void;
    getText(): string;
    isDirty(): boolean;
    savedText(id: string): Promise<string>;
    updateExternally(id: string, text: string): Promise<void>;
    setFailure(value: boolean): void;
    flush(): Promise<boolean>;
    reopen(): Promise<void>;
}>;
declare global { interface Window { editorHarness: EditorHarness } }

const opened = await openQuizStorage('quiz-editor-e2e');
if (!opened.ok) throw new Error(opened.error.message);
const storage = opened.value;
const existing = await storage.listDrafts();
if (!existing.ok) throw new Error(existing.error.message);
if (existing.value.length === 0) {
    for (const path of ['a.json', 'b.json']) {
        const text = JSON.stringify({ title: path, description: 'テスト', table: [{ id: 'a', term: 'A' }, { id: 'b', term: 'B' }],
            patterns: [{ id: 'p', tokens: [{ type: 'hide', id: 'h', value: [{ type: 'key', field: 'term' }], answer: { mode: 'choice_from_entities' } }] }] });
        const saved = await storage.saveDraft({ id: path, text, expectedVersion: 0, updatedAt: 0 });
        if (!saved.ok) throw new Error(saved.error.message);
    }
}
let fail = false;
let controller: Option<EditorController> = none;
const adapter: EditorStorage = {
    listDrafts: () => storage.listDrafts(),
    saveDraft: (value) => fail ? Promise.resolve({ ok: false, error: { kind: 'request', message: '保存失敗を再現' } }) : storage.saveDraft(value),
    moveDraft: (...args) => storage.moveDraft(...args), deleteDraft: (...args) => storage.deleteDraft(...args),
    moveDraftTree: (...args) => storage.moveDraftTree(...args), deleteDraftTree: (...args) => storage.deleteDraftTree(...args),
    getSetting: (id) => storage.getSetting(id), setSetting: (value) => storage.setSetting(value),
    getAsset: (id) => storage.getAsset(id), saveAsset: (value) => storage.saveAsset(value)
};
const host = document.getElementById('editor-host');
if (host === null) throw new Error('検証用hostがない');
const mount = async (): Promise<void> => {
    const mounted = await mountDraftEditor(host, adapter, {
        onSaved: () => { host.dataset['saved'] = 'true'; },
        onClose: () => { host.dataset['closed'] = 'true'; return Promise.resolve(); }
    });
    if (!mounted.ok) throw new Error(mounted.error.detail);
    controller = some(mounted.value);
};
await mount();
window.editorHarness = {
    ready: true,
    setText(text): void {
        const model = monaco.editor.getModels().at(0); if (model === undefined) throw new Error('編集modelがない');
        model.setValue(text);
    },
    getText(): string { return monaco.editor.getModels().at(0)?.getValue() ?? ''; },
    isDirty(): boolean { return controller.kind === 'some' && controller.value.isDirty(); },
    async savedText(id): Promise<string> {
        const entries = await storage.listDrafts(); if (!entries.ok) throw new Error(entries.error.message);
        return entries.value.find((entry) => entry.id === id)?.text ?? '';
    },
    async updateExternally(id, text): Promise<void> {
        const entries = await storage.listDrafts(); if (!entries.ok) throw new Error(entries.error.message);
        const record = entries.value.find((entry) => entry.id === id); if (record === undefined) throw new Error('草稿がない');
        const saved = await storage.saveDraft({ id, text, expectedVersion: record.version, updatedAt: Date.now() });
        if (!saved.ok) throw new Error(saved.error.message);
    },
    setFailure(value): void { fail = value; },
    async flush(): Promise<boolean> { return controller.kind === 'some' && (await controller.value.flush()).ok; },
    async reopen(): Promise<void> {
        if (controller.kind === 'some') {
            const saved = await controller.value.flush(); if (!saved.ok) throw new Error(saved.error.detail);
            controller.value.dispose();
        }
        await mount();
    }
};
