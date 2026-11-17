import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: 2,
  use: { baseURL: 'http://127.0.0.1:3099', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3099',
    url: 'http://127.0.0.1:3099',
    env: { NEXT_PUBLIC_FORKPOINT_CONTRACT: '0x1111111111111111111111111111111111111111' },
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
