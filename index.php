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

/**
 * quiz パラメータにもとづいてローカル JSON からタイトル等を取得する。
 * entry パラメータはここでは一切使わない（外部 URL に触れないため）。
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
        'title'       => $decoded['title']       ?? $quizParam,
        'description' => $decoded['description'] ?? '',
        'url'         => $baseUrl . '?quiz=' . rawurlencode($quizParam),
    ];
}

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

// -----------------------------
// ここから OGP 用のパラメータ決定
// -----------------------------

$defaultTitle       = '4-choice Quiz';
$defaultDescription = 'Browse and play 4-choice quizzes.';
$baseUrl            = buildBaseUrl();

// entry が付いているかどうかだけを見る（値の中身は使わない）
$entryParamRaw = $_GET['entry'] ?? null;
$hasEntryParam = ($entryParamRaw !== null && $entryParamRaw !== '');

// quiz と mode は通常どおり取得
$quizParam = $_GET['quiz'] ?? null;

// mode は英数字 + _ - のみ許可（それ以外は無視）
$modeParamRaw = $_GET['mode'] ?? null;
$modeParam = null;
if ($modeParamRaw !== null && preg_match('/^[A-Za-z0-9_-]+$/', (string) $modeParamRaw)) {
    $modeParam = (string) $modeParamRaw;
}

// entry が「指定されていない」場合だけ、クイズごとの OGP を読む
// （＝ ./entry.php を使っている URL だとみなす）
$quizMetadata = null;
if (!$hasEntryParam) {
    $quizMetadata = loadQuizMetadata($quizParam, $baseUrl);
}

// タイトル・説明
$pageTitle       = $quizMetadata['title']       ?? $defaultTitle;
$pageDescription = $quizMetadata['description'] ?? $defaultDescription;

// og:url / canonical 用の URL
// - entry あり → サイト共通の baseUrl
// - entry なし & quizMetadata あり → ?quiz=... 付きの URL
$ogUrl = $quizMetadata['url'] ?? $baseUrl;

// mode があれば ogUrl にだけ付ける（entry とは無関係なので安全）
if ($modeParam !== null) {
    $ogUrl .= (strpos($ogUrl, '?') === false ? '?' : '&')
        . 'mode=' . rawurlencode($modeParam);
}
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
            <header class="px-[0.5rem] py-[0.8rem] border-b border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-850/90 flex items-center justify-between transition-colors duration-300">
                <div>
                    <h1 id="app-title" class="text-lg font-semibold">4-choice Quiz</h1>
                    <p id="app-description" class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Loading quiz definition...
                    </p>
                </div>
            </header>

            <!-- メイン: メニュー画面 -->
            <section id="main-menu" class="flex-1 overflow-y-auto p-6 space-y-6 text-sm">
                <section class="space-y-3">
                    <h2 class="text-base font-semibold text-slate-800 dark:text-slate-100">Mode</h2>
                    <div id="mode-message" class="text-xs text-rose-600 dark:text-rose-300 hidden"></div>
                    <div id="mode-list" class="space-y-2">
                        <!-- JS でボタンを生成 -->
                    </div>
                </section>

                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
                    <p class="text-xs text-slate-600 dark:text-slate-400">
                        モードを選択して「Start Quiz」で開始します。
                    </p>
                    <button
                        id="start-button"
                        class="px-5 py-2 text-sm font-semibold rounded-xl
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

                <div id="question-view" class="flex-1 overflow-y-auto p-[0.9rem] flex flex-col">
                    <!-- 内側ラッパーを flex-1 + flex-col にする -->
                    <div class="max-w-4xl w-full mx-auto flex-1 flex flex-col space-y-4">
                        <div id="question-text" class="text-base leading-relaxed space-y-2">
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
                    class="hidden flex-1 overflow-y-auto p-6 bg-slate-100 dark:bg-slate-900/60 transition-colors duration-300"
                >
                    <div class="max-w-4xl mx-auto w-full space-y-6">
                        <div>
                            <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Result</p>
                            <h2 class="text-2xl font-semibold text-slate-900 dark:text-slate-100">クイズ結果</h2>
                            <p id="result-score" class="text-sm text-slate-600 dark:text-slate-300 mt-1">Score: 0 / 0</p>
                        </div>
                        <div class="grid gap-4 sm:grid-cols-3">
                            <div class="p-4 rounded-xl bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 shadow-sm">
                                <div class="text-xs text-slate-500 dark:text-slate-400">Total</div>
                                <div class="text-2xl font-bold text-slate-900 dark:text-slate-50" id="result-total">0</div>
                            </div>
                            <div class="p-4 rounded-xl bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 shadow-sm">
                                <div class="text-xs text-slate-500 dark:text-slate-400">Correct</div>
                                <div class="text-2xl font-bold text-emerald-600 dark:text-emerald-300" id="result-correct">0</div>
                            </div>
                            <div class="p-4 rounded-xl bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 shadow-sm">
                                <div class="text-xs text-slate-500 dark:text-slate-400">Accuracy</div>
                                <div class="text-2xl font-bold text-slate-900 dark:text-slate-50" id="result-accuracy">0%</div>
                            </div>
                        </div>
                        <div class="flex flex-col sm:flex-row gap-3">
                            <button
                                id="retry-button"
                                class="flex-1 px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                            >
                                Retry
                            </button>
                            <button
                                id="back-to-menu-button"
                                class="flex-1 px-4 py-2 rounded-xl text-sm
                                    bg-slate-800 text-slate-50 hover:bg-slate-700
                                    dark:bg-slate-800 dark:text-slate-50 dark:hover:bg-slate-700"
                            >
                                Menu
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Bottom bar: interrupt / progress / score / timer / next -->
                <footer class="px-[0.5rem] py-[0.3rem] border-t border-slate-200 dark:border-slate-700 flex items-center gap-4 text-xs transition-colors duration-300">
                    <!-- Interrupt button -->
                    <button
                        id="interrupt-button"
                        type="button"
                        class="px-3 py-2 rounded-xl
                            border border-slate-300 dark:border-slate-700
                            text-slate-700 dark:text-slate-200
                            bg-white dark:bg-slate-900
                            hover:border-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30
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
                            <span class="uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Progress
                            </span>
                            <span class="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
                                <span id="current-q-num">1</span>
                                <span class="text-[0.7rem] text-slate-400 mx-1">/</span>
                                <span id="total-q-num" class="text-slate-500 dark:text-slate-300">10</span>
                            </span>
                        </div>

                        <!-- Score -->
                        <div class="flex items-baseline gap-1">
                            <span class="uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Score
                            </span>
                            <span class="text-sm sm:text-base font-semibold text-emerald-500" id="current-score">
                                0
                            </span>
                        </div>

                        <!-- Timer -->
                        <div class="flex items-baseline gap-1">
                            <span class="uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Time
                            </span>
                            <span class="text-sm sm:text-base font-mono text-slate-900 dark:text-slate-100" id="quiz-timer">
                                00:00
                            </span>
                        </div>
                    </div>

                    <!-- Next button -->
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
                    <div class="inline-flex rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 overflow-hidden">
                        <!-- xxs -->
                        <button
                            id="size-xxs-menu"
                            class="px-1.5 py-0.5 text-[0.6rem] font-bold
                                text-slate-400 dark:text-slate-500
                                hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                            A
                        </button>

                        <!-- xs -->
                        <button
                            id="size-xs-menu"
                            class="px-1.5 py-0.5 text-[0.65rem] font-bold
                                text-slate-500 dark:text-slate-400
                                hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                            A
                        </button>

                        <!-- s (existing small) -->
                        <button
                            id="size-small-menu"
                            class="px-1.5 py-0.5 text-[0.7rem] font-bold
                                text-slate-500 dark:text-slate-400
                                hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                            A
                        </button>

                        <!-- m (existing medium) -->
                        <button
                            id="size-medium-menu"
                            class="px-1.5 py-0.5 text-[0.8rem] font-bold
                                text-slate-700 dark:text-slate-200
                                hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                            A
                        </button>

                        <!-- l (existing large) -->
                        <button
                            id="size-large-menu"
                            class="px-1.5 py-0.5 text-[0.9rem] font-bold
                                text-slate-900 dark:text-slate-50
                                hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                            A
                        </button>

                        <!-- xl -->
                        <button
                            id="size-xl-menu"
                            class="px-1.5 py-0.5 text-[1.0rem] font-bold
                                text-slate-900 dark:text-slate-50
                                hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                            A
                        </button>

                        <!-- xxl -->
                        <button
                            id="size-xxl-menu"
                            class="px-1.5 py-0.5 text-[1.1rem] font-bold
                                text-slate-900 dark:text-slate-50
                                hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                            A
                        </button>
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

                    <button
                        id="fullscreen-toggle-menu"
                        type="button"
                        class="px-3 py-1 rounded-full border border-slate-300 dark:border-slate-600
                            bg-white dark:bg-slate-800 text-[0.8rem]
                            text-slate-700 dark:text-slate-200
                            hover:bg-slate-100 dark:hover:bg-slate-700
                            transition-colors"
                    >
                        Full
                    </button>
                </div>
            </section>

            <!-- ② メニュー専用: Number of questions -->
            <section id="side-menu" class="flex-1 flex flex-col">
                <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900/60 transition-colors duration-300">
                    <h2 class="font-semibold text-slate-800 dark:text-slate-100 text-sm">Entries &amp; Quizzes</h2>
                </div>
                <div class="flex-1 overflow-y-auto p-4 space-y-6">
                    <section class="space-y-2">
                        <div class="flex items-center justify-between">
                            <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-100">Available Entries</h3>
                        </div>
                        <div class="space-y-2">
                            <div class="flex gap-2">
                                <input
                                    id="entry-url-input"
                                    type="url"
                                    placeholder="https://example.com/quiz/entry.php"
                                    class="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-100"
                                />
                                <button
                                    id="entry-add-button"
                                    type="button"
                                    class="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-50 hover:bg-slate-700 dark:bg-slate-800 dark:text-slate-50 dark:hover:bg-slate-700"
                                >
                                    Add
                                </button>
                            </div>
                            <p class="text-[11px] text-slate-500 dark:text-slate-400">Entries are saved in this browser.</p>
                        </div>
                        <div id="entry-list" class="space-y-2"></div>
                    </section>

                    <section class="space-y-2">
                        <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-100">Available Quizzes</h3>
                        <div id="quiz-list" class="space-y-2">
                            <!-- JS で埋め込み -->
                        </div>
                    </section>

                    <section class="space-y-2">
                        <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-100">Quiz options</h3>
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

            <!-- ③ クイズ専用: Mistakes / Tips / Result list -->
            <section id="side-quiz" class="hidden flex-1 min-h-0 flex flex-col">

                <!-- コンテンツ全体: 上が Mistakes/Result（スクロール）、下が Tips（固定） -->
                <div class="flex-1 min-h-0 px-4 py-3 flex flex-col gap-3">
                    <!-- 上: Mistakes / Result Questions のスクロール領域 -->
                    <div class="flex-1 min-h-0 overflow-y-auto space-y-3">
                        <!-- Mistakes パネル -->
                        <section id="mistakes-panel" class="space-y-2">
                            <div class="flex items-center justify-between">
                                <span class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    Mistakes
                                </span>
                                <span
                                    id="mistake-count"
                                    class="hidden bg-red-500 text-white text-[0.7rem] font-semibold px-2 py-0.5 rounded-full"
                                >
                                    0
                                </span>
                            </div>
                            <div
                                id="review-empty"
                                class="h-full flex flex-col items-center justify-center text-slate-500 text-xs"
                            >
                                No mistakes yet.
                            </div>
                            <ul id="review-list" class="space-y-2 hidden"></ul>
                        </section>

                        <!-- Result Questions パネル（結果画面のときだけ表示） -->
                        <section id="result-list-panel" class="space-y-2 hidden">
                            <div class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Result Questions
                            </div>
                            <ul id="result-list" class="space-y-2"></ul>
                        </section>
                    </div>

                    <!-- 下: Tips（固定表示・スクロールさせない） -->
                    <section id="tips-panel" class="space-y-2 shrink-0">
                        <div class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Tips
                        </div>
                        <div id="tip-container" class="space-y-2 text-xs"></div>
                    </section>
                </div>
            </section>
        </aside>
    </div>

    <script type="module" src="js/main.js"></script>
</body>
</html>