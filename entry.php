<?php
// entry.php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

// ファイルシステム上のクイズディレクトリ
$quizDirFs  = __DIR__ . '/data/quizzes';
// ブラウザから見えるパスのプレフィックス
$quizWebDir = 'data/quizzes';

$entries = [];

/**
 * 1 つのクイズ JSON からメニュー用エントリを構築する。
 *
 * - id  : ファイル名から拡張子 .json を除いたもの
 * - dir : "data/quizzes"
 * - title / description / color は JSON の値があればそれを使う
 */
function buildEntry(array $quizData, string $fileName, string $webDir): array
{
    $id = pathinfo($fileName, PATHINFO_FILENAME);

    $entry = [
        'id' => $id,
        'dir' => $webDir,                       // ← ここがポイント
        'title' => $quizData['title'] ?? $id,
        'description' => $quizData['description'] ?? '',
    ];

    if (isset($quizData['color'])) {
        $entry['color'] = $quizData['color'];
    }
    if (isset($quizData['tags']) && is_array($quizData['tags'])) {
        $entry['tags'] = $quizData['tags'];
    }
    if (isset($quizData['difficulty'])) {
        $entry['difficulty'] = $quizData['difficulty'];
    }
    if (isset($quizData['recommended'])) {
        $entry['recommended'] = (bool) $quizData['recommended'];
    }

    return $entry;
}

if (is_dir($quizDirFs)) {
    $dirIterator = new DirectoryIterator($quizDirFs);

    foreach ($dirIterator as $fileInfo) {
        if (!$fileInfo->isFile()) {
            continue;
        }
        if (strtolower($fileInfo->getExtension()) !== 'json') {
            continue;
        }

        $fileName = $fileInfo->getFilename();
        if (substr($fileName, -10) === '.data.json') { // ".data.json" は 10 文字
            continue;
        }

        $fileName = $fileInfo->getFilename();
        $pathFs   = $fileInfo->getPathname();

        $raw = @file_get_contents($pathFs);
        if ($raw === false) {
            continue;
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            continue;
        }

        $entries[] = buildEntry($decoded, $fileName, $quizWebDir);
    }
}

// id でソート（お好みで）
usort($entries, function (array $a, array $b) {
    return strcmp($a['id'], $b['id']);
});

echo json_encode(
    [
        'version' => 2,
        'quizzes' => $entries,
    ],
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT
);
