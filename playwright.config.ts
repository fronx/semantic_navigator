import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Memory tests need to run sequentially
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    // Allow longer timeouts for memory profiling
    actionTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Launch with DevTools Protocol access
        launchOptions: {
          args: ['--enable-precise-memory-info'],
        },
      },
    },
  ],
  // Don't start dev server automatically - user should run it separately
  webServer: undefined,
});
