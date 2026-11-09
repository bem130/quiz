import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(import.meta.dirname, '../..');
const bundle = path.resolve(process.env.OGP_BUNDLE ?? path.join(root, 'tmp/ogp-dist'));
const php = process.env.PHP_BIN ?? (process.platform === 'win32' ? path.join(root, 'tmp/ogp-check/php-8.5.12/php.exe') : 'php');
const extensionDir = process.env.PHP_EXTENSION_DIR ?? (process.platform === 'win32' ? path.join(path.dirname(php), 'ext') : '');
const args = ['-n', ...(extensionDir ? ['-d', `extension_dir=${extensionDir}`] : []), '-d', 'extension=gd', '-d', 'extension=mbstring'];

await test('生PHP/GD: UTF-8境界・折返しとHTTP PNG応答', async (context) => {
    assert.match(execFileSync(php, [...args, path.join(root, 'tests/ogp/unit.php'), bundle], { encoding: 'utf8' }), /checks passed/);
    const listener = net.createServer();
    await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
    const address = listener.address();
    assert.ok(address && typeof address === 'object');
    await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    let log = '';
    const server = spawn(php, [...args, '-S', `127.0.0.1:${address.port}`, '-t', bundle], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    server.stdout.on('data', data => { log += String(data); });
    server.stderr.on('data', data => { log += String(data); });
    context.after(async () => {
        if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
    });
    const url = `http://127.0.0.1:${address.port}/ogp-card.php`;
    for (let index = 0; index < 100; index++) {
        try { await fetch(url); break; }
        catch { if (index === 99) assert.fail(log); await delay(50); }
    }
    const output = path.join(root, 'tmp/ogp-evidence');
    await mkdir(output, { recursive: true });
    const fixtures = [
        ['default', {}],
        ['japanese', { title: '日本語の四択クイズ', description: '漢字・ひらがな・カタカナを使った問題で、理解度を確かめます。' }],
        ['long', { title: '非常に長い題名'.repeat(30), description: '日本語の長い説明文です。'.repeat(80) }],
        ['multiline', { title: '一行目\r\n二行目\r三行目', description: '説明の一行目\n\n空行の後の三行目\n四行目\n省略される五行目' }],
        ['empty', { title: '', description: '', quiz: '' }],
        ['unicode-empty', { title: '\u3000\uFEFF', description: '\u00A0' }],
        ['metadata', { quiz: 'math-v3' }]
    ];
    let defaults;
    for (const [name, query] of fixtures) {
        const response = await fetch(`${url}?${new URLSearchParams(query)}`);
        assert.equal(response.status, 200, `${name}: ${await response.clone().text()}\n${log}`);
        assert.equal(response.headers.get('content-type'), 'image/png');
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
        assert.equal(bytes.readUInt32BE(16), 1280); assert.equal(bytes.readUInt32BE(20), 720);
        assert.equal(Number(response.headers.get('content-length')), bytes.length);
        if (name === 'default') defaults = bytes;
        if (name === 'empty' || name === 'unicode-empty') assert.deepEqual(bytes, defaults);
        await writeFile(path.join(output, `${name}.png`), bytes);
    }
    for (const query of ['title[]=a', 'description[]=a', 'quiz[]=a', 'title=%FF', 'title=%00', 'quiz=..%2Fdata', 'quiz=https%3A%2F%2Fexample.com', `title=${'a'.repeat(241)}`, `description=${'a'.repeat(1201)}`]) {
        const response = await fetch(`${url}?${query}`);
        assert.equal(response.status, 400, query);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.ok(!(await response.text()).includes('Warning'));
    }
    assert.equal((await fetch(`${url}?quiz=unknown`)).status, 404);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.doesNotMatch(log, /Fatal error|Warning|Deprecated/);
    assert.match(await readFile(path.join(bundle, 'fonts/OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE/);
});
