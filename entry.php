<?php
// entry.php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

// ファイルシステム上のクイズディレクトリ
$quizDirFs  = __DIR__ . '/data/quizzes';
// ブラウザから見た相対 URL （entry.php からの相対パス）
$quizWebDir = './data/quizzes';

$entries = [];

/**
 * 1 つのクイズ JSON からメニュー用エントリを構築する。
 *
 * - id  : ファイル名から拡張子 .json を除いたもの
 * - dir : entry.php から見た相対 URL （例: "./data/quizzes"）
 * - title / description / color は JSON の値があればそれを使う
 */
function buildEntry(array $quizData, string $fileName, string $webDir): array
{
    $id = pathinfo($fileName, PATHINFO_FILENAME);

    $entry = [
        'id'          => $id,
        'dir'         => $webDir,
        'title'       => $quizData['title']        ?? $id,
        'description' => $quizData['description']  ?? '',
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
        // ".data.json" はメタデータなのでスキップ
        if (substr($fileName, -10) === '.data.json') {
            continue;
        }

        $pathFs = $fileInfo->getPathname();

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

// id でソート（任意）
usort($entries, function (array $a, array $b) {
    return strcmp($a['id'], $b['id']);
});

// labelを追加
$output = [
    'version' => 2,
    'label'   => 'Server', // 好きな表示名に変えて OK
    'quizzes' => $entries,
];

echo json_encode(
    $output,
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT
);
