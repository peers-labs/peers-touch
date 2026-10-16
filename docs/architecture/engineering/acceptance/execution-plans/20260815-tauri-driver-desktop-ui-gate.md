# Acceptance Framework — Embedded WebDriver Desktop UI Gate Integration

> **Status**: complete
> **Version**: v1.0
> **Created**: 2026-08-15 | **Updated**: 2026-08-15
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`, `apps/desktop/e2e/`

---

## 1. 背景与目标

### 问题

现有 acceptance framework 的 Desktop 验证分两层：

1. **Contract 层 gates** — 通过 proto、Station package tests 和 Desktop check 验证静态/服务契约。
2. **DOM 层 gates**（`desktop_dom_message_visible.py`、`native_visible_e2e.py`）— 需要操作真实 WebView DOM。

DOM 层过去缺少可复现、可驱动任意内嵌 WKWebView 的 native transport。

### 目标

引入 **Tauri 官方文档推荐的 `tauri-plugin-wdio-webdriver`**（嵌入式 W3C WebDriver 服务器）作为 Desktop UI gate 的统一 driver，使 DOM 级验证可自动化、可复现、无需 agent 推断。

> **选型修正**: macOS 使用 `tauri-plugin-wdio-webdriver`，在测试
> binary 内启动 WebDriver server，Python Selenium 直接连接，不依赖外部
> Desktop driver 进程。

### 非目标

- 不重建 acceptance framework 架构（已有完整体系）
- 不重写 gateway 层 gates（已工作）
- 不替代 YAML contracts 和 domain onboarding 流程
- 不引入新的 TypeScript 测试框架（统一到 Python gate + embedded WebDriver）

---

## 2. 技术方案

### Architecture

```
┌────────────────────────────────────────────────────────┐
│  Python Gate (tooling/acceptance/gates/chat/*.py)       │
│    ↕ selenium (W3C WebDriver client)                   │
│  Embedded WebDriver server (inside Tauri app, :4445)   │
│    ↕ tauri-plugin-wdio-webdriver                       │
│  Tauri Native App (built with --features acceptance-   │
│    webdriver)                                           │
│    ↕ Tauri IPC                                         │
│  Rust BFF + Station                                    │
└────────────────────────────────────────────────────────┘
```

### 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| WebDriver 方案 | tauri-plugin-wdio-webdriver (嵌入式) | macOS 支持，无外部进程，官方推荐 |
| WebDriver client 语言 | Python (selenium) | 与现有 gates 一致 |
| Test framework | 保持现有 gate 脚本模式 | 不引入新 framework |
| Locator 策略 | `data-pt-*` 属性 | 已有约定，与 frontend telemetry 统一 |
| 双客户端 | 两个 app 实例（不同端口 4445/4446） | 各自嵌入 WebDriver |
| Performance automation | 仅保留 performance-only 文件 | 不用于 product Acceptance |
| Cargo feature | `acceptance-webdriver` (optional) | 不影响生产构建 |
| Global Tauri API | 仅 acceptance build 通过 `TAURI_CONFIG` 启用 | 保证 `window.__TAURI__` 可验收，不扩大生产构建暴露面 |

### 使用方式

```bash
# 前提：构建含 WebDriver 的 debug binary
python3 -m pip install -r tooling/acceptance/requirements.txt
make acceptance-driver-build

# Python gate 连接（app 自动启动内嵌 WebDriver on :4445）
from tooling.acceptance.drivers.tauri_webdriver import TauriDriver

with TauriDriver(port=4445) as td:
    nav = td.driver.find_element("css selector", "[data-pt-primary-nav]")
    td.driver.find_element("css selector", "[data-pt-conversation-item]").click()
```

---

## 3. 实施阶段

### Phase 1: 基础设施就绪

**目标**: 嵌入式 WebDriver 可构建、可连接、能获取页面元素

**涉及文件**:
- `apps/desktop/src-tauri/Cargo.toml`（新增 `tauri-plugin-wdio-webdriver` optional dep + `acceptance-webdriver` feature）
- `apps/desktop/src-tauri/src/main.rs`（注册 plugin behind `cfg(feature)`)
- `tooling/acceptance/drivers/tauri_webdriver.py`（新增：封装 app 启动 + selenium session）
- `tooling/acceptance/drivers/__init__.py`（新增：包声明）
- `tooling/acceptance/requirements.txt`（新增：selenium 依赖）
- `tooling/make/acceptance.mk`（新增 `acceptance-driver-build` / `acceptance-driver-smoke` targets）
- `pnpm-lock.yaml`（清理阻断 frozen install 的 Desktop importer 残留）

**步骤**:
1. ✅ 添加 `tauri-plugin-wdio-webdriver` 到 Cargo.toml（optional, feature-gated）
2. ✅ 注册 plugin 在 main.rs（`#[cfg(feature = "acceptance-webdriver")]`）
3. ✅ 创建 `tooling/acceptance/drivers/tauri_webdriver.py` — 启动 app + 连接 selenium
4. ✅ 添加 Make targets `acceptance-driver-build` / `acceptance-driver-smoke`
5. ✅ 修复 workspace lockfile 与 manifests 不一致，恢复 frozen install
6. ✅ 构建 binary 并运行 smoke test，验证 title、`tauri://localhost`、`#root` 和 `window.__TAURI__`

**验收标准**:
- `make acceptance-driver-build` 成功构建含 WebDriver 的 binary
- `make acceptance-driver-smoke` 能获取 Tauri app 的 DOM title、原生 URL 和根节点
- acceptance binary 中 `window.__TAURI__` 可用，默认生产配置仍保持关闭
- 嵌入式 WebDriver 在 macOS 上正常工作

**依赖**: Node.js + pnpm + Rust toolchain + cargo + Python dependencies

**完成证据 (2026-08-15)**:
- `pnpm install --frozen-lockfile --lockfile-only` — PASS
- `make acceptance-driver-build` — PASS
- `make acceptance-driver-smoke` 连续运行 3 次 — PASS
- 每次运行均使用独立动态 gateway 端口、临时 storage root 和 acceptance profile
- 每次运行均验证 title、`tauri://localhost`、`#root`、`window.__TAURI__`，并在退出后释放 4445

---

### Phase 2: DOM Gate 升级

**目标**: 单客户端 Chat DOM gate 使用真实 Tauri WKWebView 和 embedded WebDriver

**涉及文件**:
- `tooling/acceptance/gates/chat/desktop_dom_message_visible.py` — 重写
- `tooling/acceptance/drivers/tauri_webdriver.py` — 扩展 helper 方法
- `apps/desktop/src/utils/logger.ts` / `logger.test.ts` — 集中日志脱敏
- `apps/desktop/src-tauri/src/interface/tauri_commands/frontend_log.rs` — sink 防御性脱敏
- `tooling/acceptance/gates.yaml` / Chat feature contracts — native 环境登记

**步骤**:
1. **P2-0** 修复 frontend API log 明文记录 password/token 的根因，补 TS + Rust 测试
2. **P2-1** 扩展 `tauri_webdriver.py`：环境注入、隔离 profile/storage/gateway、稳定 renderer wait
3. **P2-2** 重写 `desktop_dom_message_visible.py`：Station 绑定 → login → sync → session row → message DOM
4. **P2-3** 使用 `http://192.0.2.30:18080` Acceptance Station，重置标准账号/临时数据
5. **P2-4** 更新 gate registry、feature contract 和 Make 环境语义
6. **P2-5** 运行单客户端 native DOM gate 并保存 screenshot、DOM、app log

**验收标准**:
- `desktop_dom_message_visible.py` 在真实 Tauri app 上 PASS
- evidence 明确记录 `tauri://localhost`、message ULID、正文和真实 app log
- app log 不包含 password/token/secret 原值
- 单客户端 gate 仅依赖 native Tauri embedded WebDriver

**依赖**: Phase 1 完成

**完成证据 (2026-08-15)**:
- `pnpm --dir apps/desktop exec vitest run src/utils/logger.test.ts` — PASS (3 tests)
- `cargo test ... frontend_log::tests --features acceptance-webdriver` — PASS
- `cargo test ... canonical_profile_ptid --features acceptance-webdriver` — PASS (3 tests)
- `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-desktop-dom` — PASS
- `tooling/acceptance/reports/chat-desktop-dom-message-visible.json` — native URL、相同 message ID/正文、双端 runtime metadata
- `tooling/acceptance/reports/evidence/chat-desktop-dom-message-visible-*` — Alice/Bob screenshot、DOM、app log
- evidence secret scan、4445/4446/native process release — PASS

---

### Phase 3: 双客户端 Gate

**目标**: 两个 Tauri app 实例同时运行，验证对端 UI 更新

**涉及文件**:
- `tooling/acceptance/drivers/tauri_webdriver.py` — 扩展双实例支持
- `tooling/acceptance/gates/chat/native_two_client_runner.py` — 两个 embedded WebDriver session
- `apps/desktop/src/services/messagingProjection.ts` — 接收端 badge projection
- `apps/desktop/src/components/AppSideNav.tsx` — stable badge DOM

**步骤**:
1. **P3-0** acceptance binary 支持 feature-gated embedded WebDriver 和 acceptance-only Tauri config
2. **P3-1** `tauri_webdriver.py` 支持两个 session（4445/4446）及独立 gateway/profile/storage
3. **P3-2** 以 Selenium-backed client 保留 bounded telemetry/report contract
4. **P3-3** Alice/Bob 使用标准账号登录，Alice UI 发送，Bob DOM 接收同一 message ULID/正文
5. **P3-4** 验证 Bob badge 出现、打开会话后消失及进程恢复
6. **P3-5** 前端按需补齐稳定 `data-pt-*` selector

**验收标准**:
- 两个 Tauri app 同时运行，各自可被 selenium 操作
- Alice send → Bob DOM 更新在 10s 内可观测
- Badge 出现/消失可通过 selector 验证
- `chat-native-two-client-e2e` 报告为 `DONE/PROVEN`
- 无旧 socket observer

**依赖**: Phase 2 完成

**完成证据 (2026-08-15)**:
- `python3 -m unittest ...native_visible_e2e_test ...native_visible_static_test` — PASS (7 tests)
- `pnpm --dir apps/desktop run check` — PASS
- `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-native-two-client` — PASS
- `tooling/acceptance/reports/chat-native-two-client-run.json` — `DONE/PROVEN`
- `tooling/acceptance/reports/chat-native-two-client-validation.json` — PASS
- Bob concurrent unread badge `1 -> 0`，首条/恢复消息均以 receiver DOM 同 ID/正文证明
- 双端 screenshot、DOM、app log、WebDriver/gateway/profile metadata 与 Station live commit 已记录
- secret scan、native process 和 4445/4446 release — PASS

---

### Phase 4: 清理与固化

**目标**: 移除旧 product Acceptance transport，更新 skill 和文档

**涉及文件**:
- `apps/desktop/e2e/` — 删除 product Acceptance 文件并标记 performance-only
- `tooling/skills/pt-dev-runtime-handoff/SKILL.md` — 最终更新
- `docs/architecture/engineering/acceptance/decisions.md` — 追加 ADR
- `docs/architecture/engineering/acceptance/README.md` — 更新导航
- Project memory — 更新选型决策

**步骤**:
1. **P4-0** 仅在 Phase 3 replacement gate PASS 后删除旧 socket plugin 和 feature
2. **P4-1** 删除 `apps/desktop/e2e/acceptance/` 过渡 TypeScript specs/helpers/contracts
3. **P4-2** 保留并明确标注 `apps/desktop/e2e/tests/` performance-only
4. **P4-3** 更新 `pt-dev-runtime-handoff` skill 和 Chat native playbook
5. **P4-4** 在 `decisions.md` 追加 embedded WebDriver ADR，更新 README/registry/contracts
6. **P4-5** 搜索清除 Desktop product Acceptance 中旧 driver、socket observer 和 browser-shell 引用

**验收标准**:
- 旧 product Acceptance plugin 和 feature 已移除
- Acceptance skill/playbook/gates 中无旧 socket transport 引用
- performance-only 文件有明确边界说明
- `make acceptance-chat-domain-validation` 从 driver 启动到 report 输出全链路通

**依赖**: Phase 3 完成

**完成证据 (2026-08-15)**:
- 旧 product Acceptance Cargo plugin/feature 从 `Cargo.toml` / `Cargo.lock` 删除
- `apps/desktop/e2e/acceptance/`、dual socket fixture 和旧 socket runner 删除
- `apps/desktop/e2e/tests/`、fixtures、config 均明确标注 performance-only
- `pnpm ls @srsholmes/tauri-playwright --depth 0` — empty
- `cargo check --features acceptance-webdriver` — PASS
- Chat feature/capability/registry 仅绑定 embedded WebDriver static + two-client Gates
- `pt-dev-runtime-handoff`、Chat playbook、ADR D-07、README 更新完成
- Acceptance plan self-check、Chat domain structural validation、native static tests — PASS

---

## 4. 实施状态

| Phase | 状态 | 完成日期 | 备注 |
|-------|------|---------|------|
| Phase 1: 基础设施就绪 | ✅ complete | 2026-08-15 | Build PASS；严格 smoke 连续 3 次 PASS |
| Phase 2: DOM Gate 升级 | ✅ complete | 2026-08-15 | 单客户端 native DOM Gate、脱敏测试、registry/contracts/evidence PASS |
| Phase 3: 双客户端 Gate | ✅ complete | 2026-08-15 | 并发同 ID/正文、badge `1 -> 0`、receiver restart recovery `DONE/PROVEN` |
| Phase 4: 清理与固化 | ✅ complete | 2026-08-15 | 旧 product Acceptance transport 删除；performance-only 边界与文档固化 |

---

## 5. 最终完成证据

- `pnpm install --frozen-lockfile` — PASS
- `pnpm --dir apps/desktop run check` — PASS
- `pnpm --dir apps/desktop run test` — PASS (285 passed, 1 skipped)
- `pnpm --dir apps/desktop run build` — PASS
- Python compile + native static tests — PASS (7 tests)
- Rust frontend log redaction + canonical profile PTID tests — PASS
- `make acceptance-driver-build` — PASS
- `make acceptance-driver-smoke` 连续 3 次 — PASS
- `CHAT_ACCEPTANCE_RESET=1 ... make acceptance-chat-domain-validation` — PASS
- `tooling/acceptance/reports/chat-desktop-dom-message-visible.json` — PASS
- `tooling/acceptance/reports/chat-native-two-client-run.json` — `DONE/PROVEN`
- `tooling/acceptance/reports/chat-native-two-client-validation.json` — PASS
- `tooling/acceptance/reports/chat-validation.json` — 8 capabilities `PROVEN`
- added-line secret/debug scan、report secret scan、`git diff --check` — PASS
- native process、4445/4446、temporary WebDriver storage release — PASS

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| tauri-plugin-wdio-webdriver 与锁定的 Tauri 2.10.3 兼容性 | 编译失败或运行时 crash | 锁定 plugin 版本 1.3.0，并执行 feature build smoke |
| 前端 `data-pt-*` 属性覆盖不全 | DOM gate fail | Phase 2/3 中按需补 |
| 双实例端口冲突 | Phase 3 卡住 | 明确分配端口 4445/4446 via env var |
| acceptance-webdriver feature 意外泄漏到 release | 生产安全风险 | CI 验证 release 无此 feature |

---

## 7. 验证方式

最终完成标准：

```bash
# 依赖与静态质量
pnpm install --frozen-lockfile
cd apps/desktop && pnpm run check && pnpm run test && pnpm run build

# 原生 driver 与 Chat 全链路
make acceptance-driver-build
make acceptance-driver-smoke
CHAT_ACCEPTANCE_RESET=1 \
  CHAT_DESKTOP_DOM_STATION_URL=http://192.0.2.30:18080 \
  CHAT_NATIVE_STATION_URL=http://192.0.2.30:18080 \
  make acceptance-chat-domain-validation

# 预期结果：
# - gateway gates: PASS (已有)
# - DOM gates: PASS (embedded WebDriver)
# - dual-client gate: PASS (embedded WebDriver × 2)
# - report 输出到 tooling/acceptance/reports/
```

附加完成审计：
- `git diff --check` PASS
- Desktop product Acceptance 路径无旧 driver、socket observer 或 browser-shell 遗留
- app log / reports 不包含 password、token、secret 原值
- 4445/4446、gateway ports、native processes、temporary storage 均无泄漏
