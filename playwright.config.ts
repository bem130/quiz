import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    testIgnore: '**/pwa.spec.ts',
    timeout: 60_000,
    fullyParallel: false,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:5173/quiz/',
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'npm run dev -- --port 5173 --strictPort',
        url: 'http://127.0.0.1:5173/quiz/',
        reuseExistingServer: false,
        timeout: 60_000
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } }
    ]
});
