<?php
declare(strict_types=1);

/**
 * Build base URL for the quiz application root with trailing slash.
 *
 * Example: https://example.com/quiz/
 */
function quiz_base_url(): string
{
    $https  = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    $scheme = $https ? 'https' : 'http';
    $host   = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $path   = '/quiz/';

    return $scheme . '://' . $host . $path;
}

/**
 * Constant base URL for the quiz application.
 */
define('QUIZ_BASE_URL', quiz_base_url());

/**
 * Build an absolute asset URL from the quiz base URL.
 */
function quiz_asset_url(string $relativePath): string
{
    $path = ltrim($relativePath, '/');

    return QUIZ_BASE_URL . $path;
}
