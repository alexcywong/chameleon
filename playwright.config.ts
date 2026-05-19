import { defineConfig, devices } from '@playwright/test';

const WS_TEST_PATTERN = /multiplayer10p|kiwi-escape|play-again|full-game-10p-5r/;
const wsMode = process.env.PLAYWRIGHT_WS === '1';

export default defineConfig({
  testDir: './tests',
  testMatch: wsMode ? WS_TEST_PATTERN : undefined,
  testIgnore: wsMode ? undefined : WS_TEST_PATTERN,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  timeout: wsMode ? 300_000 : 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: wsMode ? 'npm run dev' : 'VITE_USE_LOCAL=true npx vite',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: wsMode ? 30_000 : 15_000,
  },
});
