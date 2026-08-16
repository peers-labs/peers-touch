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

### 1.3 Runtime Provisioning 目标映射

> 本节与后续 Runtime Provisioning 影响面由已接受的 D-07 ~ D-10 约束。

| 当前输入或行为 | 当前问题 | 目标 Owner | 目标 artifact |
|---|---|---|---|
| `gates.yaml.environment` | 只有标签，没有 acquisition contract | Acceptance Provisioning Registry | environment contract |
| active `.local` Profile | 文件名与内部 identity 可漂移 | Local Dev Environment | validated profile identity |
| `make station` / `station-status` | 能 ready/check，但不产出 Gate 可消费的完整 attestation | Station deployment/runtime | station attestation |
| `CHAT_NATIVE_*_PTID` | 由调用方手工提供 | Chat Fixture | actor manifest |
| `CHAT_NATIVE_DEMO_PASSWORD` | 来源未声明且 runner 有默认值 | approved credential source | credential reference |
| `CHAT_NATIVE_STATION_ATTESTATION` | runner 只消费，没有生产者 | Station deployment/runtime | source-bound attestation artifact |
| `CHAT_NATIVE_STATION_URL` | Profile 与 Gate 使用不同变量 | Environment Provisioner | runtime manifest station URL |
| Gateway/Native ports | runner 局部计算，缺少统一 preflight record | Environment Provisioner + Driver | client isolation manifest |
| Gate failure text log | 缺少 source-bound preflight identity | Provisioner/Gate Runner | structured blocked artifact |

目标集成入口：

```text
gates.yaml
  -> environment contract
  -> profile validation
  -> service ready + attestation
  -> fixture actor manifest + credential references
  -> runtime resource manifest
  -> existing Gate command
  -> existing evidence validation
  -> cleanup audit
```

现有 Gate command 和产品断言保持稳定；变更的是 Gate 之前和之后的 runtime
orchestration。业务 Gate 不获得部署权限，也不读取 `.local` 的实现细节。

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
| `tooling/scripts/acceptance-run.py` | 架构扩展 | 按 environment contract 调用 Provisioner，区分 blocked 与 product failure |
| `tooling/scripts/local-dev/profile.sh` | 小改 | 激活前校验文件名与 `PT_DEV_PROFILE`，输出 resolved identity |
| `tooling/scripts/local-dev/station-status.sh` / deployment tooling | 架构扩展 | 由实际运行时生产 Station attestation |
| `tooling/acceptance/fixtures/chat_native_reset.py` | 重构 | 产出 actor manifest，声明 reset target、初始状态和 teardown |
| `tooling/acceptance/registry.yaml` | 契约修正 | receipt 等 receiver-visible 路径选择 Native two-client Gate |
| `tooling/skills/pt-acceptance-gap-detector/` | 新增只读守卫 | 检测遗漏并分派，不实施修复 |

### 2.2 不受影响的代码

- Station Go 代码（`apps/station/`）
- Desktop Rust 代码（`apps/desktop/src-tauri/`）
- 所有 proto 定义和生成代码（`model/`）
- Applet 业务代码
- Chat 产品业务逻辑；本设计不修复 `DELIVERED` receipt
- Gate 产品成功标准；不得因 provisioning 改造而降低
- CI/CD 调用的 Make target 名称

### 2.3 必须删除或禁止保留的旧路径

- Native runner 的默认密码。
- Agent 手工拼接 PTID、Station attestation 和 Station URL 的操作惯例。
- Profile identity mismatch 仍可激活的 silent path。
- 失败后仅输出 connection refused 且没有 runtime identity 的 preflight path。
- Receipt 变更只选择 Gateway Gate、依赖 Agent 手工追加 Native Gate 的 path。

不得以兼容为名保留“旧环境变量直传”和“runtime manifest”两套并行真源。
Native Chat 目标态只认 provisioning artifact；credential value 仅按 manifest
中的 CredentialRef 在进程环境中解析。

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
- **Core Runtime 已合并基线**：原 Core Runtime 通用化不要求 capability/domain/feature/registry/gates 迁移

以上保证只适用于已合并的 Core Runtime 通用化。Runtime Provisioning 扩展的目标
兼容边界如下：

- Gate ID、产品断言和 report 主路径保持稳定。
- Make target 名称保持稳定，但其执行从“只跑命令”升级为“provision → run → cleanup”。
- `gates.yaml.environment` 从描述字段升级为必须可解析的 contract key。
- 旧 ad-hoc 环境变量不是长期公共 API；迁移后由 runtime manifest 取代。
- 缺少 provisioning artifact 时行为从文本失败升级为结构化 `BLOCKED/UNPROVEN`，
  不得伪装为 Gate 产品失败。
