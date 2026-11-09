import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ogpMetadata, prepareOgp } from '../../scripts/prepare-ogp.ts';

const root = path.resolve(import.meta.dirname, '../..');
const bundle = path.resolve(process.env.OGP_BUNDLE ?? path.join(root, 'tmp/ogp-dist'));

await test('OGP準備はPages出力を拒否し、固定SHAの依存だけを専用bundleへ含める', async (context) => {
    await assert.rejects(prepareOgp(path.join(root, 'dist')), /under repository tmp/);
    const output = await mkdtemp(path.join(root, 'tmp/ogp-prepare-test-'));
    context.after(() => rm(output, { recursive: true, force: true }));
    const original = globalThis.fetch;
    context.after(() => { globalThis.fetch = original; });
    const requested = [];
    globalThis.fetch = async input => {
        const url = String(input);
        assert.match(url, /^https:\/\/raw\.githubusercontent\.com\/notofonts\/noto-cjk\/f8d157532fbfaeda587e826d4cd5b21a49186f7c\/Sans\//);
        requested.push(url);
        const file = url.endsWith('/LICENSE') ? 'fonts/OFL.txt' : 'fonts/NotoSansJP-Regular.otf';
        return new Response(await readFile(path.join(bundle, file)));
    };
    await prepareOgp(output);
    assert.equal(requested.length, 2);
    assert.deepEqual((await readdir(output)).sort(), ['fonts', 'metadata.json', 'ogp-card.php']);
    assert.deepEqual((await readdir(path.join(output, 'fonts'))).sort(), ['NotoSansJP-Regular.otf', 'OFL.txt']);
    const metadata = JSON.parse(await readFile(path.join(output, 'metadata.json'), 'utf8'));
    assert.equal(typeof metadata['math-v3'].title, 'string');
    assert.equal(typeof metadata['svg-v3'].description, 'string');
    assert.ok(!/[{}\[\]]/u.test(metadata['math-v3'].title));
    await assert.rejects(prepareOgp(output), /must be empty/);
});

await test('metadataはruby/glossを共通plainTextへ投影し、出力文字数とUnicodeを検証する', () => {
    assert.deepEqual(ogpMetadata('[漢字/かんじ]', '{[用語/ようご]/term}と$x$'), { title: '漢字', description: '用語 (term)と$x$' });
    assert.equal(ogpMetadata('[字/じ]'.repeat(240), '説明').title.length, 240);
    for (const text of ['x'.repeat(241), '\uD800', '\uDC00', '\0']) assert.throws(() => ogpMetadata(text, '説明'), /contract/);
    assert.equal(ogpMetadata('題名', '説'.repeat(1200)).description.length, 1200);
    assert.throws(() => ogpMetadata('題名', '説'.repeat(1201)), /contract/);
});

await test('出力祖先のjunctionがtmp外へ出る場合は外部directoryを作成する前に拒否する', async (context) => {
    const external = await mkdtemp(path.join(os.tmpdir(), 'quiz-ogp-boundary-'));
    const holder = await mkdtemp(path.join(root, 'tmp/ogp-junction-test-'));
    context.after(async () => {
        assert.equal(path.dirname(holder), path.join(root, 'tmp'));
        assert.equal(path.dirname(external), os.tmpdir());
        await rm(holder, { recursive: true, force: true });
        await rm(external, { recursive: true, force: true });
    });
    await symlink(external, path.join(holder, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(prepareOgp(path.join(holder, 'linked', 'must-not-create')), /symlink escapes/);
    await assert.rejects(access(path.join(external, 'must-not-create')));
});

await test('配布元応答が改変されていればSHA照合でPHPの配信bundleを完成させない', async (context) => {
    const output = await mkdtemp(path.join(root, 'tmp/ogp-invalid-test-'));
    context.after(() => rm(output, { recursive: true, force: true }));
    const original = globalThis.fetch;
    context.after(() => { globalThis.fetch = original; });
    globalThis.fetch = () => Promise.resolve(new Response('changed dependency'));
    await assert.rejects(prepareOgp(output), /SHA-256 mismatch/);
    assert.ok(!(await readdir(output)).includes('ogp-card.php'));
});
