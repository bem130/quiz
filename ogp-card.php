<?php
declare(strict_types=1);

const OGP_DEFAULT_TITLE = '4-choice Quiz';
const OGP_DEFAULT_DESCRIPTION = 'Multiple-choice quiz app.';

/** HTTP入力は文字列だけ受理し、描画前にUTF-8と上限を確認する。 */
function ogpText(mixed $value, string $fallback, int $limit): string
{
    if (!is_string($value) || !mb_check_encoding($value, 'UTF-8')) {
        throw new InvalidArgumentException('Expected UTF-8 string.');
    }
    if (mb_strlen($value, 'UTF-8') > $limit || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', $value)) {
        throw new InvalidArgumentException('Text exceeds the limit or contains control characters.');
    }
    $text = preg_replace('/\A[\s\p{Z}\x{FEFF}]+|[\s\p{Z}\x{FEFF}]+\z/u', '', str_replace(["\r\n", "\r", "\t"], ["\n", "\n", ' '], $value));
    if ($text === null) throw new RuntimeException('Text normalization failed.');
    return $text === '' ? $fallback : $text;
}

/** quizは固定ローカル索引のキーであり、URLやファイルパスとして扱わない。 */
function ogpInput(array $query, array $metadata): array
{
    $title = ogpText($query['title'] ?? OGP_DEFAULT_TITLE, OGP_DEFAULT_TITLE, 240);
    $description = ogpText($query['description'] ?? OGP_DEFAULT_DESCRIPTION, OGP_DEFAULT_DESCRIPTION, 1200);
    $quiz = ogpText($query['quiz'] ?? '', '', 80);
    if ($quiz !== '') {
        if (!preg_match('/\A[A-Za-z0-9_-]{1,80}\z/D', $quiz)) {
            throw new InvalidArgumentException('Invalid quiz identifier.');
        }
        if (!array_key_exists($quiz, $metadata)) throw new OutOfBoundsException('Unknown quiz.');
        $entry = $metadata[$quiz];
        if (!is_array($entry) || !array_key_exists('title', $entry) || !array_key_exists('description', $entry)) {
            throw new RuntimeException('Invalid local metadata.');
        }
        try {
            $title = ogpText($entry['title'], OGP_DEFAULT_TITLE, 240);
            $description = ogpText($entry['description'], OGP_DEFAULT_DESCRIPTION, 1200);
        } catch (InvalidArgumentException $error) {
            throw new RuntimeException('Invalid local metadata.', 0, $error);
        }
    }
    return ['title' => $title, 'description' => $description];
}

function ogpBounds(string $text, string $font, int $size): array
{
    $box = imagettfbbox($size, 0, $font, $text);
    if ($box === false) throw new RuntimeException('Font measurement failed.');
    return [min($box[0], $box[2], $box[4], $box[6]), min($box[1], $box[3], $box[5], $box[7]),
        max($box[0], $box[2], $box[4], $box[6]), max($box[1], $box[3], $box[5], $box[7])];
}

function ogpWidth(string $text, string $font, int $size): int
{
    $box = ogpBounds($text, $font, $size);
    return $box[2] - $box[0];
}

/** 実際に省略した場合だけ末尾に…を付ける。空行も行数に含める。 */
function ogpWrap(string $text, string $font, int $size, int $width, int $limit): array
{
    $characters = preg_split('//u', $text, -1, PREG_SPLIT_NO_EMPTY);
    if ($characters === false) throw new RuntimeException('Invalid UTF-8.');
    $lines = [];
    $line = '';
    foreach ($characters as $character) {
        if ($character === "\n") {
            $lines[] = $line;
            $line = '';
        } elseif ($line !== '' && ogpWidth($line . $character, $font, $size) > $width) {
            $lines[] = $line;
            $line = $character;
        } else $line .= $character;
    }
    $lines[] = $line;
    if (count($lines) <= $limit) return $lines;
    $lines = array_slice($lines, 0, $limit);
    $last = $lines[$limit - 1];
    while ($last !== '' && ogpWidth($last . '…', $font, $size) > $width) {
        $last = mb_substr($last, 0, mb_strlen($last, 'UTF-8') - 1, 'UTF-8');
    }
    $lines[$limit - 1] = $last . '…';
    return $lines;
}

function ogpDrawLines(GdImage $image, array $lines, int $top, int $step, string $font, int $size, int $color): void
{
    foreach ($lines as $index => $line) {
        if ($line === '') continue;
        $box = ogpBounds($line, $font, $size);
        if (imagettftext($image, $size, 0, 110 - $box[0], $top + $index * $step - $box[1], $color, $font, $line) === false) {
            throw new RuntimeException('Text rendering failed.');
        }
    }
}

function ogpRender(array $input, string $font): string
{
    if (!is_readable($font)) throw new RuntimeException('Bundled font is missing.');
    $image = imagecreatetruecolor(1280, 720);
    if ($image === false) throw new RuntimeException('Image allocation failed.');
    try {
        $background = imagecolorallocate($image, 6, 10, 26);
        $accent = imagecolorallocate($image, 16, 185, 129);
        $foreground = imagecolorallocate($image, 236, 242, 255);
        $secondary = imagecolorallocate($image, 180, 192, 216);
        imagefilledrectangle($image, 0, 0, 1279, 719, $background);
        imagefilledrectangle($image, 60, 60, 1219, 659, $accent);
        imagefilledrectangle($image, 70, 70, 1209, 649, $background);
        $title = ogpWrap($input['title'], $font, 52, 1060, 3);
        $description = ogpWrap($input['description'], $font, 28, 1060, 4);
        ogpDrawLines($image, $title, 120, 80, $font, 52, $foreground);
        ogpDrawLines($image, $description, 120 + count($title) * 80 + 25, 48, $font, 28, $secondary);
        ob_start();
        try {
            if (!imagepng($image)) throw new RuntimeException('PNG encoding failed.');
            $png = ob_get_contents();
            if ($png === false) throw new RuntimeException('PNG output failed.');
            return $png;
        } finally { ob_end_clean(); }
    } finally { unset($image); }
}

function ogpRespond(): void
{
    // PHPの警告やファイルパスをPNG応答へ混入させない。
    ini_set('display_errors', '0');
    set_error_handler(static function (int $severity, string $message): never { throw new ErrorException($message, 0, $severity); });
    try {
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET' && ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') {
            header('Allow: GET, HEAD');
            http_response_code(405);
            throw new InvalidArgumentException('Use GET or HEAD.');
        }
        if (!extension_loaded('gd') || !extension_loaded('mbstring') || !function_exists('imagettfbbox')) throw new RuntimeException('GD/FreeType and mbstring are required.');
        $raw = file_get_contents(__DIR__ . '/metadata.json', false, null, 0, 1_000_001);
        if ($raw === false || strlen($raw) > 1_000_000) throw new RuntimeException('Local metadata is unavailable.');
        $metadata = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        if (!is_array($metadata)) throw new RuntimeException('Invalid local metadata.');
        $input = ogpInput($_GET, $metadata);
        $png = ogpRender($input, __DIR__ . '/fonts/NotoSansJP-Regular.otf');
        header('Content-Type: image/png');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: public, max-age=86400');
        header('Content-Length: ' . strlen($png));
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') echo $png;
    } catch (Throwable $error) {
        if (http_response_code() !== 405) http_response_code($error instanceof InvalidArgumentException ? 400 : ($error instanceof OutOfBoundsException ? 404 : 500));
        header('Content-Type: text/plain; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') echo http_response_code() === 500 ? 'OGP service unavailable.' : $error->getMessage();
    } finally { restore_error_handler(); }
}

if (!defined('QUIZ_OGP_LIBRARY')) ogpRespond();
