<?php
// ogp-card.php
declare(strict_types=1);

mb_internal_encoding('UTF-8');

/**
 * 指定したフォントを優先順に探し、最初に見つかったパスを返す。
 */
function resolveFontPath(array $candidates): ?string
{
    foreach ($candidates as $path) {
        if (is_readable($path)) {
            return $path;
        }
    }

    return null;
}

/**
 * テキストを行ごとに分割し、各行が指定した幅を超えないように改行する。
 * 最大行数を超える場合は末尾に三点リーダーを付与する。
 */
function wrapText(string $text, string $font, int $fontSize, int $maxWidth, ?int $maxLines = null): array
{
    $normalized = str_replace(["\r\n", "\r"], "\n", trim($text));
    $characters = preg_split('//u', $normalized, -1, PREG_SPLIT_NO_EMPTY);
    $lines = [];
    $current = '';
    $lineLimit = $maxLines ?? PHP_INT_MAX;

    foreach ($characters as $char) {
        if ($char === "\n") {
            if ($current !== '') {
                $lines[] = $current;
                $current = '';
            }
            if (count($lines) >= $lineLimit) {
                break;
            }
            continue;
        }

        $candidate = $current . $char;
        $box = imagettfbbox($fontSize, 0, $font, $candidate);
        $width = $box[2] - $box[0];

        if ($width > $maxWidth && $current !== '') {
            $lines[] = $current;
            if (count($lines) >= $lineLimit) {
                $current = '';
                break;
            }
            $current = $char;
            continue;
        }

        $current = $candidate;
    }

    if ($current !== '' && count($lines) < $lineLimit) {
        $lines[] = $current;
    }

    if (count($lines) > $lineLimit) {
        $lines = array_slice($lines, 0, $lineLimit);
    }

    if ($maxLines !== null && count($lines) === $lineLimit) {
        $lastIndex = $lineLimit - 1;
        $lines[$lastIndex] = trimToWidth($lines[$lastIndex], $font, $fontSize, $maxWidth, true);
    }

    return $lines;
}

/**
 * 指定した幅に収まるように文字列を切り詰める。必要に応じて三点リーダーを付加する。
 */
function trimToWidth(string $text, string $font, int $fontSize, int $maxWidth, bool $ellipsis): string
{
    $suffix = $ellipsis ? '…' : '';
    $result = '';
    $characters = preg_split('//u', $text, -1, PREG_SPLIT_NO_EMPTY);

    foreach ($characters as $char) {
        $candidate = $result . $char . $suffix;
        $box = imagettfbbox($fontSize, 0, $font, $candidate);
        $width = $box[2] - $box[0];

        if ($width > $maxWidth) {
            break;
        }
        $result .= $char;
    }

    return $result . $suffix;
}

/**
 * 複数行のテキストを描画する。
 */
function drawLines($image, array $lines, int $x, int $y, string $font, int $fontSize, int $lineHeight, int $color): void
{
    $offsetY = 0;
    foreach ($lines as $line) {
        imagettftext($image, $fontSize, 0, $x, $y + $offsetY, $color, $font, $line);
        $offsetY += $lineHeight;
    }
}

/**
 * SVG を指定サイズにラスタライズして GD イメージとして返す。Imagick が利用できない場合は null を返す。
 */
function rasterizeSvg(string $path, int $size): ?GdImage
{
    if (!class_exists('Imagick') || !class_exists('ImagickPixel')) {
        return null;
    }

    if (!is_readable($path)) {
        return null;
    }

    try {
        $imagick = new Imagick();
        $imagick->setBackgroundColor(new ImagickPixel('transparent'));
        $imagick->readImage($path);
        $imagick->setImageFormat('png32');
        $imagick->resizeImage($size, $size, Imagick::FILTER_LANCZOS, 1, true);
        $blob = $imagick->getImagesBlob();
        $imagick->clear();
        $imagick->destroy();
    } catch (Throwable $exception) {
        return null;
    }

    $image = imagecreatefromstring($blob);
    if ($image === false) {
        return null;
    }

    return $image;
}

$defaultTitle = '4-choice Quiz';
$defaultDescription = 'Multiple-choice quiz app.';

$title = isset($_GET['title']) ? trim((string) $_GET['title']) : $defaultTitle;
$description = isset($_GET['description']) ? trim((string) $_GET['description']) : $defaultDescription;
$quizId = isset($_GET['quiz']) ? trim((string) $_GET['quiz']) : null;

$fontPath = resolveFontPath([
    __DIR__ . '/fonts/noto/NotoSansJP-Regular.otf',
    __DIR__ . '/fonts/noto/NotoSansJP-Light.ttf',
    __DIR__ . '/fonts/noto/NotoSerifJP-Light.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
]);

if ($fontPath === null) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Font not found.';
    exit;
}

if ($quizId !== null && $quizId !== '') {
    $quizPath = __DIR__ . '/data/quizzes/' . basename($quizId) . '.json';
    if (is_file($quizPath)) {
        $raw = @file_get_contents($quizPath);
        $decoded = json_decode((string) $raw, true);
        if (is_array($decoded)) {
            $title = isset($decoded['title']) && is_string($decoded['title'])
                ? trim($decoded['title'])
                : $title;
            $description = isset($decoded['description']) && is_string($decoded['description'])
                ? trim($decoded['description'])
                : $description;
        }
    }
}

$width = 1280;
$height = 720;
$image = imagecreatetruecolor($width, $height);
imagealphablending($image, false);
imagesavealpha($image, true);

$backgroundColor = imagecolorallocate($image, 6, 10, 26);
$titleColor = imagecolorallocate($image, 236, 242, 255);
$descriptionColor = imagecolorallocate($image, 180, 192, 216);
$accentColor = imagecolorallocatealpha($image, 16, 185, 129, 40);

imagefilledrectangle($image, 0, 0, $width, $height, $backgroundColor);
imagefilledrectangle($image, 60, 60, $width - 60, $height - 60, $accentColor);
imagefilledrectangle($image, 70, 70, $width - 70, $height - 70, $backgroundColor);

$padding = 110;
$textAreaWidth = $width - ($padding * 2);
$titleFontSize = 60;
$descriptionFontSize = 34;

$titleBox = imagettfbbox($titleFontSize, 0, $fontPath, 'Ay');
$descBox = imagettfbbox($descriptionFontSize, 0, $fontPath, 'Ay');
$titleLineHeight = (int) abs($titleBox[5] - $titleBox[1]);
$descriptionLineHeight = (int) abs($descBox[5] - $descBox[1]);

$titleLines = wrapText($title, $fontPath, $titleFontSize, $textAreaWidth, 3);
$descriptionLines = wrapText($description, $fontPath, $descriptionFontSize, $textAreaWidth, 5);

$baseX = $padding;
$baseY = $padding + $titleLineHeight;

drawLines($image, $titleLines, $baseX, $baseY, $fontPath, $titleFontSize, $titleLineHeight + 8, $titleColor);

$descriptionY = $baseY + (count($titleLines) * ($titleLineHeight + 8)) + 20;
drawLines($image, $descriptionLines, $baseX, $descriptionY, $fontPath, $descriptionFontSize, $descriptionLineHeight + 6, $descriptionColor);

$iconPath = __DIR__ . '/icons/icon-192.svg';
if (is_file($iconPath)) {
    $icon = rasterizeSvg($iconPath, 180);
    if ($icon !== null) {
        $iconSize = imagesx($icon);

        $dstX = $width - $iconSize - 70;
        $dstY = $height - $iconSize - 70;
        imagecopy($image, $icon, $dstX, $dstY, 0, 0, $iconSize, $iconSize);

        imagedestroy($icon);
    }
}

header('Content-Type: image/png');
header('Cache-Control: public, max-age=86400');
imagepng($image);
imagedestroy($image);
