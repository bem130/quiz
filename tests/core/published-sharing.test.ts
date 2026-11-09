import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentPublishedPage, publishedPages, publishedShareTarget } from '../../src/web/published-sharing.ts';
import { shareUrl, sharedEntries } from '../../src/web/sharing.ts';

const base = 'https://bem130.github.io/quiz/';
function registry(source = 'data/sample/math-v3.json'): string {
    return JSON.stringify({ version: 1, base: '/quiz/', pages: [{ source, path: `share/${source.slice(0, -5)}.html` }] });
}

await test('生成registryはraw pathをsegmentごと一度だけencodeし同じorigin/baseへ解決する', () => {
    const result = publishedPages(registry('data/日本語 100%.json'), base);
    if (!result.ok || result.value.kind === 'none') assert.fail('registryを利用できない');
    assert.deepEqual(result.value.value.pages, [{
        source: `${base}data/${encodeURIComponent('日本語 100%.json')}`,
        url: `${base}share/data/${encodeURIComponent('日本語 100%.html')}`
    }]);
    const page = result.value.value.pages.at(0); assert.ok(page);
    assert.deepEqual(currentPublishedPage(result.value.value, `${page.url}?scope=[]#hash`), { kind: 'some', value: page });
    assert.equal(currentPublishedPage(result.value.value, `${base}share/unknown.html`).kind, 'none');
    assert.deepEqual(publishedPages(null, base), { ok: true, value: { kind: 'none' } });
});

await test('registry全体をunknownとして検証し、不正base・URL・dotpath・重複・surrogateを拒否する', () => {
    for (const raw of ['{', 'null', '[]', '{}', registry().replace('"version":1', '"version":2'), registry().replace('/quiz/', '/other/'),
        registry('data/../secret.json'), registry('data/.hidden/a.json'), registry('data/\ud800.json'),
        JSON.stringify({ version: 1, base: '/quiz/', pages: [{ source: 'https://evil.test/data/a.json', path: 'share/data/a.html' }] }),
        JSON.stringify({ version: 1, base: '/quiz/', pages: [{ source: 'data/a.json', path: 'https://evil.test/share/data/a.html' }] }),
        JSON.stringify({ version: 1, base: '/quiz/', pages: [{ source: 'data/a.json', path: 'share/data/a.html' }, { source: 'data/a.json', path: 'share/data/a.html' }] })]) {
        assert.equal(publishedPages(raw, base).ok, false, raw);
    }
});

await test('共有対象は同梱1題庫だけ個別HTMLにしsubsetを保持、外部・草稿・混合はrootへ戻す', () => {
    const parsed = publishedPages(registry(), base);
    if (!parsed.ok || parsed.value.kind === 'none') assert.fail('registryを利用できない');
    const pages = parsed.value.value;
    const packages = [{ source: `${base}data/sample/math-v3.json`, patternIds: ['math-a', 'math-b'] },
        { source: 'https://outside.test/a.json', patternIds: ['external'] }, { source: 'draft/a.json', patternIds: ['draft'] }];
    const context = { pages, packages };
    assert.equal(publishedShareTarget(pages, [], packages).kind, 'none');
    const one = new URL(shareUrl(`${base}?entry=old&entries=old#old`, ['math-b'], ['https://outside.test/entry.json'], context));
    assert.equal(one.pathname, '/quiz/share/data/sample/math-v3.html');
    assert.deepEqual([...one.searchParams.keys()], ['scope', 'entries']);
    assert.equal(one.searchParams.get('scope'), '["math-b"]'); assert.equal(one.hash, '');
    assert.deepEqual(sharedEntries(one.searchParams, one.href), { ok: true, value: [`${base}entry.json`] });
    assert.equal(shareUrl(one.href, ['math-b'], [`${base}entry.json`, 'https://private.test/entry.json'], context), one.href);
    for (const scope of [['math-a', 'external'], ['external'], ['draft'], ['math-a', 'unknown']]) {
        const shared = new URL(shareUrl(one.href, scope, ['https://outside.test/entry.json'], context));
        assert.equal(shared.pathname, '/quiz/'); assert.equal(shared.searchParams.get('scope'), JSON.stringify(scope));
        assert.deepEqual(sharedEntries(shared.searchParams, base), { ok: true, value: ['https://outside.test/entry.json'] });
    }
});

await test('registryのないdev・旧HTMLは3引数APIの既存entry/scope共有を維持する', () => {
    const shared = new URL(shareUrl(`${base}?entry=https%3A%2F%2Foutside.test%2Fentry.json`, ['p'], []));
    assert.equal(shared.pathname, '/quiz/'); assert.equal(shared.searchParams.get('scope'), '["p"]');
    assert.equal(shared.searchParams.get('entry'), 'https://outside.test/entry.json');
});
