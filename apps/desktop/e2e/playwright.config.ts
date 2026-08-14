import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  projects: [
    {
      name: 'acceptance',
      testDir: './acceptance',
      use: { mode: 'tauri' } as Record<string, unknown>,
    },
    {
      name: 'performance',
      testDir: './tests',
      use: { mode: 'tauri' } as Record<string, unknown>,
    },
  ],
});
