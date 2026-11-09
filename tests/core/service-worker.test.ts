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
function isListener(value: unknown): value is Listener { return typeof value === 'function'; }
async function workerHarness(version = 'v1', storage = new MemoryCaches(), activeClients = true): Promise<Readonly<{
    caches: MemoryCaches; events: Map<string, Listener>; requests: string[];
    setOffline(value: boolean): void; setCorrupt(value: boolean): void;
    skipped(): boolean; request(request: Request): Promise<Response>; install(): Promise<void>; activate(): Promise<void>;
}>> {
    const body = '<!doctype html><title>Quiz</title>';
    const events = new Map<string, Listener>();
    const requests: string[] = [];
    let offline = false; let corrupt = false; let skipped = false;
    const source = await readFile(new URL('../../src/service-worker.ts', import.meta.url), 'utf8');
    const code = stripTypeScriptTypes(source).replace(/export\s*\{\s*\};?/u, '');
    const context = vm.createContext({
        URL, Request, Response, AbortController, setTimeout, clearTimeout, crypto: webcrypto,
        __APP_VERSION__: version,
        __PRECACHE__: [{ url: '/quiz/index.html', size: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') }],
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
            if (url.includes('index.html')) return Promise.resolve(new Response(corrupt ? '<h1>not found</h1>' : body, { headers: { 'Content-Type': 'text/html', Vary: 'Origin' } }));
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
