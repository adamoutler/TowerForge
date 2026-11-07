import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const qaJsonReportPath = path.resolve(currentDir, '../docs/qa/TOWERFORGE-16/test-results.json');

export default defineConfig({
    testDir: './e2e',
    timeout: 60_000,
    expect: {
        timeout: 15_000,
    },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [
        ['list'],
        ['json', { outputFile: qaJsonReportPath }],
    ],
    use: {
        baseURL: 'https://towerforge.hackedyour.info',
        ignoreHTTPSErrors: true,
        viewport: { width: 1440, height: 900 },
        actionTimeout: 15_000,
        navigationTimeout: 30_000,
        launchOptions: {
            args: [
                '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks',
                '--allow-insecure-localhost',
            ],
        },
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
