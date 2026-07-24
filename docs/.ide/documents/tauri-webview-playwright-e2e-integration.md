# 集成 tauri-plugin-playwright 闭环 tauri-webview Runtime Cell

## Context

Phase 0 sampler gate 已 6/6 PROVEN（`prod-preview` runtime），但 `tauri-webview` cell 仍 UNPROVEN。根因：macOS WKWebView 不支持 CDP，官方 `tauri-driver` 不支持 macOS 平台。

社区方案 `tauri-plugin-playwright` (v0.4.1) 通过 Tauri 进程内嵌 Unix socket bridge，由 Playwright test runner 发送指令、Rust plugin 调用 `webview.eval()` 在真实 WKWebView 内执行 JS，绕开 CDP 限制。

目标：集成此 plugin，在真实 macOS Tauri WKWebView 中驱动交互、采集带 `runtime: 'tauri-webview'` 标签的 telemetry 事件、上传到 Station，关闭 sampler gate 的 tauri-webview cell。

---

## 实现步骤

### 1. Cargo.toml — 添加 feature-gated 依赖

**文件**: `apps/desktop/src-tauri/Cargo.toml`

```toml
[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
e2e-testing = ["tauri-plugin-playwright"]

[dependencies]
tauri-plugin-playwright = { version = "0.4", optional = true }
```

### 2. main.rs — 条件注册 plugin

**文件**: `apps/desktop/src-tauri/src/main.rs`

将现有的单表达式 Builder 链拆为 mutable builder 模式，在 `.manage()` 之前插入：

```rust
#[cfg(feature = "e2e-testing")]
{
    builder = builder.plugin(tauri_plugin_playwright::init());
}
```

### 3. Capability — 按需添加

如果 plugin 在 Tauri 2 capability system 中需要声明，新增 `apps/desktop/src-tauri/capabilities/e2e-testing.json`：

```json
{
  "identifier": "e2e-testing",
  "windows": ["*"],
  "permissions": ["playwright:default"]
}
```

> 注：先验证 0.4.x 是否需要此文件；如果 plugin 通过内部 API 注入 JS 不需要额外 permission，则跳过。

### 4. npm 依赖

```bash
cd apps/desktop && pnpm add -D @srsholmes/tauri-playwright @playwright/test
```

### 5. Make target — E2E 构建启动

**文件**: `Makefile` 或 `tooling/make/acceptance.mk`

```makefile
desktop-e2e:
	cd apps/desktop/src-tauri && cargo build --features e2e-testing
	cd apps/desktop && PT_GATEWAY_PORT=3030 pnpm tauri dev --features e2e-testing
```

或通过现有 `desktop-dev.sh` 脚本添加 `e2e` mode 传递 `--features e2e-testing`。

### 6. Playwright 配置 + 测试脚本

**新目录**: `apps/desktop/e2e/`

- `playwright.config.ts` — 配置 `tauri` project mode
- `fixtures.ts` — `createTauriTest({ mcpSocket: '/tmp/tauri-playwright.sock' })`
- `tests/tauri-webview-cell.spec.ts` — 核心测试：
  1. 等待 Shell 加载
  2. 导航到 Chat 页
  3. 验证 `runtime === 'tauri-webview'`
  4. 右键 context-menu trigger 元素
  5. 等待 overlay telemetry 事件出现
  6. 提取 snapshot，验证 `overlay.visible` + `contextmenu.intent` + `interaction.started`
  7. 调用 `flush()` 确保事件上传 Station
  8. 写出 cell observation JSON

### 7. Acceptance 脚本

**新文件**: `tooling/scripts/desktop-tauri-webview-cell-e2e.py`

Wrapper：
1. 检查 Playwright socket 可达
2. 运行 `npx playwright test --project=tauri`
3. 读取产出的 observations JSON
4. 合并到 `desktop-performance-cell-observations.json`
5. 更新 cell preflight 状态

### 8. 关闭 sampler gate

```bash
# Mirror tauri-webview events from Station
python3 tooling/scripts/desktop-telemetry-mirror.py \
  --station-url $PT_STATION_URL \
  --query-account <test-account> \
  --runtime tauri-webview

# Re-run sampler gate
python3 tooling/scripts/desktop-performance-sampler-gate.py \
  --station-mirror-report tooling/acceptance/reports/desktop-performance-station-union.json \
  --required-runtime tauri-webview
```

---

## 验证

| 步骤 | 命令 | 期望 |
|------|------|------|
| 编译通过 | `cd apps/desktop/src-tauri && cargo build --features e2e-testing` | 无错误 |
| 启动显示 socket | `make desktop-e2e` → 观察 stdout | `[playwright] socket at /tmp/tauri-playwright.sock` |
| Playwright 连接 | `npx playwright test --project=tauri` | 测试 pass |
| 事件标签正确 | snapshot 中所有事件 `runtime === 'tauri-webview'` | true |
| Station 入库 | Mirror 查询 `--runtime tauri-webview` 有事件 | event_count > 0 |
| Sampler gate 通过 | `--required-runtime tauri-webview` → status: pass | 6/6 PROVEN |
| Production build 无膨胀 | `cargo build --release` 不含 plugin | binary size 不变 |

---

## 关键文件

- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/src/main.rs`
- `apps/desktop/e2e/` (新目录)
- `tooling/scripts/desktop-tauri-webview-cell-e2e.py` (新文件)
- `tooling/make/acceptance.mk`
- `tooling/acceptance/reports/desktop-performance-cells/tauri-webview.json`
