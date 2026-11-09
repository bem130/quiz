import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

class MemoryCache {
    readonly entries = new Map<string, Response>();
    readonly requestHeaders = new Map<string, Headers>();
    match(request: Request | string, options: Readonly<{ ignoreVary?: boolean }> = {}): Promise<Response | undefined> {
        const actual = typeof request === 'string' ? new Request(request) : request;
        const cached = this.entries.get(actual.url);
        if (!cached) return Promise.resolve(undefined);
        if (!options.ignoreVary) {
            for (const header of (cached.headers.get('Vary') ?? '').split(',').filter(Boolean)) {
                if (actual.headers.get(header.trim()) !== this.requestHeaders.get(actual.url)?.get(header.trim())) return Promise.resolve(undefined);
            }
        }
        return Promise.resolve(cached.clone());
    }
    put(request: Request | string, response: Response): Promise<void> {
        const actual = typeof request === 'string' ? new Request(request) : request;
        this.entries.set(actual.url, response.clone()); this.requestHeaders.set(actual.url, new Headers(actual.headers)); return Promise.resolve();
    }
    delete(request: Request | string): Promise<boolean> {
        const url = typeof request === 'string' ? request : request.url;
        this.requestHeaders.delete(url); return Promise.resolve(this.entries.delete(url));
    }
    keys(): Promise<Request[]> { return Promise.resolve([...this.entries.keys()].map(key => new Request(key))); }
}
class MemoryCaches {
    readonly values = new Map<string, MemoryCache>();
    open(name: string): Promise<MemoryCache> {
        const existing = this.values.get(name);
        if (existing) return Promise.resolve(existing);
        const created = new MemoryCache(); this.values.set(name, created); return Promise.resolve(created);
    }
    delete(name: string): Promise<boolean> { return Promise.resolve(this.values.delete(name)); }
    keys(): Promise<string[]> { return Promise.resolve([...this.values.keys()]); }
}
type Listener = (event: unknown) => void;
type StaticFixture = Readonly<{ url: string; body: string; type: string }>;
function isListener(value: unknown): value is Listener { return typeof value === 'function'; }
async function workerHarness(version = 'v1', storage = new MemoryCaches(), activeClients = true, extra: readonly StaticFixture[] = []): Promise<Readonly<{
    caches: MemoryCaches; events: Map<string, Listener>; requests: string[];
    setOffline(value: boolean): void; setCorrupt(value: boolean): void;
    skipped(): boolean; request(request: Request): Promise<Response>; install(): Promise<void>; activate(): Promise<void>;
}>> {
    const body = '<!doctype html><title>Quiz</title>';
    const files = [{ url: '/quiz/index.html', body, type: 'text/html' }, ...extra];
    const events = new Map<string, Listener>();
    const requests: string[] = [];
    let offline = false; let corrupt = false; let skipped = false;
    const source = await readFile(new URL('../../src/service-worker.ts', import.meta.url), 'utf8');
    const code = stripTypeScriptTypes(source).replace(/export\s*\{\s*\};?/u, '');
    const context = vm.createContext({
        URL, Request, Response, AbortController, setTimeout, clearTimeout, crypto: webcrypto,
        __APP_VERSION__: version,
        __PRECACHE__: files.map(file => ({ url: file.url, size: Buffer.byteLength(file.body), sha256: createHash('sha256').update(file.body).digest('hex') })),
        caches: storage,
        self: {
            registration: { scope: 'https://example.test/quiz/' },
            clients: { matchAll() { return Promise.resolve(activeClients ? [{ url: 'https://example.test/quiz/' }] : []); }, claim() { return Promise.resolve(); } },
            skipWaiting() { skipped = true; return Promise.resolve(); },
            addEventListener(type: string, handler: unknown) { if (!isListener(handler)) throw new Error('listener'); events.set(type, handler); }
        },
        fetch: (request: Request | string): Promise<Response> => {
            const url = typeof request === 'string' ? request : request.url;
            requests.push(url);
            if (offline) return Promise.reject(new Error('offline'));
            const file = files.find(file => new URL(file.url, 'https://example.test/quiz/').href === url);
            if (file) return Promise.resolve(new Response(corrupt ? '<h1>not found</h1>' : file.body, { headers: { 'Content-Type': file.type, Vary: 'Origin' } }));
            return Promise.resolve(new Response(JSON.stringify({ version, url }), { headers: { 'Content-Type': 'application/json' } }));
        }
    });
    vm.runInContext(code, context);
    function lifetime(type: string): Promise<void> {
        let completion = Promise.resolve();
        events.get(type)?.({ waitUntil(promise: Promise<void>) { completion = promise; } });
        return completion;
    }
    return {
        caches: storage, events, requests, setOffline(value) { offline = value; }, setCorrupt(value) { corrupt = value; }, skipped() { return skipped; },
        async request(request) {
            let response = Promise.resolve(Response.error());
            events.get('fetch')?.({ request, respondWith(value: Promise<Response>) { response = value; } });
            return response;
        },
        install() { return lifetime('install'); }, activate() { return lifetime('activate'); }
    };
}

await test('installは全資産のhashを確認し、HTMLが200で返る欠損assetも拒否する', async () => {
    const worker = await workerHarness();
    worker.setCorrupt(true);
    await assert.rejects(worker.install(), /Precache integrity/u);
    assert.equal((await worker.caches.keys()).length, 0);
    assert.equal(worker.skipped(), false);
});

await test('waitingを自動解除せず、明示messageだけでskipWaitingする', async () => {
    const worker = await workerHarness();
    await worker.install();
    assert.equal(worker.skipped(), false);
    worker.events.get('message')?.({ data: { type: 'SKIP_WAITING' }, waitUntil() { /* immediate fake Promise */ } });
    assert.equal(worker.skipped(), true);
});

await test('拡張子なしのdataをnetworkfirstで保存しworker再起動後もoffline取得する', async () => {
    const original = await workerHarness();
    const request = new Request('https://external.test/api/quiz');
    const fetched = await original.request(request);
    assert.equal(fetched.status, 200);
    const restarted = await workerHarness('v1', original.caches);
    restarted.setOffline(true);
    const fallback = await restarted.request(request);
    assert.equal(await fallback.text(), await fetched.text());
});

await test('version metadataはcacheへ入れずofflineでは旧値を返さない', async () => {
    const worker = await workerHarness();
    const request = new Request('https://example.test/quiz/app-version.json');
    assert.equal((await worker.request(request)).status, 200);
    worker.setOffline(true);
    await assert.rejects(worker.request(request), /offline/u);
});

await test('hash検証済みstatic資産はVary Origin付きでもmoduleのoffline要求へ返せる', async () => {
    const worker = await workerHarness();
    await worker.install(); worker.setOffline(true);
    const response = await worker.request(new Request('https://example.test/quiz/index.html', { headers: { Origin: 'https://example.test' } }));
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes('Quiz'));
});

await test('旧tabがある間は旧hashedassetを残し、別appのcacheを削除しない', async () => {
    const storage = new MemoryCaches();
    await storage.open('quiz-web:%2Fquiz%2F:static:old');
    await storage.open('another-app-cache');
    const active = await workerHarness('new', storage, true);
    await active.activate();
    assert.ok((await storage.keys()).includes('quiz-web:%2Fquiz%2F:static:old'));
    const idle = await workerHarness('new', storage, false);
    await idle.activate();
    assert.equal((await storage.keys()).includes('quiz-web:%2Fquiz%2F:static:old'), false);
    assert.ok((await storage.keys()).includes('another-app-cache'));
});

await test('データcache件数を上限内へ保つ', async () => {
    const worker = await workerHarness();
    for (let index = 0; index < 34; index += 1) await worker.request(new Request(`https://external.test/data/${index}.json`));
    const dataCache = [...worker.caches.values.entries()].find(([name]) => name.endsWith('data:v1'))?.at(1);
    assert.ok(dataCache instanceof MemoryCache);
    assert.equal((await dataCache.keys()).length, 32);
});

await test('current manifestにない旧hashedassetもdestination空で旧shellから返す', async () => {
    const storage = new MemoryCaches();
    const old = await storage.open('quiz-web:%2Fquiz%2F:static:old');
    const request = new Request('https://example.test/quiz/assets/old-hash.js');
    await old.put(request, new Response('old application code', { headers: { 'Content-Type': 'text/javascript' } }));
    const worker = await workerHarness('new', storage, true);
    assert.equal(await (await worker.request(request)).text(), 'old application code');
});

/** NodeのRequestはnavigateを生成できないため、ここだけFetchEventの読取専用属性を模擬する。 */
function navigation(url: string): Request {
    const request = new Request(url, { headers: { Origin: 'https://example.test' } });
    Object.defineProperties(request, { mode: { value: 'navigate' }, destination: { value: 'document' } });
    return request;
}
const mathPage: StaticFixture = { url: '/quiz/share/data/sample/math-v3.html', type: 'text/html',
    body: '<!doctype html><title>Math</title><meta property="og:title" content="Math quiz"><main>math shell</main>' };
const svgPage: StaticFixture = { url: '/quiz/share/data/sample/svg-v3.html', type: 'text/html',
    body: '<!doctype html><title>SVG</title><meta property="og:title" content="SVG quiz"><main>svg shell</main>' };

await test('既知共有HTMLはscope queryを外したexact登録pathから専用headをofflineで返す', async () => {
    const worker = await workerHarness('v1', new MemoryCaches(), true, [mathPage, svgPage]);
    await worker.install(); worker.setOffline(true);
    const requestedBefore = worker.requests.length;
    const math = await worker.request(navigation('https://example.test/quiz/share/data/sample/math-v3.html?scope=%5B%22math%22%5D'));
    const svg = await worker.request(navigation('https://example.test/quiz/share/data/sample/svg-v3.html?scope=other&entry=https%3A%2F%2Fexternal.test'));
    assert.equal(await math.text(), mathPage.body);
    assert.equal(await svg.text(), svgPage.body);
    assert.equal(worker.requests.length, requestedBefore);
    const restarted = await workerHarness('v1', worker.caches, true, [mathPage, svgPage]);
    restarted.setOffline(true);
    assert.equal(await (await restarted.request(navigation('https://example.test/quiz/share/data/sample/math-v3.html'))).text(), mathPage.body);
});

await test('root/indexと未知app routeのnavigationは従来のindex shellへfallbackする', async () => {
    const worker = await workerHarness('v1', new MemoryCaches(), true, [mathPage]);
    await worker.install(); worker.setOffline(true);
    for (const route of ['', '?scope=math', 'index.html?scope=math', 'lesson/unknown?scope=math', 'share/data/sample/math-v3.html/extra', 'share/data/sample/unregistered.html?scope=math']) {
        const response = await worker.request(navigation(`https://example.test/quiz/${route}`));
        assert.equal(await response.text(), '<!doctype html><title>Quiz</title>', route);
    }
});

await test('共有HTMLのquery無視を通常fetch・JSON/SVG navigation・metadataへ広げない', async () => {
    const worker = await workerHarness('v1', new MemoryCaches(), true, [mathPage,
        { url: '/quiz/data/sample.json', type: 'application/json', body: '{"cached":true}' },
        { url: '/quiz/data/figure.svg', type: 'image/svg+xml', body: '<svg/>' },
        { url: '/quiz/assets/app-hash.js', type: 'text/javascript', body: 'export {}' }]);
    await worker.install();
    for (const file of ['data/sample.json', 'data/figure.svg']) {
        const url = `https://example.test/quiz/${file}?variant=one`;
        const first = await worker.request(navigation(url));
        const body = await first.text();
        const decoded: unknown = JSON.parse(body);
        assert.ok(typeof decoded === 'object' && decoded !== null && 'url' in decoded);
        assert.equal(decoded.url, url);
        worker.setOffline(true);
        assert.equal(await (await worker.request(navigation(url))).text(), body);
        assert.equal((await worker.request(navigation(`https://example.test/quiz/${file}?variant=two`))).type, 'error');
        worker.setOffline(false);
    }
    worker.setOffline(true);
    await assert.rejects(worker.request(navigation('https://example.test/quiz/app-version.json?check=next')), /offline/u);
    assert.equal(worker.requests.at(-1), 'https://example.test/quiz/app-version.json?check=next');
    assert.equal(await (await worker.request(navigation('https://example.test/quiz/assets/app-hash.js'))).text(), 'export {}');
    await assert.rejects(worker.request(navigation('https://example.test/quiz/assets/app-hash.js?revision=other')), /offline/u);
    // 同じHTMLでもnavigateでなければquery違いをcanonical cacheへ丸めない。
    assert.equal((await worker.request(new Request('https://example.test/quiz/share/data/sample/math-v3.html?scope=other'))).type, 'error');
});

await test('他originやscope外のHTML navigationをローカルindex/共有HTMLへ置き換えない', async () => {
    const worker = await workerHarness('v1', new MemoryCaches(), true, [mathPage]);
    await worker.install();
    for (const url of ['https://external.test/quiz/share/data/sample/math-v3.html?scope=math', 'https://example.test/other/share/data/sample/math-v3.html?scope=math']) {
        let intercepted = false;
        worker.events.get('fetch')?.({ request: navigation(url), respondWith() { intercepted = true; } });
        assert.equal(intercepted, false);
    }
});

await test('既知共有HTMLのcurrent cacheが失われてもindexや旧版headで成功を偽装しない', async () => {
    const storage = new MemoryCaches();
    const old = await storage.open('quiz-web:%2Fquiz%2F:static:old');
    await old.put('https://example.test/quiz/share/data/sample/math-v3.html', new Response('<title>Old math</title>'));
    const worker = await workerHarness('new', storage, true, [mathPage]);
    await worker.install();
    const current = await storage.open('quiz-web:%2Fquiz%2F:static:new');
    await current.delete('https://example.test/quiz/share/data/sample/math-v3.html');
    worker.setOffline(true);
    await assert.rejects(worker.request(navigation('https://example.test/quiz/share/data/sample/math-v3.html?scope=math')), /offline/u);
});
