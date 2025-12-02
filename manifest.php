<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

header('Content-Type: application/manifest+json; charset=utf-8');

$manifest = [
    'name' => '4-choice Quiz',
    'short_name' => '4-choice Quiz',
    'app_version' => APP_VERSION,
    'description' => '4択クイズをWebで解くためのPWA版アプリ。',
    'start_url' => QUIZ_BASE_URL,
    'scope' => QUIZ_BASE_URL,
    'display' => 'standalone',
    'orientation' => 'portrait',
    'theme_color' => '#020617',
    'background_color' => '#020617',
    'icons' => [
        [
            'src' => quiz_versioned_asset_url('icons/icon-192.svg'),
            'sizes' => '192x192',
            'type' => 'image/svg+xml',
        ],
        [
            'src' => quiz_versioned_asset_url('icons/icon-512.svg'),
            'sizes' => '512x512',
            'type' => 'image/svg+xml',
        ],
    ],
];

echo json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
