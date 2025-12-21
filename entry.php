<?php
// entry.php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

// ファイルシステム上のクイズディレクトリ
$quizDirFs  = __DIR__ . '/data/quizzes';
// ブラウザから見た相対 URL （entry.php からの相対パス）
$quizWebDir = './data/quizzes';

$files = [];

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

        $files[] = $quizWebDir . '/' . $fileName;
    }
}

sort($files, SORT_STRING);

$output = [
    'version' => 3,
    'label'   => 'Server',
    'files'   => $files,
];

echo json_encode(
    $output,
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT
);
