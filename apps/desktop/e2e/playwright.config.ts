import { defineConfig } from '@playwright/test';

// Performance-only. Product Acceptance uses Python + embedded WebDriver.
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  projects: [
    {
      name: 'performance',
      use: { mode: 'tauri' } as Record<string, unknown>,
    },
  ],
});
