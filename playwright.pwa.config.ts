import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: ['pwa.spec.ts', 'published-sharing.spec.ts'],
    outputDir: path.join(os.tmpdir(), 'quiz-pwa-test-results'),
    timeout: 90_000,
    fullyParallel: false,
    workers: 1,
    use: { baseURL: 'http://127.0.0.1:4320/quiz/', trace: 'retain-on-failure' },
    webServer: {
        command: 'npm run preview -- --port 4320 --strictPort',
        url: 'http://127.0.0.1:4320/quiz/', reuseExistingServer: false, timeout: 60_000
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } }
    ]
});
