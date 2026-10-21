import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig } from "@playwright/test";

const workspaceKey = createHash("sha256")
  .update(process.cwd())
  .digest("hex")
  .slice(0, 16);

export default defineConfig({
  testDir: "./tests",
  outputDir: join(
    tmpdir(),
    "peers-touch-playwright",
    workspaceKey,
    "x-config-console",
  ),
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:4318",
    browserName: "chromium",
    headless: true,
    locale: "zh-CN",
    launchOptions: process.platform === "darwin"
      ? { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }
      : {},
  },
  webServer: {
    command: "pnpm run dev --host 127.0.0.1 --port 4318",
    port: 4318,
    reuseExistingServer: false,
  },
});
