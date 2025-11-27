<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

function logEntryEvent(string $message): void
{
    error_log('[entry.php] ' . $message);
}

function buildBaseEntry(array $quizData, string $fileName): array
{
    $id = $quizData['id'] ?? pathinfo($fileName, PATHINFO_FILENAME);
    $entry = [
        'id' => $id,
        'file' => 'data/quizzes/' . $fileName,
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

function loadEntriesFromQuizzes(): array
{
    $quizDir = __DIR__ . '/data/quizzes';
    if (!is_dir($quizDir)) {
        throw new RuntimeException('Quiz directory not found.');
    }

    $files = glob($quizDir . '/*.json') ?: [];
    $entries = [];

    foreach ($files as $path) {
        $json = file_get_contents($path);
        if ($json === false) {
            continue;
        }

        $decoded = json_decode($json, true);
        if (!is_array($decoded)) {
            continue;
        }

        $fileName = basename($path);
        $entries[] = buildBaseEntry($decoded, $fileName);
    }

    usort($entries, static function (array $a, array $b): int {
        return strcmp($a['id'], $b['id']);
    });

    logEntryEvent('Loaded quizzes from directory ' . $quizDir . ' (' . count($entries) . ' entries)');

    return [
        'version' => 2,
        'quizzes' => $entries,
    ];
}

function loadFallbackEntry(): array
{
    $fallbackPath = __DIR__ . '/data/entry.json';
    $json = file_get_contents($fallbackPath);
    if ($json === false) {
        throw new RuntimeException('Fallback entry.json could not be read.');
    }

    $decoded = json_decode($json, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('Fallback entry.json is not valid JSON.');
    }

    $quizzes = isset($decoded['quizzes']) && is_array($decoded['quizzes']) ? count($decoded['quizzes']) : 0;
    logEntryEvent('Loaded fallback entry data from ' . $fallbackPath . ' (' . $quizzes . ' entries)');

    return $decoded;
}

try {
    $requestUri = $_SERVER['REQUEST_URI'] ?? '(unknown)';
    logEntryEvent('Incoming request: ' . $requestUri);
    $payload = loadEntriesFromQuizzes();
} catch (Throwable $exception) {
    logEntryEvent('Failed to load entries from quizzes, falling back: ' . $exception->getMessage());
    $payload = loadFallbackEntry();
}

echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
