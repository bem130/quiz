import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'vite';
import { appAssetsPlugin, applicationVersion, emitStaticData, entryPath, inspectOutput, precacheAssets } from '../../scripts/build-assets.ts';

async function fixture(run: (directory: string) => Promise<void>): Promise<void> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'quiz-assets-test-'));
    try { await run(directory); }
    finally {
        assert.equal(path.dirname(directory), os.tmpdir());
        assert.ok(path.basename(directory).startsWith('quiz-assets-test-'));
        await rm(directory, { recursive: true, force: true });
    }
}
async function file(root: string, name: string, content: string | Uint8Array): Promise<void> {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
}
async function shell(root: string): Promise<void> {
    await file(root, 'index.html', '<!doctype html><title>Quiz</title>');
    await file(root, 'entry.json', '{"files":[]}');
    await file(root, 'manifest.webmanifest', '{}');
}

await test('公開入力の内容から決定的な版を作り、生成時刻やファイル作成順へ依存しない', async () => {
    await fixture(async root => {
        await file(root, 'src/z.ts', 'export const z=1;');
        await file(root, 'src/a.ts', 'export const a=1;');
        const first = applicationVersion(root);
        assert.equal(first, applicationVersion(root));
        await file(root, 'src/a.ts', 'export const a=2;');
        assert.notEqual(first, applicationVersion(root));
        const second = applicationVersion(root);
        await file(root, 'src/core/quality-rules-test/negative.ts', 'temporary invalid code');
        assert.equal(second, applicationVersion(root));
    });
});

await test('entry参照は公開dataの相対JSONへ限定しエンコードした脱出も拒否する', () => {
    assert.equal(entryPath('./data/sample/math-v3.json'), 'data/sample/math-v3.json');
    for (const value of ['../secret.json', '/data/a.json', 'https://example.test/a.json', 'data/%2e%2e/secret.json', 'data%5c..%5csecret.json', 'data/a.json?token=secret', 'data//a.json', 'data/a.svg']) {
        assert.throws(() => entryPath(value));
    }
});

await test('全出力からfonts・WASM・workerもhash付きprecacheへ含める', async () => {
    await fixture(async root => {
        await shell(root);
        await file(root, 'assets/font-a.woff2', new Uint8Array([1, 2, 3]));
        await file(root, 'assets/rdkit-a.wasm', new Uint8Array([0, 97, 115, 109]));
        await file(root, 'assets/editor-worker-a.js', 'postMessage("worker");');
        await file(root, 'sw.js', 'worker');
        await file(root, 'app-version.json', '{}');
        const assets = await precacheAssets(root, '/quiz/');
        assert.ok(assets.some(asset => asset.url === '/quiz/assets/font-a.woff2' && asset.size === 3));
        assert.ok(assets.some(asset => asset.url.endsWith('.wasm')));
        assert.ok(assets.some(asset => asset.url.includes('editor-worker')));
        assert.ok(assets.every(asset => /^[a-f\d]{64}$/u.test(asset.sha256)));
        assert.equal(assets.some(asset => asset.url.endsWith('/sw.js')), false);
        assert.equal(assets.some(asset => asset.url.endsWith('/app-version.json')), false);
    });
});

await test('PHPや開発sourceを公開成果物として受理しない', async () => {
    await fixture(async root => {
        await shell(root);
        await file(root, 'ogp-card.php', '<?php secret();');
        await assert.rejects(inspectOutput(root), /Development\/server/u);
    });
});

await test('静的HTMLにPHPや外部CDNの実行依存を残さない', async () => {
    await fixture(async root => {
        await shell(root);
        await file(root, 'index.html', '<link rel="manifest" href="/quiz/manifest.php">');
        await assert.rejects(inspectOutput(root), /PHP runtime/u);
        await file(root, 'index.html', '<script src="https://example.test/library.js"></script>');
        await assert.rejects(inspectOutput(root), /External runtime/u);
    });
});

await test('静的題庫をstrict検証して必要なdataとiconsだけをcopyする', async () => {
    await fixture(async root => {
        const output = path.join(root, 'output');
        await mkdir(output);
        await file(root, 'public/entry.json', '{"version":3,"files":["./data/sample/q.json"]}');
        await file(root, 'data/sample/q.json', JSON.stringify({
            title: '題庫', description: '説明', table: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
            patterns: [{ id: 'p', tokens: [{ type: 'hide', id: 'h', value: [{ type: 'key', field: 'name' }], answer: { mode: 'choice_from_entities' } }] }]
        }));
        await file(root, 'icons/icon-192.svg', '<svg/>');
        await file(root, 'icons/icon-512.svg', '<svg/>');
        await emitStaticData(root, output);
        assert.ok((await readFile(path.join(output, 'data/sample/q.json'), 'utf8')).includes('題庫'));
        await file(root, 'data/sample/q.json', '{"version":2}');
        await assert.rejects(emitStaticData(root, output), /Invalid static quiz/u);
    });
});

await test('実際のVite buildが同一versionのpage・worker・更新metadataを生成する', async () => {
    await fixture(async root => {
        await file(root, 'index.html', '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>');
        await file(root, 'src/main.ts', 'document.body.dataset.version=__APP_VERSION__;');
        await file(root, 'src/service-worker.ts', await readFile(new URL('../../src/service-worker.ts', import.meta.url), 'utf8'));
        await file(root, 'public/entry.json', '{"version":3,"files":["./data/sample/math-v3.json"]}');
        await file(root, 'public/manifest.webmanifest', '{}');
        await file(root, 'data/sample/math-v3.json', await readFile(new URL('../../data/sample/math-v3.json', import.meta.url), 'utf8'));
        await file(root, 'icons/icon-192.svg', '<svg/>');
        await file(root, 'icons/icon-512.svg', '<svg/>');
        const version = applicationVersion(root);
        await build({
            configFile: false, root, base: '/quiz/', logLevel: 'silent', publicDir: 'public',
            define: { __APP_VERSION__: JSON.stringify(version) }, plugins: [appAssetsPlugin(version)],
            build: { outDir: 'dist', target: 'es2022', manifest: true }
        });
        const output = path.join(root, 'dist');
        const files = await inspectOutput(output);
        assert.ok((await readFile(path.join(output, 'sw.js'), 'utf8')).includes(version));
        assert.deepEqual(JSON.parse(await readFile(path.join(output, 'app-version.json'), 'utf8')), { version });
        const javascript = files.filter(name => name.startsWith('assets/') && name.endsWith('.js'));
        assert.equal(javascript.length, 1);
        const main = javascript.at(0);
        assert.ok(main);
        assert.ok((await readFile(path.join(output, main), 'utf8')).includes(version));
        assert.ok(files.includes('data/sample/math-v3.json'));
        assert.equal(files.some(name => name.endsWith('.php')), false);
    });
});

await test('keyとlistkeyで参照する行内SVG、およびSVG fieldの相対fileをcopyする', async () => {
    await fixture(async root => {
        const output = path.join(root, 'output');
        await mkdir(output);
        await file(root, 'public/entry.json', '{"version":3,"files":["./data/sample/q.json"]}');
        await file(root, 'data/sample/q.json', JSON.stringify({
            title: '図', description: '行内参照', table: [{
                id: 'a', name: 'A', image: [{ type: 'svg', src: '../figures/a.svg', alt: '図A' }],
                images: [[{ type: 'svg', src: './b.svg', alt: '図B' }]], imageFile: './c.svg'
            }], patterns: [{ id: 'p', tokens: [
                { type: 'key', field: 'image' }, { type: 'listkey', field: 'images' },
                { type: 'svg', field: 'imageFile', alt: '図C' },
                { type: 'hide', id: 'h', value: [{ type: 'key', field: 'name' }], answer: { mode: 'choice_from_entities' } }
            ] }]
        }));
        for (const name of ['data/figures/a.svg', 'data/sample/b.svg', 'data/sample/c.svg', 'icons/icon-192.svg', 'icons/icon-512.svg']) await file(root, name, '<svg/>');
        await emitStaticData(root, output);
        for (const name of ['data/figures/a.svg', 'data/sample/b.svg', 'data/sample/c.svg']) assert.equal(await readFile(path.join(output, name), 'utf8'), '<svg/>');
    });
});
