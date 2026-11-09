export {};
declare const self: ServiceWorkerGlobalScope;
declare const __APP_VERSION__: string;
declare const __PRECACHE__: readonly Readonly<{ url: string; sha256: string; size: number }>[];

const scope = new URL(self.registration.scope);
const prefix = `quiz-web:${encodeURIComponent(scope.pathname)}:`;
const shellPrefix = `${prefix}static:`;
const shellName = `${shellPrefix}${__APP_VERSION__}`;
const dataName = `${prefix}data:v1`;
const indexUrl = new URL('index.html', scope).href;
const versionUrl = new URL('app-version.json', scope).href;
const knownAssets = new Set(__PRECACHE__.map(asset => new URL(asset.url, scope).href));
const MAX_DATA_ENTRIES = 32;
const MAX_DATA_BYTES = 4 * 1024 * 1024;

function digestHex(buffer: ArrayBuffer): Promise<string> {
    return crypto.subtle.digest('SHA-256', buffer).then(value => Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join(''));
}
/** buildのhashだけでは、正しい本文を誤MIMEで返す配信設定を検出できない。 */
function validStaticMime(url: string, contentType: string): boolean {
    const mime = contentType.split(';').at(0)?.trim().toLowerCase() ?? '';
    const pathname = new URL(url, scope).pathname.toLowerCase();
    const extension = pathname.slice(pathname.lastIndexOf('.'));
    switch (extension) {
        case '.js': return mime === 'text/javascript' || mime === 'application/javascript';
        case '.css': return mime === 'text/css';
        case '.html': return mime === 'text/html';
        case '.json': return mime === 'application/json';
        case '.webmanifest': return mime === 'application/manifest+json' || mime === 'application/json';
        case '.svg': return mime === 'image/svg+xml';
        case '.wasm': return mime === 'application/wasm';
        case '.woff2': return mime === 'font/woff2';
        case '.woff': return mime === 'font/woff';
        case '.ttf': return mime === 'font/ttf';
        default: return false;
    }
}
async function install(): Promise<void> {
    const cache = await caches.open(shellName);
    try {
        for (const asset of __PRECACHE__) {
            const request = new Request(new URL(asset.url, scope), { cache: 'reload', credentials: 'same-origin' });
            const response = await fetch(request);
            if (!response.ok || response.type === 'opaque') throw new Error(`Precache HTTP error: ${asset.url}`);
            if (!validStaticMime(asset.url, response.headers.get('Content-Type') ?? '')) throw new Error(`Precache MIME error: ${asset.url}`);
            const body = await response.clone().arrayBuffer();
            if (body.byteLength !== asset.size || await digestHex(body) !== asset.sha256) throw new Error(`Precache integrity error: ${asset.url}`);
            await cache.put(request, response);
        }
    } catch (error) {
        await caches.delete(shellName);
        throw error;
    }
    // 更新はwaitingに留め、利用者が保存中・学習中でない時だけUIから適用する。
}
async function activate(): Promise<void> {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const active = clients.some(client => client.url.startsWith(scope.href));
    if (!active) {
        for (const name of await caches.keys()) if (name.startsWith(shellPrefix) && name !== shellName) await caches.delete(name);
    }
    await self.clients.claim();
}
async function findStatic(request: Request): Promise<Response | undefined> {
    // 配信サーバーのVary: Originによりmodule用Originヘッダーで欠落扱いにしない。
    // ここでは同一scopeのhash検証済み静的資産だけをURLで照合する。
    const current = await (await caches.open(shellName)).match(request, { ignoreVary: true });
    if (current) return current;
    for (const name of await caches.keys()) {
        if (name.startsWith(shellPrefix) && name !== shellName) {
            const response = await (await caches.open(name)).match(request, { ignoreVary: true });
            if (response) return response;
        }
    }
    return undefined;
}
async function cacheData(request: Request, response: Response): Promise<void> {
    const directives = response.headers.get('Cache-Control') ?? '';
    if (!response.ok || response.type === 'opaque' || /(?:no-store|private)/iu.test(directives)) return;
    if (!/(?:application\/(?:[^;]+\+)?json|image\/svg\+xml)/iu.test(response.headers.get('Content-Type') ?? '')) return;
    const body = await response.clone().arrayBuffer();
    if (body.byteLength > MAX_DATA_BYTES) return;
    const cache = await caches.open(dataName);
    await cache.delete(request); await cache.put(request, response);
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_DATA_ENTRIES))) await cache.delete(key);
}
async function networkFirst(request: Request): Promise<Response> {
    const cache = await caches.open(dataName);
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); }, 8000);
    const abort = (): void => { controller.abort(); };
    request.signal.addEventListener('abort', abort, { once: true });
    try {
        const response = await fetch(request, { cache: 'no-store', signal: controller.signal });
        if (response.status >= 500) {
            const fallback = await cache.match(request) ?? await findStatic(request);
            if (fallback) return fallback;
        }
        if (response.status === 404 || response.status === 410) await cache.delete(request);
        try { await cacheData(request, response.clone()); }
        catch {
            // quota等の保存失敗でも、正常なネットワーク応答を古い値へ差し替えない。
        }
        return response;
    } catch {
        return await cache.match(request) ?? await findStatic(request) ?? Response.error();
    } finally {
        clearTimeout(timeout); request.signal.removeEventListener('abort', abort);
    }
}
async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin === scope.origin && url.pathname === new URL(versionUrl).pathname) return fetch(request, { cache: 'no-store' });
    if (request.mode === 'navigate') return await (await caches.open(shellName)).match(indexUrl) ?? fetch(request);
    const documentData = /\.(?:json|svg)$/iu.test(url.pathname);
    if (!documentData) {
        const retained = await findStatic(request);
        if (retained) return retained;
    }
    const data = documentData || (request.destination === '' && !knownAssets.has(url.href));
    if (data) return networkFirst(request);
    return await findStatic(request) ?? fetch(request);
}
self.addEventListener('install', event => { event.waitUntil(install()); });
self.addEventListener('activate', event => { event.waitUntil(activate()); });
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || (url.protocol !== 'https:' && url.protocol !== 'http:')) return;
    const local = url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
    if (local || request.destination === '' || /\.(?:json|svg)$/iu.test(url.pathname)) {
        event.respondWith(route(request).catch(() => fetch(request, { cache: 'no-store' })));
    }
});
self.addEventListener('message', event => {
    const data: unknown = event.data;
    if (typeof data !== 'object' || data === null || !('type' in data)) return;
    if (data.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
