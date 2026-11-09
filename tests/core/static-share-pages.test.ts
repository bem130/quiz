import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { emitStaticSharePages } from '../../scripts/static-share-pages.ts';
import { inspectOutput, precacheAssets } from '../../scripts/build-assets.ts';

function decodeAttribute(value: string): string {
    return value.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}
function metadata(html: string, name: string): string {
    for (const tag of html.match(/<meta\b[^>]*>/gu) ?? []) {
        if (tag.includes(`name="${name}"`) || tag.includes(`property="${name}"`)) {
            const content = /content="([^"]*)"/u.exec(tag)?.[1];
            if (content !== undefined) return decodeAttribute(content);
        }
    }
    throw new Error(`Missing metadata: ${name}`);
}
async function withOutput(run: (output: string) => Promise<void>): Promise<void> {
    const output = await mkdtemp(path.join(os.tmpdir(), 'quiz-share-pages-'));
    try { await run(output); }
    finally {
        assert.equal(path.dirname(output), os.tmpdir());
        assert.ok(path.basename(output).startsWith('quiz-share-pages-'));
        await rm(output, { recursive: true, force: true });
    }
}
async function put(output: string, relative: string, text: string): Promise<void> {
    await mkdir(path.dirname(path.join(output, relative)), { recursive: true });
    await writeFile(path.join(output, relative), text, 'utf8');
}
const shell = '<!doctype html><html><head><meta charset="UTF-8"><title>Common</title><meta property="og:title" content="Common"><meta property="og:description" content="Common description"><meta property="og:url" content="https://bem130.github.io/quiz/"><meta property="og:image" content="common.png"><meta name="twitter:image" content="common.png"><link rel="canonical" href="https://bem130.github.io/quiz/"><link rel="stylesheet" href="/quiz/assets/main-hash.css"></head><body><script type="module" src="/quiz/assets/main-hash.js"></script></body></html>';
function quiz(title: string, description: string): string {
    return JSON.stringify({ title, description, table: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], patterns: [{ id: 'p', tokens: [{ type: 'hide', id: 'h', value: [{ type: 'key', field: 'name' }], answer: { mode: 'choice_from_entities' } }] }] });
}

await test('JSなしHTTPで個別OGPと同一registryを返し、同basename・日本語path・悪意ある題名を安全に生成する', async () => {
    await withOutput(async output => {
        const sources = ['data/a/same.json', 'data/日本語/same.json'];
        const title = '[題庫/だいこ] </title><script>alert("x")</script> & "quote" $& $` $\'';
        const description = '{用語/term} <img src=x onerror=alert(1)>';
        await put(output, 'index.html', shell);
        await put(output, sources[0] ?? '', quiz(title, description));
        await put(output, sources[1] ?? '', quiz('別題庫', '別説明'));
        await put(output, 'entry.json', '{}'); await put(output, 'manifest.webmanifest', '{}');
        await put(output, 'assets/main-hash.js', 'document.body.dataset.started="true";');
        await put(output, 'assets/main-hash.css', 'body{color:black}');
        await emitStaticSharePages(output, '/quiz/', sources);
        const expectedRegistry = { version: 1, base: '/quiz/', pages: sources.map(source => ({ source, path: `share/${source.slice(0, -5)}.html` })) };
        const server = createServer((request, response) => {
            const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
            const relative = decodeURIComponent(pathname.slice('/quiz/'.length)) || 'index.html';
            void readFile(path.join(output, relative)).then(body => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(body); }, () => { response.statusCode = 404; response.end(); });
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const address = server.address();
            assert.ok(address !== null && typeof address !== 'string');
            const origin = `http://127.0.0.1:${address.port}`;
            for (const relative of ['index.html', ...expectedRegistry.pages.map(page => page.path)]) {
                const response = await fetch(`${origin}/quiz/${relative.split('/').map(encodeURIComponent).join('/')}`);
                assert.equal(response.status, 200);
                const html = await response.text();
                assert.deepEqual(JSON.parse(metadata(html, 'quiz-share-pages')), expectedRegistry);
                assert.match(html, /<head>\s*<meta charset="UTF-8">\s*<base href="\/quiz\/">\s*<meta name="quiz-share-pages"/u);
                for (const asset of ['/quiz/assets/main-hash.js', '/quiz/assets/main-hash.css']) {
                    assert.ok(html.includes(asset)); assert.equal((await fetch(`${origin}${asset}`)).status, 200);
                }
                if (relative === 'index.html') { assert.equal(metadata(html, 'og:title'), 'Common'); continue; }
                const canonical = `https://bem130.github.io/quiz/${relative.split('/').map(encodeURIComponent).join('/')}`;
                assert.equal(metadata(html, 'og:url'), canonical);
                assert.ok(html.includes(`<link rel="canonical" href="${canonical}">`));
                assert.equal(metadata(html, 'og:image'), metadata(html, 'twitter:image'));
                const image = new URL(metadata(html, 'og:image'));
                assert.equal(image.origin + image.pathname, 'https://bem130.com/quiz/ogp-card.php');
                assert.equal(image.searchParams.get('title'), metadata(html, 'og:title'));
                assert.equal(image.searchParams.get('description'), metadata(html, 'og:description'));
                assert.equal(image.searchParams.has('quiz'), false);
                assert.doesNotMatch(html, /<script>alert|<img src=x/u);
                if (relative.includes('/a/')) {
                    assert.equal(metadata(html, 'og:title'), title.replace('[題庫/だいこ]', '題庫'));
                    assert.equal(metadata(html, 'og:description'), '用語 (term) <img src=x onerror=alert(1)>');
                }
            }
        } finally { await new Promise<void>((resolve, reject) => server.close(error => { if (error) reject(error); else resolve(); })); }
        const assets = await precacheAssets(output, '/quiz/');
        for (const page of expectedRegistry.pages) assert.ok(assets.some(asset => decodeURIComponent(asset.url) === `/quiz/${page.path}`));
        await put(output, 'share/data/a/same.html', '<script src="https://evil.test/code.js"></script>');
        await assert.rejects(inspectOutput(output), /External runtime/u);
    });
});

await test('大きな日本語registryより前の先頭1024bytes内にUTF-8宣言を一つだけ保持する', async () => {
    await withOutput(async output => {
        const sources = Array.from({ length: 12 }, (_, index) => `data/日本語の長い題庫ディレクトリ${index}/same.json`);
        await put(output, 'index.html', shell.replace('<meta charset="UTF-8">', '<meta charset="shift_jis"><meta http-equiv="Content-Type" content="text/html; charset=shift_jis">'));
        for (const source of sources) await put(output, source, quiz('日本語題庫', '説明'));
        await emitStaticSharePages(output, '/quiz/', sources);
        for (const relative of ['index.html', ...sources.map(source => `share/${source.slice(0, -5)}.html`)]) {
            const html = await readFile(path.join(output, relative), 'utf8');
            assert.ok(Buffer.byteLength(metadata(html, 'quiz-share-pages'), 'utf8') > 1024);
            assert.equal((html.match(/<meta\b[^>]*\bcharset\s*=/giu) ?? []).length, 1);
            assert.doesNotMatch(html, /http-equiv="Content-Type"|shift_jis/iu);
            const charset = html.indexOf('<meta charset="UTF-8">');
            assert.ok(charset > 0);
            assert.ok(Buffer.byteLength(html.slice(0, charset + '<meta charset="UTF-8">'.length), 'utf8') <= 1024);
            assert.ok(charset < html.indexOf('<base href='));
            assert.ok(charset < html.indexOf('name="quiz-share-pages"'));
            assert.ok(charset < html.indexOf('property="og:url"'));
        }
    });
});

await test('OGP入力長は補助文字を分断せずPHPのコードポイント上限以内へ収める', async () => {
    await withOutput(async output => {
        await put(output, 'index.html', shell);
        await put(output, 'data/long.json', quiz('😀'.repeat(241), '𠮷'.repeat(1201)));
        await emitStaticSharePages(output, '/quiz/', ['data/long.json']);
        const html = await readFile(path.join(output, 'share/data/long.html'), 'utf8');
        const image = new URL(metadata(html, 'og:image'));
        assert.equal(image.searchParams.get('title'), '😀'.repeat(240));
        assert.equal(image.searchParams.get('description'), '𠮷'.repeat(1200));
    });
});
