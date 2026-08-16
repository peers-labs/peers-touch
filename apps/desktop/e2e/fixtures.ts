// Performance-only Playwright transport. Never use this fixture for Acceptance.
import {
  createTauriTest,
  type TauriTestConfig,
} from '@srsholmes/tauri-playwright';

const tauriConfig: TauriTestConfig = {
  mcpSocket: process.env.PLAYWRIGHT_SOCKET || '/tmp/tauri-playwright.sock',
};

export const { test, expect } = createTauriTest(tauriConfig);
