<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

header('Content-Type: application/javascript; charset=utf-8');

$basePath = parse_url(QUIZ_BASE_URL, PHP_URL_PATH) ?: '/';
$basePath = rtrim($basePath, '/') . '/';

$appShell = [
    QUIZ_BASE_URL,
    quiz_versioned_asset_url('index.php'),
    quiz_versioned_asset_url('index.html'),
    quiz_versioned_asset_url('js/main.js'),
    quiz_versioned_asset_url('js/quiz-engine.js'),
    quiz_versioned_asset_url('js/menu-renderer.js'),
    quiz_versioned_asset_url('js/dom-refs.js'),
    quiz_versioned_asset_url('js/config.js'),
    quiz_versioned_asset_url('js/theme.js'),
    quiz_versioned_asset_url('js/quiz-model.js'),
    quiz_versioned_asset_url('js/entry-model.js'),
    quiz_versioned_asset_url('js/quiz-renderer.js'),
    quiz_versioned_asset_url('js/answer-state.js'),
    quiz_versioned_asset_url('js/question-clone.js'),
    quiz_versioned_asset_url('js/capacity-manager.js'),
    quiz_versioned_asset_url('js/dataset-utils.js'),
    quiz_versioned_asset_url('js/filters.js'),
    quiz_versioned_asset_url('js/quiz-types.js'),
    quiz_versioned_asset_url('js/chem-renderer.js'),
    quiz_versioned_asset_url('css/app.css'),
    quiz_versioned_asset_url('css/theme.css'),
    quiz_versioned_asset_url('manifest.php'),
    quiz_versioned_asset_url('manifest.webmanifest'),
    quiz_versioned_asset_url('icons/icon-192.svg'),
    quiz_versioned_asset_url('icons/icon-512.svg'),
];
?>
const APP_VERSION = '<?php echo addslashes(APP_VERSION); ?>';
const CACHE_PREFIX = 'quiz-app-shell-';
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}`;
const APP_SHELL = <?php echo json_encode($appShell, JSON_UNESCAPED_SLASHES); ?>;
const FALLBACK_URL = '<?php echo QUIZ_BASE_URL; ?>';
const BASE_PATH = '<?php echo $basePath; ?>';

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
                        .map((key) => caches.delete(key))
                )
            )
            .then(() => self.clients.claim())
    );
});

let QUIZ_DATA_URLS = new Set();

self.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'UPDATE_QUIZ_DATA_URLS' && Array.isArray(data.urls)) {
        QUIZ_DATA_URLS = new Set(data.urls);
        console.log('[sw] Updated QUIZ_DATA_URLS:', QUIZ_DATA_URLS.size);
    }

    if (data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

function isQuizDataRequest(request) {
    const url = new URL(request.url);
    const full = url.href; // full URL
    const path = url.pathname;

    // Check against the Set of known quiz data URLs
    // We check both full URL and pathname to be safe, though full URL is preferred for exact matching
    return QUIZ_DATA_URLS.has(full) || QUIZ_DATA_URLS.has(path);
}

/**
 * Network First strategy with Cache fallback.
 * Used for quiz data (entry.php, .json) to ensure freshness.
 */
function networkFirstWithCache(request) {
    return fetch(request)
        .then((response) => {
            // Check if we received a valid response
            if (!response || response.status !== 200 || response.type !== 'basic') {
                return response;
            }

            // Clone the response to store in cache
            const responseToCache = response.clone();

            caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseToCache);
            });

            return response;
        })
        .catch(() => {
            // Network failed, try cache
            return caches.match(request);
        });
}

/**
 * Cache First strategy with Network fallback (and App Shell fallback).
 * Used for static assets and App Shell.
 */
function cacheFirstWithFallback(request) {
    return caches.match(request).then((cached) => {
        if (cached) {
            return cached;
        }

        return caches.match(request, { ignoreSearch: true }).then((matched) => {
            if (matched) {
                return matched;
            }

            return fetch(request).catch(async () => {
                if (request.mode === 'navigate' || request.destination === 'document') {
                    const fallback = await caches.match(FALLBACK_URL);
                    if (fallback) {
                        return fallback;
                    }
                }
                return Response.error();
            });
        });
    });
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE_PATH)) {
        return;
    }

    if (isQuizDataRequest(request)) {
        event.respondWith(networkFirstWithCache(request));
    } else {
        event.respondWith(cacheFirstWithFallback(request));
    }
});
