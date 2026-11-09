/**
 * Monaco 0.57 の配布内部への依存はこの境界だけに置く。
 * JSON が後から読み込む editor contribution も、初回 service 初期化前に登録する。
 * バージョン更新時は再 open と JSON worker を実ブラウザで再検証する。
 */
import 'monaco-editor/internal/common/workers.js';
import 'monaco-editor/language/json/monaco.contribution.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';

globalThis.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
        return label === 'json' ? new JsonWorker() : new EditorWorker();
    }
};

export * from 'monaco-editor/editor/editor.api.js';
