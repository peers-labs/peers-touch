# Acceptance Framework — tauri-driver Desktop UI Gate Integration

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-08-15 | **Updated**: 2026-08-15
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`, `apps/desktop/e2e/`

---

## 1. 背景与目标

### 问题

现有 acceptance framework 的 Desktop 验证分两层：

1. **Gateway 层 gates**（`desktop_gateway_e2e.py` 等）— 通过 HTTP API 验证后端逻辑。✅ 已工作。
2. **DOM 层 gates**（`desktop_dom_message_visible.py`、`native_visible_e2e.py` 等）— 需要操作真实 WebView DOM。❌ 缺少稳定的 driver。

DOM 层过去尝试过：
- Playwright + `@srsholmes/tauri-playwright`（社区小众包，socket 机制未通）
- Computer Use + 坐标猜测（不可复现，已放弃）

### 目标

引入 **Tauri 官方 `tauri-driver`**（WebDriver 协议 + safaridriver）作为 Desktop UI gate 的统一 driver，使 DOM 级验证可自动化、可复现、无需 agent 推断。

### 非目标

- 不重建 acceptance framework 架构（已有完整体系）
- 不重写 gateway 层 gates（已工作）
- 不替代 YAML contracts 和 domain onboarding 流程
- 不引入新的 TypeScript 测试框架（统一到 Python gate + tauri-driver）

---

## 2. 技术方案

### Architecture

```
┌────────────────────────────────────────────────────────┐
│  Python Gate (tooling/acceptance/gates/chat/*.py)       │
│    ↕ WebDriver client (selenium / webdriver-manager)    │
│  tauri-driver (cargo binary, port 4444)                 │
│    ↕ safaridriver (macOS WKWebView)                     │
│  Tauri Native App (make desktop debug binary)           │
│    ↕ Tauri IPC                                          │
│  Rust BFF + Station                                     │
└────────────────────────────────────────────────────────┘
```

### 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| WebDriver client 语言 | Python (selenium) | 与现有 gates 一致 |
| Test framework | 保持现有 gate 脚本模式 | 不引入新 framework |
| Locator 策略 | `data-pt-*` 属性 | 已有约定，与 frontend telemetry 统一 |
| 双客户端 | 两个 tauri-driver 进程（不同端口） | 各连一个 worktree binary |
| Playwright | 移除或标记 legacy | 不用于 acceptance |

### tauri-driver 使用方式

```bash
# 前提
cargo install tauri-driver
safaridriver --enable  # macOS 一次性

# 启动
tauri-driver --port 4444 &

# Python gate 连接
from selenium import webdriver
from selenium.webdriver.common.options import ArgOptions

options = ArgOptions()
options.set_capability("tauri:options", {
    "application": "./apps/desktop/src-tauri/target/debug/peers-touch-desktop"
})
driver = webdriver.Remote(
    command_executor="http://localhost:4444",
    options=options,
)

# 操作 DOM
nav = driver.find_element("css selector", "[data-pt-primary-nav]")
driver.find_element("css selector", "[data-pt-conversation-item]").click()
```

---

## 3. 实施阶段

### Phase 1: 基础设施就绪

**目标**: tauri-driver 可启动、可连接、能获取页面元素

**涉及文件**:
- `Makefile`（新增 `make acceptance-driver-start` target）
- `tooling/acceptance/drivers/tauri_webdriver.py`（新增：封装 tauri-driver 生命周期 + selenium session）
- `requirements.txt` 或 `pyproject.toml`（新增 selenium 依赖）

**步骤**:
1. `cargo install tauri-driver` 加入开发环境前提
2. 创建 `tooling/acceptance/drivers/tauri_webdriver.py` — 封装启动 tauri-driver、创建 session、关闭的生命周期
3. 添加 Make target `acceptance-driver-start` / `acceptance-driver-stop`
4. 写 smoke test：启动 app → 连接 → 获取 `document.title` → 断言

**验收标准**:
- `make acceptance-driver-start` 成功启动 tauri-driver
- Smoke test 脚本能获取 Tauri app 的 DOM title
- `make acceptance-driver-stop` 能干净终止

**依赖**: `make desktop` 的 debug binary 存在

---

### Phase 2: DOM Gate 升级

**目标**: 现有 DOM 级 gates 改用 tauri-driver 替代手动/Computer Use

**涉及文件**:
- `tooling/acceptance/gates/chat/desktop_dom_message_visible.py` — 重写
- `tooling/acceptance/gates/chat/native_visible_e2e.py` — 重写
- `tooling/acceptance/gates/chat/native_visible_runner.py` — 重写
- `tooling/acceptance/drivers/tauri_webdriver.py` — 扩展 helper 方法

**步骤**:
1. 在 `tauri_webdriver.py` 中封装常用操作：`login()`, `wait_for_ready_shell()`, `navigate_to()`, `find_by_pt_attr()`
2. 重写 `desktop_dom_message_visible.py`：login → navigate chat → send via gateway → 断言 DOM 中出现 `[data-pt-message-item]`
3. 重写 `native_visible_e2e.py`：完整的 native UI E2E（login → chat → send → receive UI update）
4. 确保 `make acceptance-chat-domain-validation` 能触发这些 gates

**验收标准**:
- `desktop_dom_message_visible.py` 在真实 Tauri app 上 PASS
- `native_visible_e2e.py` 在真实 Tauri app 上 PASS
- 无 Playwright / Computer Use 依赖

**依赖**: Phase 1 完成

---

### Phase 3: 双客户端 Gate

**目标**: 两个 Tauri app 实例同时运行，验证对端 UI 更新

**涉及文件**:
- `tooling/acceptance/drivers/tauri_webdriver.py` — 扩展双实例支持
- `tooling/acceptance/gates/chat/native_two_client_runner.py` — 升级使用 tauri-driver

**步骤**:
1. `tauri_webdriver.py` 支持创建多个 driver session（port 4444 + 4445）
2. 每个 session 连接不同 worktree 的 debug binary
3. 升级 `native_two_client_runner.py`：Alice 发消息 → Bob 的 DOM 中出现新消息 → badge 更新验证
4. 前端补 `data-pt-badge` / `data-pt-message-item` 属性（如缺失）

**验收标准**:
- 两个 Tauri app 同时运行，各自可被 selenium 操作
- Alice send → Bob DOM 更新在 10s 内可观测
- Badge 出现/消失可通过 selector 验证

**依赖**: Phase 2 完成 + 两个 worktree 可同时 `make desktop`

---

### Phase 4: 清理与固化

**目标**: 移除 Playwright 遗留，更新 skill 和文档

**涉及文件**:
- `apps/desktop/e2e/` — 删除 Playwright acceptance 文件或标记 performance-only
- `tooling/skills/pt-dev-runtime-handoff/SKILL.md` — 最终更新
- `docs/architecture/acceptance-framework/decisions.md` — 追加 ADR
- `docs/architecture/acceptance-framework/README.md` — 更新导航
- Project memory — 更新选型决策

**步骤**:
1. 删除 `apps/desktop/e2e/acceptance/` 下今天创建的 TypeScript 文件（contract.schema.ts, auth.spec.ts, chat.spec.ts, helpers.ts 等）
2. 保留 `apps/desktop/e2e/tests/` 下的 performance spec（如需要后续迁移再另议）
3. 更新 `pt-dev-runtime-handoff` skill：指向 `make acceptance-chat-domain-validation`
4. 在 `decisions.md` 追加 ADR：选择 tauri-driver 而非 Playwright 的理由
5. 更新项目 README 导航

**验收标准**:
- `pnpm ls @srsholmes/tauri-playwright` 返回空（已移除）
- Skill 中无 Playwright 引用
- `make acceptance-chat-domain-validation` 从 driver 启动到 report 输出全链路通

**依赖**: Phase 3 完成

---

## 4. 实施状态

| Phase | 状态 | 完成日期 | 备注 |
|-------|------|---------|------|
| Phase 1: 基础设施就绪 | ⬜ pending | — | |
| Phase 2: DOM Gate 升级 | ⬜ pending | — | |
| Phase 3: 双客户端 Gate | ⬜ pending | — | |
| Phase 4: 清理与固化 | ⬜ pending | — | |

---

## 5. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| safaridriver 在 CI 环境需要权限 | CI 无法跑 DOM gate | 本地验收 + CI 只跑 gateway gates |
| tauri-driver 版本与 Tauri v2 兼容性 | 连接失败 | 锁定 tauri-driver 版本，与 Tauri CLI 版本对齐 |
| 前端 `data-pt-*` 属性覆盖不全 | DOM gate fail | Phase 2/3 中按需补 |
| 双 tauri-driver 进程端口冲突 | Phase 3 卡住 | 明确分配端口 4444/4445 |

---

## 6. 验证方式

最终完成标准：

```bash
# 全链路验证命令
make acceptance-chat-domain-validation

# 预期结果：
# - gateway gates: PASS (已有)
# - DOM gates: PASS (new, via tauri-driver)
# - dual-client gates: PASS (new, via tauri-driver × 2)
# - report 输出到 tooling/acceptance/reports/
```
