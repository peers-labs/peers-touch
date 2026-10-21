import { expect, test } from "@playwright/test";

const draft = {
  revision: "1111111111111111111111111111111111111111",
  content_sha256: "a".repeat(64),
  loaded_at: "2026-10-18T12:00:00Z",
  catalog: {
    schema_version: 1,
    channel: "stable",
    endpoints: [{
      seed_id: "relay-home",
      kind: "relay",
      display_name: "Home Relay",
      connection_material_base64: "AA==",
      regions: ["global"],
      available_until: "2026-10-19T12:00:00Z",
    }],
    releases: [{
      release_id: "desktop-macos-arm64-1.0.0",
      platform: "macos",
      architecture: "arm64",
      version: "1.0.0",
      minimum_supported_version: "0.1.0",
      manifest_url: "https://releases.example/manifest.json",
      manifest_sha256: "b".repeat(64),
      release_signing_key_id: "release-1",
      release_notes_url: "https://releases.example/notes",
      published_at: "2026-10-18T12:00:00Z",
    }],
  },
};

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "narrow", width: 390, height: 844 },
]) {
  test(`renders confirmed console hierarchy at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/admin/auth/session", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        provider: "github",
        provider_subject: "subject-42",
        expires_at: "2026-10-18T13:00:00Z",
      }),
    }));
    await page.route("**/api/admin/catalog?**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(draft),
    }));
    await page.route("**/api/admin/publications?**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ publications: [] }),
    }));

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "配置目录" })).toBeVisible();
    await expect(page.getByText("Home Relay")).toBeVisible();
    await expect(page.getByText("确认后，X Config 服务会签名并立即发布这份精确草稿。")).toBeVisible();
    await expect(page.getByRole("button", { name: "审查并发布" })).toBeEnabled();
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth,
    )).toBe(true);

    await page.getByRole("button", { name: "添加节点" }).click();
    await expect(page.getByText("连接材料（Base64 protobuf）")).toBeVisible();
    await page.keyboard.press("Escape");
  });
}

test("keeps the authenticated console degraded when publication history is unavailable", async ({ page }) => {
  await page.route("**/api/admin/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      authenticated: true,
      provider: "github",
      provider_subject: "subject-42",
      expires_at: "2026-10-18T13:00:00Z",
    }),
  }));
  await page.route("**/api/admin/catalog?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(draft),
  }));
  await page.route("**/api/admin/publications?**", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "admin_unavailable" }),
  }));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "配置目录" })).toBeVisible();
  await expect(page.getByText("发布历史暂不可用")).toBeVisible();
  await expect(page.getByRole("button", { name: "审查并发布" })).toBeDisabled();
});

test("matches a publication by catalog digest after repository head advances", async ({ page }) => {
  await page.route("**/api/admin/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      authenticated: true,
      provider: "github",
      provider_subject: "subject-42",
      expires_at: "2026-10-18T13:00:00Z",
    }),
  }));
  await page.route("**/api/admin/catalog?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ...draft,
      revision: "2222222222222222222222222222222222222222",
    }),
  }));
  await page.route("**/api/admin/publications?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      publications: [{
        publication_id: "publication-00000000000000000001",
        channel: "stable",
        sequence: 1,
        source_revision: draft.revision,
        content_sha256: draft.content_sha256,
        signing_key_id: "publisher-1",
        statement_sha256: "b".repeat(64),
        envelope_sha256: "c".repeat(64),
        published_by: "github:subject-42",
        published_at: "2026-10-18T12:30:00Z",
        expires_at: "2026-10-19T12:30:00Z",
        repository_revision: "2222222222222222222222222222222222222222",
        catalog: draft.catalog,
      }],
    }),
  }));
  await page.route("**/api/admin/catalog/validate", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      valid: true,
      content_sha256: draft.content_sha256,
      findings: [],
    }),
  }));

  await page.goto("/");
  await expect(page.getByText("已发布", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "审查并发布" }).click();
  await expect(page.getByText("以更高序列重新发布当前目录")).toBeVisible();
});

test("allows an initial signed empty snapshot", async ({ page }) => {
  await page.route("**/api/admin/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      authenticated: true,
      provider: "github",
      provider_subject: "subject-42",
      expires_at: "2026-10-18T13:00:00Z",
    }),
  }));
  await page.route("**/api/admin/catalog?**", (route) => route.fulfill({
    status: 404,
    contentType: "application/json",
    body: JSON.stringify({ error: "not_found" }),
  }));
  await page.route("**/api/admin/publications?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ publications: [] }),
  }));
  await page.route("**/api/admin/catalog/validate", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      valid: true,
      content_sha256: "d".repeat(64),
      findings: [],
    }),
  }));

  await page.goto("/");
  await page.getByRole("button", { name: "审查并发布" }).click();
  await expect(page.getByText("创建首个已签名空快照")).toBeVisible();
  await expect(page.getByRole("button", { name: "立即发布" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "立即发布" })).toBeEnabled();
});
