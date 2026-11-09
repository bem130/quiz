import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
    { ignores: ['node_modules/**', 'dist/**', 'src/core/quality-rules-*/**'] },
    {
        files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts', 'vite.config.ts', 'playwright.config.ts', 'playwright.pwa.config.ts'],
        extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-non-null-assertion': 'error',
            '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
            '@typescript-eslint/switch-exhaustiveness-check': 'error'
        }
    },
    {
        files: ['src/service-worker.ts'],
        languageOptions: {
            parserOptions: {
                projectService: false,
                project: './tsconfig.worker.json'
            }
        }
    },
    {
        files: ['src/core/**/*.ts'],
        rules: {
            'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'indexedDB', 'fetch'],
            'no-restricted-imports': ['error', { patterns: ['node:*', 'vite', 'dexie', 'https:*'] }],
            'no-restricted-properties': [
                'error',
                { object: 'Math', property: 'random', message: '乱数はcoreの入力として渡す。' },
                { object: 'Date', property: 'now', message: '時刻はcoreの入力として渡す。' }
            ]
        }
    }
);
