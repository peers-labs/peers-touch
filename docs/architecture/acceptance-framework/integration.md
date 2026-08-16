# Acceptance Framework Core Runtime — 集成与迁移

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-08-15 | **Updated**: 2026-08-16
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/core/`

---

## 1. 与现有模块的映射

### 1.1 现有代码迁移路径

| 当前位置 | 目标位置 | 迁移内容 |
|---------|---------|---------|
| `tooling/acceptance/drivers/tauri_webdriver.py` | `tooling/acceptance/drivers/tauri.py` | 重构 TauriDriver 继承 DomDriver；消费者迁移后删除旧入口 |
| `tooling/acceptance/drivers/__init__.py` | `tooling/acceptance/drivers/__init__.py` | 更新导出，保留旧 import 路径别名以兼容 |
| `tooling/acceptance/gates/chat/desktop_dom_message_visible.py` (L40-L41) `GateError` | `tooling/acceptance/core/errors.py` | GateError 统一到 core，各 Gate 导入使用 |
| `tooling/acceptance/gates/chat/desktop_dom_message_visible.py` (L93-L114) `async_harness` | `tooling/acceptance/core/harness.py` | 抽取通用 JS harness 桥接，支持命名空间 |
| `tooling/acceptance/gates/chat/desktop_dom_message_visible.py` (L193-L204) `copy_app_log/save_dom` | `tooling/acceptance/core/gate.py` AcceptanceGate 基类方法 | 证据保存统一到基类 |
| `tooling/acceptance/gates/dashboard/federation_visible_surface.py` (L51-L154) `CDPSession` | `tooling/acceptance/drivers/chrome.py` | WS5 将 Dashboard 消费者迁移到 Selenium ChromeDriver；完成前保留为未完成项，不声称已抽取 |
| `tooling/acceptance/gates/chat/desktop_dom_message_visible.py` (L44-L68) `gateway_command` | `tooling/acceptance/drivers/station.py` | 抽取 Station HTTP API 客户端 |
| `apps/desktop/src/acceptance/chatAcceptanceHarness.ts` | `apps/desktop/src/acceptance/chat/harness.ts` | Chat Harness 改为注册模式，迁移到子目录 |
| `apps/desktop/src/main.tsx` (L44-L48) 硬编码导入 | `apps/desktop/src/acceptance/registry.ts` 自动注册 | 通用 Harness 注册机制 |
| `tooling/scripts/applet-desktop-lifecycle-smoothness-gate.mjs` 等 | `tooling/acceptance/gates/applet/*.py` wrapper | Applet MJS 脚本通过 Python wrapper 接入 |

### 1.2 保持不变的部分

以下内容在本次重构中**完全保持不变**：
- `capabilities/*.yaml`、`domains/*.yaml`、`features/*.yaml` — YAML 契约层
- `registry.yaml`、`gates.yaml` — 路径映射和 Gate 目录
- `tooling/scripts/acceptance-*.py` — plan/run/validate/report 核心脚本
- Chat/Dashboard/Federation Gates 的业务逻辑
- 前端业务代码（runtime、service、store、components）
- 所有 Make targets 和对外命令行接口

---

## 2. 影响面分析

### 2.1 受影响的现有代码

| 模块 | 改动程度 | 说明 |
|------|---------|------|
| `tooling/acceptance/gates/chat/*.py` | 中度重构 | 继承 AcceptanceGate，删除重复样板代码，业务逻辑不变 |
| `tooling/acceptance/gates/dashboard/*.py` | 中度重构 | 使用 ChromeDriver，删除自建 CDPSession，业务逻辑不变 |
| `tooling/acceptance/gates/desktop/gateway_smoke.py` | 中度重构 | 使用 StationDriver + ChromeDriver，删除手写 gateway_command 和 Tauri mock |
| `tooling/acceptance/drivers/tauri_webdriver.py` | 重命名+重构 | 已移动到 tauri.py 并删除旧入口 |
| `apps/desktop/src/acceptance/` | 重构 | 新增 registry.ts，chatAcceptanceHarness.ts 移动并改为注册模式 |
| `apps/desktop/src/main.tsx` | 小改 | 改为动态 import registry 而非硬编码 chat harness |
| `tooling/scripts/applet-*.mjs` | 小改 | 增加 `--json` 输出 flag，核心逻辑不变 |

### 2.2 不受影响的代码

- Station Go 代码（`apps/station/`）
- Desktop Rust 代码（`apps/desktop/src-tauri/`）
- 所有 proto 定义和生成代码（`model/`）
- Applet 业务代码
- CI/CD 脚本（只调用 Make targets，接口不变）

---

## 3. 迁移策略

采用**增量迁移，每次重构后所有 Gates 必须保持 PASS**：

### Phase 1: Core 层创建 + TauriDriver 重构
1. 创建 `core/` 目录结构，实现 BaseDriver、AcceptanceGate、BaseFixture、Evidence Schema
2. 将 `tauri_webdriver.py` 重构为继承 DomDriver 的 `drivers/tauri.py`，迁移所有消费者后删除旧入口
3. 重构 Chat Gates 继承 AcceptanceGate，删除重复的 GateError/async_harness/save_dom
4. 运行所有 Chat Gates 验证 PASS：
   - `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-domain-validation`

### Phase 2: ChromeDriver + StationDriver + Dashboard/Desktop Gates
1. ChromeDriver 实现 DomDriver；StationDriver 只实现 BaseDriver 生命周期
2. 抽取 StationAPIDriver，实现 HTTP 调用封装
3. 重构 Dashboard federation_visible_surface 和 desktop gateway_smoke 使用新 Driver
4. 运行所有 Dashboard/Federation Gates 验证 PASS：
   - `make acceptance-station-dashboard-domain-validation`

### Phase 3: 前端 Harness Registry + Applet Wrapper
1. 实现前端 acceptance registry 机制
2. 迁移 Chat Harness 为注册模式，保持方法路径兼容
3. 为 Applet MJS 脚本创建 Python wrapper gates
4. 运行 Applet Gates 验证 PASS：
   - `make acceptance applet-domain-validation`（新增）

### Phase 4: Mobile Driver + 扩展
1. 实现 MobileTauriDriver（Android 优先）
2. 注册 Mobile domain 到 domains/index.yaml
3. 补充 Mobile 基础 smoke gate

---

## 4. 兼容性保证

- **Gate 命令行接口保持不变**：所有 `python3 tooling/acceptance/gates/<domain>/<scenario>.py` 继续工作
- **报告路径保持不变**：`tooling/acceptance/reports/*.json` 输出位置不变
- **Make targets 保持不变**：所有 `make acceptance-*` 命令继续工作
- **Driver 单一入口**：统一使用 `tooling.acceptance.drivers.tauri`；不保留兼容 re-export
- **YAML 契约完全不变**：capability/domain/feature/registry/gates 不需要修改
