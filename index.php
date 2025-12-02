<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

/**
 * Build base URL of index.php using the configured base path.
 * Example: https://example.com/quiz/index.php
 */
function buildBaseUrl(): string
{
    return QUIZ_BASE_URL . 'index.php';
}

/**
 * HTML escape helper.
 */
function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

/**
 * Load quiz metadata from local quiz JSON file.
 *
 * data/quizzes/{quizId}.json を読み込んで、
 * title / description / URL を返す。
 */
function loadQuizMetadata(?string $quizParam, string $baseUrl): ?array
{
    if ($quizParam === null || !preg_match('/^[A-Za-z0-9_-]+$/', $quizParam)) {
        return null;
    }

    $quizPath = __DIR__ . '/data/quizzes/' . $quizParam . '.json';
    if (!is_file($quizPath)) {
        error_log('Quiz file not found: ' . $quizPath);
        return null;
    }

    $json = @file_get_contents($quizPath);
    if ($json === false) {
        error_log('Quiz file could not be read: ' . $quizPath);
        return null;
    }

    $decoded = json_decode($json, true);
    if (!is_array($decoded)) {
        error_log('Quiz JSON is invalid: ' . $quizPath);
        return null;
    }

    $title       = isset($decoded['title']) ? (string) $decoded['title'] : $quizParam;
    $description = isset($decoded['description']) ? (string) $decoded['description'] : '';

    // URL like: index.php?quiz=amino-acid-quiz-ja-v2
    $url = $baseUrl . '?quiz=' . rawurlencode($quizParam);

    return [
        'title'       => $title,
        'description' => $description,
        'url'         => $url,
    ];
}

/**
 * Normalize and validate entry URL for server-side access.
 *
 * - Accepts relative paths (e.g. "entry.php", "./data/entry.json") and
 *   converts them to absolute URLs on the same host.
 * - Accepts absolute http/https URLs only when the host is the same as
 *   the current host.
 * - Rejects all other schemes or suspicious inputs.
 */
function normalizeEntryUrl(?string $rawEntry, string $baseUrl): ?string
{
    if ($rawEntry === null) {
        return null;
    }

    $rawEntry = trim((string) $rawEntry);
    if ($rawEntry === '' || strlen($rawEntry) > 2048) {
        return null;
    }

    // If the value is a full URL, validate scheme and host.
    $parsed = @parse_url($rawEntry);

    if ($parsed !== false && isset($parsed['scheme'])) {
        $scheme = strtolower($parsed['scheme'] ?? '');
        $host   = strtolower($parsed['host'] ?? '');

        // Only allow http/https
        if (!in_array($scheme, ['http', 'https'], true)) {
            return null;
        }

        // Only allow same host to avoid SSRF
        $currentHost = strtolower($_SERVER['HTTP_HOST'] ?? '');
        if ($currentHost && $host && $host !== $currentHost) {
            return null;
        }

        return $rawEntry;
    }

    // Otherwise treat it as a relative path on this site.
    // Normalize "./" and leading "/" etc.
    $path = ltrim($rawEntry, '/');
    if ($path === '') {
        return null;
    }

    // Very simple path traversal prevention (no ".." segments).
    if (strpos($path, '..') !== false) {
        return null;
    }

    // baseUrl already points to index.php, so strip script name before appending.
    // Example: https://example.com/index.php -> https://example.com/
    $baseWithoutScript = preg_replace('~/[^/]*$~', '/', $baseUrl);

    return $baseWithoutScript . $path;
}

/**
 * Load quiz metadata from an entry JSON (entry.php or entry.json).
 *
 * This function is used only after normalizeEntryUrl() so that
 * $entryUrl is already validated and absolute (same host, http/https).
 *
 * Expected JSON format:
 * {
 *   "version": 2,
 *   "quizzes": [
 *     { "id": "amino-acid-quiz-ja-v2", "title": "...", "description": "..." },
 *     ...
 *   ]
 * }
 */
function loadQuizMetadataFromEntry(
    string $entryUrl,
    ?string $quizId,
    string $baseUrl
): ?array {
    if ($quizId === null || !preg_match('/^[A-Za-z0-9_-]+$/', $quizId)) {
        return null;
    }

    $json = @file_get_contents($entryUrl);
    if ($json === false) {
        error_log('Entry URL could not be read: ' . $entryUrl);
        return null;
    }

    $decoded = json_decode($json, true);
    if (!is_array($decoded)) {
        error_log('Entry JSON is invalid: ' . $entryUrl);
        return null;
    }

    if (!isset($decoded['quizzes']) || !is_array($decoded['quizzes'])) {
        return null;
    }

    $target = null;
    foreach ($decoded['quizzes'] as $quiz) {
        if (!is_array($quiz)) {
            continue;
        }
        if (($quiz['id'] ?? null) === $quizId) {
            $target = $quiz;
            break;
        }
    }

    if ($target === null) {
        // quiz not found in this entry
        return null;
    }

    $title       = isset($target['title']) ? (string) $target['title'] : $quizId;
    $description = isset($target['description']) ? (string) $target['description'] : '';

    // Canonical URL: index.php?entry=...&quiz=...
    // Use original entry URL in query string (encoded).
    $query = http_build_query([
        'entry' => $entryUrl,
        'quiz'  => $quizId,
    ], '', '&', PHP_QUERY_RFC3986);

    return [
        'title'       => $title,
        'description' => $description,
        'url'         => $baseUrl . '?' . $query,
    ];
}

// ------------------------------------------------------------
// OGP parameter resolution
// ------------------------------------------------------------

$defaultTitle       = '4-choice Quiz';
$defaultDescription = 'Browse and play 4-choice quizzes.';
$baseUrl            = buildBaseUrl();

// Raw query params
$entryParamRaw = $_GET['entry'] ?? null;
$quizParam     = $_GET['quiz']  ?? null;
$modeParamRaw  = $_GET['mode']  ?? null;

// Normalize mode (only allow [A-Za-z0-9_-])
$modeParam = null;
if ($modeParamRaw !== null && preg_match('/^[A-Za-z0-9_-]+$/', (string) $modeParamRaw)) {
    $modeParam = (string) $modeParamRaw;
}

// Normalize & validate entry URL for server-side usage (same host + http/https)
$entryUrlForServer = normalizeEntryUrl($entryParamRaw, $baseUrl);

// Determine quiz metadata (entry first, then local quiz JSON as fallback)
$quizMetadata = null;

if ($entryUrlForServer !== null) {
    $quizMetadata = loadQuizMetadataFromEntry($entryUrlForServer, $quizParam, $baseUrl);
}

if ($quizMetadata === null) {
    $quizMetadata = loadQuizMetadata($quizParam, $baseUrl);
}

// Base title / description
$baseTitle       = $quizMetadata['title']       ?? $defaultTitle;
$pageDescription = $quizMetadata['description'] ?? $defaultDescription;

// Mode suffix for title
$modeLabel = $modeParam; // For now, just use raw mode id like "default" or "rgroup_focus"
if ($modeLabel !== null) {
    $pageTitle = sprintf('%s [mode: %s]', $baseTitle, $modeLabel);
} else {
    $pageTitle = $baseTitle;
}

// og:url / canonical
$ogUrl = $quizMetadata['url'] ?? $baseUrl;

// Append mode to URL if present (entry/local both OK)
if ($modeParam !== null) {
    $ogUrl .= (strpos($ogUrl, '?') === false ? '?' : '&')
        . 'mode=' . rawurlencode($modeParam);
}
?>
<!DOCTYPE html>
<html lang="ja" data-theme="light">
<head>
    <meta charset="UTF-8" />
    <title><?php echo h($pageTitle); ?></title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="manifest" href="<?php echo h(quiz_versioned_asset_url('manifest.php')); ?>" />
    <meta name="theme-color" content="#020617" />
    <link
        rel="icon"
        type="image/svg+xml"
        href="<?php echo h(quiz_versioned_asset_url('icons/icon-192.svg')); ?>"
    />
    <link
        rel="apple-touch-icon"
        sizes="180x180"
        href="<?php echo h(quiz_versioned_asset_url('icons/icon-192.svg')); ?>"
    />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="4-choice Quiz" />

    <!-- General description -->
    <meta name="description" content="<?php echo h($pageDescription); ?>" />

    <!-- Open Graph Protocol -->
    <meta property="og:title" content="<?php echo h($pageTitle); ?>" />
    <meta property="og:description" content="<?php echo h($pageDescription); ?>" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="<?php echo h($ogUrl); ?>" />
    <meta property="og:site_name" content="<?php echo h($defaultTitle); ?>" />

    <!-- Canonical URL -->
    <link rel="canonical" href="<?php echo h($ogUrl); ?>" />

    <!-- Twitter Card (X) basic settings -->
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="<?php echo h($pageTitle); ?>" />
    <meta name="twitter:description" content="<?php echo h($pageDescription); ?>" />
    <meta name="twitter:url" content="<?php echo h($ogUrl); ?>" />
    <meta name="twitter:site" content="@bem130" />
    <meta name="twitter:creator" content="@bem130" />

    <!-- Tailwind CDN -->
    <script src="https://cdn.tailwindcss.com"></script>

    <!-- Tailwind config: darkMode を class に -->
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        slate: {
                            850: '#1e293b'
                        }
                    }
                }
            }
        };
    </script>

    <script>
        window.APP_VERSION = <?php echo json_encode(APP_VERSION, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP); ?>;
        window.APP_SERVICE_WORKER_URL = <?php echo json_encode(quiz_versioned_asset_url('sw.php'), JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP); ?>;
    </script>

    <style>
        body.app-loading #app {
            opacity: 0;
        }
    </style>

    <!-- KaTeX CSS & JS (with mhchem for \ce) -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.css" crossorigin="anonymous">
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.js" crossorigin="anonymous"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/contrib/mhchem.min.js" crossorigin="anonymous"></script>

    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/kekule/dist/themes/default/kekule.css">

    <link rel="stylesheet" href="<?php echo h(quiz_versioned_asset_url('css/app.css')); ?>" />
    <link rel="stylesheet" href="<?php echo h(quiz_versioned_asset_url('css/theme.css')); ?>" />
</head>
<body class="app-loading transition-colors duration-300">

    <!-- 画面いっぱい 2 分割レイアウト -->
    <div id="app" class="layout-container">
        <!-- 左: メインエリア（メニュー or クイズ） -->
        <main class="main-panel app-surface-main flex flex-col transition-colors duration-300">
            <!-- 共通ヘッダ -->
            <header class="px-[0.5rem] py-[0.8rem] border-b app-border-subtle app-surface-header flex items-center justify-between transition-colors duration-300">
                <div>
                    <h1 id="app-title" class="text-lg font-semibold app-text-strong">4-choice Quiz</h1>
                    <p id="app-description" class="text-xs app-text-muted mt-1">
                        Loading quiz definition...
                    </p>
                </div>
            </header>

            <!-- メイン: メニュー画面 -->
            <section id="main-menu" class="flex-1 overflow-y-auto p-6 space-y-6 text-sm">
                <section class="space-y-3">
                    <div class="flex items-center justify-between flex-wrap gap-3">
                        <h2 class="text-base font-semibold app-text-strong">
                            Number of questions
                        </h2>
                        <span
                            id="question-count-label"
                            class="text-xs font-semibold app-text-main"
                        >
                            10 問
                        </span>
                    </div>
                    <input
                        id="question-count-slider"
                        type="range"
                        min="5"
                        max="100"
                        step="5"
                        value="10"
                        class="w-full app-range-accent"
                    />
                </section>

                <!-- Draft summary (Draft のときだけ表示) -->
                <section
                    id="draft-summary-panel"
                    class="mt-4 rounded-xl border app-border-subtle app-surface-muted px-3 py-2 text-xs hidden"
                >
                    <div class="flex items-center justify-between mb-1">
                        <h3 class="font-semibold text-[11px] app-text-muted">
                            Draft summary (read-only)
                        </h3>
                        <span id="draft-summary-updated" class="text-[10px] app-text-muted"></span>
                    </div>
                    <div id="draft-summary-content" class="space-y-1 text-[11px] app-text-muted"></div>
                </section>

                <section class="space-y-3">
                    <h2 class="text-base font-semibold app-text-strong">Mode</h2>
                    <div id="mode-message" class="text-xs app-text-danger hidden"></div>
                    <div id="mode-list" class="space-y-2">
                        <!-- JS でボタンを生成 -->
                    </div>
                    <h2 class="hidden text-base font-semibold app-text-strong">Pattern</h2>
                    <div id="pattern-mode-list" class="hidden space-y-2">
                        <!-- Local Draft のときのみ -->
                    </div>
                </section>

                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
                    <p class="text-xs app-text-muted">
                        モードを選択して「Start Quiz」で開始します。
                    </p>
                    <button
                        id="start-button"
                        class="interactive-button button-accent px-5 py-2 text-sm font-semibold rounded-xl transition-colors"
                    >
                        Start Quiz
                    </button>
                </div>
            </section>

            <!-- メイン: クイズ画面 -->
            <section id="main-quiz" class="hidden flex-1 overflow-y-auto flex flex-col">

                <div id="question-view" class="flex-1 overflow-y-auto p-[0.9rem] flex flex-col">
                    <!-- 内側ラッパーを flex-1 + flex-col にする -->
                    <div class="max-w-4xl w-full mx-auto flex-1 flex flex-col space-y-4">
                        <div id="question-text" class="text-base leading-snug space-y-2">
                            <!-- 問題文 -->
                        </div>

                        <!-- 選択肢領域：フル高さの 2x2 グリッド -->
                        <div
                            id="options-container"
                            class="flex-1"
                        ></div>
                    </div>
                </div>

                <!-- Result（クイズ終了後にメインに表示） -->
                <div
                    id="result-screen"
                    class="hidden flex-1 overflow-y-auto p-6 app-surface-muted transition-colors duration-300"
                >
                    <div class="max-w-4xl mx-auto w-full space-y-6">
                        <div>
                            <p class="text-xs uppercase tracking-wide app-text-muted">Result</p>
                            <h2 class="text-2xl font-semibold app-text-strong">クイズ結果</h2>
                            <p id="result-score" class="text-sm app-text-main mt-1">Score: 0 / 0</p>
                        </div>
                        <div class="grid gap-4 sm:grid-cols-3">
                            <div class="p-4 rounded-xl app-card border app-border-subtle">
                                <div class="text-xs app-text-muted">Total</div>
                                <div class="text-2xl font-bold app-text-strong" id="result-total">0</div>
                            </div>
                            <div class="p-4 rounded-xl app-card border app-border-subtle">
                                <div class="text-xs app-text-muted">Correct</div>
                                <div class="text-2xl font-bold app-text-success" id="result-correct">0</div>
                            </div>
                            <div class="p-4 rounded-xl app-card border app-border-subtle">
                                <div class="text-xs app-text-muted">Accuracy</div>
                                <div class="text-2xl font-bold app-text-strong" id="result-accuracy">0%</div>
                            </div>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <button
                                id="retry-button"
                                class="interactive-button px-4 py-2 rounded-xl border app-border-subtle text-sm app-text-main transition-colors"
                            >
                                Retry
                            </button>
                            <button
                                id="retry-mistakes-button"
                                class="interactive-button px-4 py-2 rounded-xl border app-border-subtle text-sm app-text-main transition-colors"
                            >
                                Retry Mistakes
                            </button>
                            <button
                                id="copy-result-button"
                                class="interactive-button px-4 py-2 rounded-xl text-sm font-semibold border app-border-subtle app-text-main transition-colors"
                            >
                                Copy Result
                            </button>
                            <button
                                id="back-to-menu-button"
                                class="interactive-button px-4 py-2 rounded-xl text-sm border app-border-subtle app-text-main transition-colors"
                            >
                                Menu
                            </button>
                        </div>
                        <div
                            id="result-pwa-hint"
                            class="mt-6 text-xs app-text-muted border border-dashed app-border-subtle rounded-xl px-4 py-3 app-callout hidden"
                        >
                            <p class="font-medium">
                                Did you enjoy this quiz?
                            </p>
                            <p class="mt-1">
                                You can add this app to your home screen as a PWA for quicker access.
                            </p>
                            <div class="pt-2">
                                <button
                                    id="result-pwa-install-button"
                                    type="button"
                                    class="interactive-button inline-flex items-center px-3 py-1.5 rounded-lg border app-border-strong text-[11px] font-semibold app-text-main app-surface-overlay disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Install this app
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Bottom bar: interrupt / progress / score / timer / next -->
                <footer class="px-[0.5rem] py-[0.3rem] border-t app-border-subtle flex items-center gap-4 text-xs transition-colors duration-300">
                    <!-- Interrupt button -->
                    <button
                        id="interrupt-button"
                        type="button"
                        class="interactive-button button-ghost button-danger px-3 py-2 rounded-xl
                            app-border-subtle
                            app-text-main
                            disabled:opacity-40
                            transition-colors
                            hidden"
                    >
                        Retire
                    </button>

                    <!-- Center status: Progress + Score + Timer -->
                    <div
                        id="quiz-header-score"
                        class="flex-1 flex items-center justify-center gap-6 text-[0.7rem] sm:text-xs hidden"
                    >
                        <!-- Progress -->
                        <div class="flex items-baseline gap-1">
                            <span class="uppercase tracking-wide app-text-muted">
                                Progress
                            </span>
                            <span class="text-sm sm:text-base font-semibold app-text-strong">
                                <span id="current-q-num">1</span>
                                <span class="text-[0.7rem] app-text-muted mx-1">/</span>
                                <span id="total-q-num" class="app-text-muted">10</span>
                            </span>
                        </div>

                        <!-- Score -->
                        <div class="flex items-baseline gap-1">
                            <span class="uppercase tracking-wide app-text-muted">
                                Score
                            </span>
                            <span class="text-sm sm:text-base font-semibold app-text-success" id="current-score">
                                0
                            </span>
                        </div>

                        <!-- Timer -->
                        <div class="flex items-baseline gap-1">
                            <span class="uppercase tracking-wide app-text-muted">
                                Time
                            </span>
                            <span class="text-sm sm:text-base font-mono app-text-strong" id="quiz-timer">
                                00:00
                            </span>
                        </div>
                    </div>

                    <!-- Next button -->
                    <button
                        id="next-button"
                        class="interactive-button button-ghost px-4 py-2 text-xs rounded-xl
                            app-border-subtle
                            app-text-main
                            disabled:opacity-40
                            transition-colors"
                        disabled
                    >
                        Next
                    </button>
                </footer>
            </section>
        </main>

        <!-- 右: サブエリア（共通 Settings + メニュー/クイズで切り替え） -->
        <aside class="side-panel app-surface-side border-l app-border-subtle text-xs transition-colors duration-300">
            <!-- ① 共通: Settings（コンパクト） -->
            <section id="side-settings" class="border-b app-border-subtle app-surface-muted transition-colors duration-300">
                <div class="px-3 py-2 flex items-center justify-between gap-3">
                    <!-- Text size -->
                    <div class="inline-flex rounded-full border app-border-subtle app-surface-card overflow-hidden">
                        <!-- xxs -->
                        <button
                            id="size-xxs-menu"
                            class="px-1.5 py-0.5 text-[0.6rem] font-bold
                                app-text-muted
                                app-hover-muted"
                        >
                            A
                        </button>

                        <!-- xs -->
                        <button
                            id="size-xs-menu"
                            class="px-1.5 py-0.5 text-[0.65rem] font-bold
                                app-text-muted
                                app-hover-muted"
                        >
                            A
                        </button>

                        <!-- s (existing small) -->
                        <button
                            id="size-small-menu"
                            class="px-1.5 py-0.5 text-[0.7rem] font-bold
                                app-text-muted
                                app-hover-muted"
                        >
                            A
                        </button>

                        <!-- m (existing medium) -->
                        <button
                            id="size-medium-menu"
                            class="px-1.5 py-0.5 text-[0.8rem] font-bold
                                app-text-main
                                app-hover-muted"
                        >
                            A
                        </button>

                        <!-- l (existing large) -->
                        <button
                            id="size-large-menu"
                            class="px-1.5 py-0.5 text-[0.9rem] font-bold
                                app-text-strong
                                app-hover-muted"
                        >
                            A
                        </button>

                        <!-- xl -->
                        <button
                            id="size-xl-menu"
                            class="px-1.5 py-0.5 text-[1.0rem] font-bold
                                app-text-strong
                                app-hover-muted"
                        >
                            A
                        </button>

                        <!-- xxl -->
                        <button
                            id="size-xxl-menu"
                            class="px-1.5 py-0.5 text-[1.1rem] font-bold
                                app-text-strong
                                app-hover-muted"
                        >
                            A
                        </button>
                    </div>

                    <!-- Theme -->
                    <div class="flex items-center gap-2">
                        <span class="text-[0.7rem] app-text-muted uppercase tracking-wide">
                            Theme
                        </span>
                        <button
                            id="theme-toggle-menu"
                            type="button"
                            class="interactive-button button-ghost px-3 py-1 rounded-full border app-border-subtle text-[0.8rem] app-text-main transition-colors"
                        >
                            Dark / Light
                        </button>
                    </div>

                    <button
                        id="fullscreen-toggle-menu"
                        type="button"
                        class="interactive-button button-ghost px-3 py-1 rounded-full border app-border-subtle
                            text-[0.8rem]
                            app-text-main
                            transition-colors"
                    >
                        Full
                    </button>
                </div>
            </section>

            <!-- ② メニュー専用: Number of questions -->
            <section id="side-menu" class="flex-1 min-h-0 flex flex-col">
                <div class="px-4 py-3 border-b app-border-subtle app-panel-heading transition-colors duration-300">
                    <h2 class="font-semibold app-text-strong text-sm">Entries &amp; Quizzes</h2>
                </div>
                <div class="flex-1 overflow-y-auto p-4 space-y-6">
                    <section class="space-y-2">
                        <div class="flex items-center justify-between">
                            <h3 class="text-sm font-semibold app-text-strong">Available Entries</h3>
                        </div>
                        <div class="space-y-2">
                            <div class="flex gap-2">
                                <input
                                    id="entry-url-input"
                                    type="url"
                                    placeholder="https://example.com/quiz/entry.php"
                                    class="flex-1 app-input rounded-xl px-3 py-2 text-xs app-text-strong"
                                />
                            <button
                                id="entry-add-button"
                                type="button"
                                class="interactive-button px-3 py-2 rounded-xl text-xs font-semibold border app-border-subtle app-text-main transition-colors"
                            >
                                Add
                            </button>
                            </div>
                            <p class="text-[11px] app-text-muted">Entries are saved in this browser.</p>
                        </div>
                        <div id="entry-list" class="space-y-2"></div>
                    </section>

                    <section class="space-y-2">
                        <h3 class="text-sm font-semibold app-text-strong">Available Quizzes</h3>
                        <div id="quiz-list" class="space-y-2">
                            <!-- JS で埋め込み -->
                        </div>
                    </section>

                    <section class="space-y-2">
                        <h3 class="text-sm font-semibold app-text-strong">Quiz options</h3>
                        <label for="question-count" class="block text-xs app-text-muted">
                            Number of questions
                        </label>
                        <input
                            id="question-count"
                            type="number"
                            min="5"
                            max="100"
                            step="5"
                            value="10"
                            class="w-full app-input rounded-xl px-3 py-2 text-xs app-text-strong"
                        />
                        <p class="text-xs app-text-muted">
                            You can change the number of questions between 5 and 100.
                        </p>
                    </section>
                </div>
            </section>

            <!-- ③ クイズ専用: Mistakes / Tips / Result list -->
            <section id="side-quiz" class="hidden flex-1 min-h-0 flex flex-col">

                <!-- コンテンツ全体: 上が Mistakes/Result（スクロール）、下が Tips（固定） -->
                <div class="flex-1 min-h-0 px-4 py-3 flex flex-col gap-3">
                    <!-- 上: Mistakes / Result Questions のスクロール領域 -->
                    <div class="flex-1 min-h-0 overflow-y-auto space-y-3">
                        <!-- Mistakes パネル -->
                        <section id="mistakes-panel" class="space-y-2">
                            <div class="flex items-center justify-between">
                                <span class="text-xs uppercase tracking-wide app-text-muted">
                                    Mistakes
                                </span>
                                <span
                                    id="mistake-count"
                                    class="hidden app-pill app-pill-danger app-pill-compact"
                                >
                                    0
                                </span>
                            </div>
                            <div
                                id="review-empty"
                                class="h-full flex flex-col items-center justify-center app-text-muted text-xs"
                            >
                                No mistakes yet.
                            </div>
                            <ul id="review-list" class="space-y-2 hidden"></ul>
                        </section>

                        <!-- Result Questions パネル（結果画面のときだけ表示） -->
                        <section id="result-list-panel" class="space-y-2 hidden">
                            <div class="text-xs uppercase tracking-wide app-text-muted">
                                Result Questions
                            </div>
                            <ul id="result-list" class="space-y-2"></ul>
                        </section>
                    </div>

                    <!-- 下: Tips（固定表示・スクロールさせない） -->
                    <section id="tips-panel" class="space-y-2 shrink-0">
                        <div class="text-xs uppercase tracking-wide app-text-muted">
                            Tips
                        </div>
                        <div id="tip-container" class="space-y-2 text-xs"></div>
                    </section>
                </div>
            </section>
        </aside>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/kekule/dist/kekule.min.js"></script>
    <script src="https://unpkg.com/@rdkit/rdkit/dist/RDKit_minimal.js"></script>
    <script type="module" src="js/main.js"></script>
</body>
</html>