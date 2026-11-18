import { defineConfig } from '@playwright/test';

const { BASE_URL, RUN_DIR } = process.env;
if (!BASE_URL || !RUN_DIR) {
  throw new Error('BASE_URL and RUN_DIR are required; run scripts/verify/verify.sh e2e');
}

export default defineConfig({
  testDir: 'e2e',
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: `${RUN_DIR}/results.json` }]],
  outputDir: `${RUN_DIR}/test-results`,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
});
