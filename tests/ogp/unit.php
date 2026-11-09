<?php
declare(strict_types=1);
define('QUIZ_OGP_LIBRARY', true);
require $argv[1] . '/ogp-card.php';
$font = $argv[1] . '/fonts/NotoSansJP-Regular.otf';
function check(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
set_error_handler(static function (int $severity, string $message): never { throw new ErrorException($message, 0, $severity); });
check(ogpInput(['title' => '', 'description' => " \r\n "], []) === ['title' => OGP_DEFAULT_TITLE, 'description' => OGP_DEFAULT_DESCRIPTION], 'Empty defaults');
check(ogpInput(['title' => "\u{3000}\u{FEFF}", 'description' => "\u{00A0}"], []) === ['title' => OGP_DEFAULT_TITLE, 'description' => OGP_DEFAULT_DESCRIPTION], 'Unicode whitespace defaults');
check(ogpInput(['title' => "日本語\r\n二行目\r三行目", 'description' => "説明\t文"], []) === ['title' => "日本語\n二行目\n三行目", 'description' => '説明 文'], 'Newline normalization');
check(ogpInput(['quiz' => 'sample'], ['sample' => ['title' => '題庫', 'description' => '説明']])['title'] === '題庫', 'Local metadata');
foreach ([['title' => []], ['description' => []], ['quiz' => []], ['title' => "\xFF"], ['title' => "\0"], ['title' => str_repeat('字', 241)], ['description' => str_repeat('字', 1201)], ['quiz' => '../data'], ['quiz' => 'https://example.com/']] as $query) {
    try { ogpInput($query, []); throw new RuntimeException('Expected invalid input'); }
    catch (InvalidArgumentException) { }
}
check(ogpWrap('一行', $font, 52, 1060, 1) === ['一行'], 'No false ellipsis at exact line limit');
check(ogpWrap("一\n\n三", $font, 52, 1060, 3) === ['一', '', '三'], 'Empty line preservation');
$lines = ogpWrap(str_repeat('幅の広い日本語', 30), $font, 52, 1060, 3);
check(count($lines) === 3 && str_ends_with($lines[2], '…'), 'Truncation marker');
foreach ($lines as $line) check(ogpWidth($line, $font, 52) <= 1060, 'Measured width');
check(str_starts_with(ogpRender(ogpInput([], []), $font), "\x89PNG"), 'Render PNG');
try { ogpRender(ogpInput([], []), $font . '.missing'); throw new LogicException('Expected missing-font failure'); }
catch (RuntimeException $error) { check($error->getMessage() === 'Bundled font is missing.', 'Missing-font failure'); }
echo "OGP boundary/wrapping checks passed.\n";
