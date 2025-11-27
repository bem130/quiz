<?php
declare(strict_types=1);

function buildBaseUrl(): string
{
    $https = $_SERVER['HTTPS'] ?? '';
    $isHttps = ($https && strtolower((string) $https) !== 'off')
        || (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string) $_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https');
    $scheme = $isHttps ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $scriptName = $_SERVER['SCRIPT_NAME'] ?? '';
    $directory = rtrim(str_replace('\\', '/', dirname($scriptName)), '/');

    return rtrim($scheme . '://' . $host . ($directory === '/' ? '' : $directory), '/') . '/';
}

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

    $json = file_get_contents($quizPath);
    if ($json === false) {
        error_log('Quiz file could not be read: ' . $quizPath);
        return null;
    }

    $decoded = json_decode($json, true);
    if (!is_array($decoded)) {
        error_log('Quiz file contains invalid JSON: ' . $quizPath);
        return null;
    }

    return [
        'title' => $decoded['title'] ?? $quizParam,
        'description' => $decoded['description'] ?? '',
        'url' => $baseUrl . '?quiz=' . rawurlencode($quizParam),
    ];
}

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

$defaultTitle = '4-choice Quiz';
$defaultDescription = 'Browse and play 4-choice quizzes.';
$baseUrl = buildBaseUrl();
$quizParam = $_GET['quiz'] ?? null;
$quizMetadata = loadQuizMetadata($quizParam, $baseUrl);

$pageTitle = $quizMetadata['title'] ?? $defaultTitle;
$pageDescription = $quizMetadata['description'] ?? $defaultDescription;
$ogUrl = $quizMetadata['url'] ?? $baseUrl;
?>
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8" />
    <title><?php echo h($pageTitle); ?></title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <!-- General OGP tags -->
    <meta name="description" content="<?php echo h($pageDescription); ?>" />
    <meta property="og:title" content="<?php echo h($pageTitle); ?>" />
    <meta property="og:description" content="<?php echo h($pageDescription); ?>" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="<?php echo h($ogUrl); ?>" />
    <meta property="og:site_name" content="<?php echo h($defaultTitle); ?>" />
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

    <!-- KaTeX CSS & JS (with mhchem for \ce) -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.css" crossorigin="anonymous">
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.js" crossorigin="anonymous"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/contrib/mhchem.min.js" crossorigin="anonymous"></script>

    <link rel="stylesheet" href="css/app.css" />
</head>
<body class="bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 transition-colors duration-300">

    <!-- 画面いっぱい 2 分割レイアウト -->
    <div id="app" class="layout-container">
        <!-- 左: メインエリア（メニュー or クイズ） -->
        <main class="main-panel bg-white dark:bg-slate-850 flex flex-col transition-colors duration-300">
            <!-- 共通ヘッダ -->
            <header class="px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-850/90 flex items-center justify-between transition-colors duration-300">
                <div>
                    <h1 id="app-title" class="text-lg font-semibold">4-choice Quiz</h1>
                    <p id="app-description" class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Loading quiz definition...
                    </p>
                </div>
                <!-- クイズ中に右上にスコア表示 -->
                <div id="quiz-header-score" class="hidden text-right text-xs">
                    <div class="uppercase text-[0.7rem] tracking-wide text-slate-500 dark:text-slate-400">Score</div>
                    <div class="text-lg font-semibold text-emerald-500" id="current-score">0</div>
                </div>
            </header>

            <!-- メイン: メニュー画面 -->
            <section id="main-menu" class="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
                <!-- Available Quizzes -->
                <section>
                    <h2 class="text-sm font-semibold mb-2 text-slate-800 dark:text-slate-100">Available Quizzes</h2>
                    <div id="quiz-list" class="space-y-2">
                        <!-- JS で埋め込み -->
                    </div>
                </section>

                <!-- Mode（ボタンリスト） -->
                <section>
                    <h2 class="text-sm font-semibold mb-2 text-slate-800 dark:text-slate-100">Mode</h2>
                    <div id="mode-list" class="space-y-2">
                        <!-- JS でボタンを生成 -->
                    </div>
                </section>

                <div class="pt-2 flex justify-end">
                    <button
                        id="start-button"
                        class="px-4 py-2 text-sm font-semibold rounded-xl
                               bg-emerald-500 text-slate-950 hover:bg-emerald-400
                               dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400
                               transition-colors"
                    >
                        Start Quiz
                    </button>
                </div>
            </section>

            <!-- メイン: クイズ画面 -->
            <section id="main-quiz" class="hidden flex-1 overflow-y-auto flex flex-col">
                <!-- 進捗バー -->
                <div class="px-6 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-900/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 transition-colors duration-300">
                    <div>
                        <div class="uppercase text-[0.7rem] tracking-wide">Progress</div>
                        <div class="text-lg font-semibold text-slate-900 dark:text-slate-100">
                            <span id="current-q-num">1</span>
                            <span class="text-xs text-slate-400 mx-1">/</span>
                            <span id="total-q-num" class="text-slate-500 dark:text-slate-300">10</span>
                        </div>
                    </div>
                </div>

                <!-- 問題 + 選択肢 -->
                <div class="flex-1 overflow-y-auto p-6 flex flex-col justify-center">
                    <div class="max-w-2xl mx-auto w-full space-y-4">
                        <div id="question-text" class="text-sm leading-relaxed space-y-1">
                            <!-- question -->
                        </div>
                        <div id="options-container" class="mt-4 space-y-2">
                            <!-- options -->
                        </div>
                    </div>
                </div>

                <!-- Tips（回答後に表示） -->
                <div
                    id="tip-container"
                    class="hidden px-6 pb-4 max-w-2xl mx-auto w-full text-xs text-slate-600 dark:text-slate-300 space-y-2"
                >
                    <!-- JS で Tips を表示 -->
                </div>

                <!-- Result（クイズ終了後にメインに表示） -->
                <div
                    id="result-screen"
                    class="hidden px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900/60 transition-colors duration-300"
                >
                    <div class="max-w-2xl mx-auto w-full space-y-2">
                        <div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                            Result
                        </div>
                        <div class="text-sm font-semibold text-slate-800 dark:text-slate-100">
                            Score: <span id="result-score">0</span>
                        </div>
                        <div class="flex gap-2 mt-2">
                            <button
                                id="retry-button"
                                class="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                            >
                                Retry
                            </button>
                            <button
                                id="back-to-menu-button"
                                class="flex-1 px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-50 hover:bg-slate-700 transition-colors"
                            >
                                Menu
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Nextボタン -->
                <footer class="px-6 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end transition-colors duration-300">
                    <button
                        id="next-button"
                        class="px-4 py-2 text-xs rounded-xl
                               border border-slate-300 dark:border-slate-700
                               text-slate-700 dark:text-slate-200
                               bg-white dark:bg-slate-900
                               hover:border-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800
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
        <aside class="side-panel bg-slate-50 dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 text-xs transition-colors duration-300">
            <!-- ① 共通: Settings（コンパクト） -->
            <section id="side-settings" class="border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900/60 transition-colors duration-300">
                <div class="px-3 py-2 flex items-center justify-between gap-3">
                    <!-- Text size -->
                    <div class="flex items-center gap-2">
                        <span class="text-[0.7rem] text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                            Text
                        </span>
                        <div class="inline-flex rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 overflow-hidden">
                            <button id="size-small-menu" class="px-2 py-0.5 text-[0.7rem] font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
                                A
                            </button>
                            <button id="size-medium-menu" class="px-2 py-0.5 text-[0.8rem] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700">
                                A
                            </button>
                            <button id="size-large-menu" class="px-2 py-0.5 text-[0.9rem] font-bold text-slate-900 dark:text-slate-50 hover:bg-slate-100 dark:hover:bg-slate-700">
                                A
                            </button>
                        </div>
                    </div>

                    <!-- Theme -->
                    <div class="flex items-center gap-2">
                        <span class="text-[0.7rem] text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                            Theme
                        </span>
                        <button
                            id="theme-toggle-menu"
                            type="button"
                            class="px-3 py-1 rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-[0.8rem] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                        >
                            Dark / Light
                        </button>
                    </div>
                </div>
            </section>

            <!-- ② メニュー専用: Number of questions -->
            <section id="side-menu" class="flex-1 flex flex-col">
                <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900/60 transition-colors duration-300">
                    <h2 class="font-semibold text-slate-800 dark:text-slate-100 text-sm">Quiz options</h2>
                </div>
                <div class="flex-1 overflow-y-auto p-4 space-y-4">
                    <section class="space-y-2">
                        <label for="question-count" class="block text-xs text-slate-500 dark:text-slate-400">
                            Number of questions
                        </label>
                        <input
                            id="question-count"
                            type="number"
                            min="1"
                            max="50"
                            value="10"
                            class="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-100"
                        />
                        <p class="text-xs text-slate-500 dark:text-slate-500">
                            You can change the number of questions between 1 and 50.
                        </p>
                    </section>
                </div>
            </section>

            <!-- ③ クイズ専用: Mistakes -->
            <section id="side-quiz" class="hidden flex-1 flex flex-col">
                <!-- Mistakes ヘッダー -->
                <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900/60 flex items-center justify-between transition-colors duration-300">
                    <div class="flex items-center gap-2">
                        <span class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Mistakes</span>
                    </div>
                    <span id="mistake-count" class="hidden bg-red-500 text-white text-[0.7rem] font-semibold px-2 py-0.5 rounded-full">
                        0
                    </span>
                </div>

                <!-- Mistakes リスト -->
                <div class="flex-1 overflow-y-auto p-3" id="review-container">
                    <div id="review-empty" class="h-full flex flex-col items-center justify-center text-slate-500 text-xs">
                        No mistakes yet.
                    </div>
                    <ul id="review-list" class="space-y-2 hidden">
                        <!-- mistake items -->
                    </ul>
                </div>
            </section>
        </aside>
    </div>

    <script type="module" src="js/main.js"></script>
</body>
</html>