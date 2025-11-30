const CACHE_NAME = 'quiz-app-shell-v1';
const APP_SHELL = [
    '/quiz/',
    '/quiz/index.html',
    '/quiz/index.php',
    '/quiz/js/main.js',
    '/quiz/js/quiz-engine.js',
    '/quiz/js/menu-renderer.js',
    '/quiz/js/dom-refs.js',
    '/quiz/js/config.js',
    '/quiz/css/app.css',
    '/quiz/manifest.webmanifest',
    '/quiz/icons/icon-192.svg',
    '/quiz/icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        )
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) {
                return cached;
            }
            return fetch(event.request).catch(async () => {
                const fallback = await caches.match('/quiz/');
                if (fallback) {
                    return fallback;
                }
                return Response.error();
            });
        })
    );
});
