# Applet Runtime Formalization Execution Plan

> **Status**: superseded
> **Date**: 2026-06-06
> **Owner**: Architecture Team
> **Scope**: SDK architecture, runtime architecture, service architecture, multi-platform support
> **Superseded by**: [`2026-06-23-applet-capability-completion-plan.md`](./2026-06-23-applet-capability-completion-plan.md)

> This document is archived as historical context. Do not use it as the active
> execution source for new applet capability work.

---

## 1. Upgrade Goal

本计划把已有 Applet 设计和部分实现升级为正式架构闭环：

- SDK API 面参考微信小程序的能力域，但按 Peers-Touch Host Gateway 重建。
- Runtime 支持 Desktop、Android、iOS、HarmonyOS reserved、Web。
- Service 层明确 Station Applet Store、Host Gateway、Platform Handler 的职责。
- 执行顺序按依赖拓扑推进，而不是按端或页面推进。
- 首个有价值里程碑不是 hello applet，而是 Desktop 能承载复杂 applet：Lynx UI、service binding、skills、agent/AI、streaming/task、Gateway allow/deny、audit。

---

## 2. Domain Responsibilities

| Domain | Responsibility | Primary Deliverables |
|--------|----------------|----------------------|
| Contract | Manifest、Bridge、Capability、Error、Lifecycle 的稳定类型 | `packages/applet-contract` types + schemas |
| SDK | Applet 业务代码唯一依赖的能力入口 | `packages/applet-sdk` public API |
| Runtime Host | 各端容器、Bridge endpoint、session lifecycle | Desktop LynxHost, Mobile LynxView, Web Host |
| Gateway | 权限、参数校验、审计、handler dispatch | Rust/Kotlin/Swift/Web Gateway |
| Station Store | 分发、版本、策略、撤回、审计上报 | `applet_store` subserver |
| Tooling | 创建、开发、测试、打包、发布 applet 的正式流水线 | `applet-create/dev/test/package/publish` CLI |
| Verification | Contract tests and platform smoke tests | CI scripts and runtime test fixtures |

---

## 3. Lifecycle Closure

```text
Developer builds applet
  → Contract validates manifest
  → SDK simulate runtime validates capability contract
  → Package tool generates bundle integrity
  → Station stores package and policy
  → Host syncs catalog
  → Host verifies integrity
  → Runtime creates session
  → SDK reports ready
  → Applet invokes capability
  → Gateway authorizes and audits
  → Handler executes
  → Station receives audit and policy feedback
```

如果某个模块不能在这条闭环中定位，就不应进入首批正式架构。

---

## 4. Dependency Order

> Task-level implementation source: [`2026-06-06-complex-applet-implementation-plan.md`](./2026-06-06-complex-applet-implementation-plan.md).
> This formalization plan defines architecture phase intent; the complex implementation plan defines AI-executable workstreams, write scopes, commands, and pass/fail cases.

### Phase 0: Contract Freeze

交付：

- `TargetPlatform` 扩展到 `desktop | android | ios | harmony | web`。
- 明确 `standalone` 是 applet 集合单体的独立运行出口，但不是 Peers-Touch integrated 生产 platform。
- `CapabilityMethod` 覆盖 MVP API 面。
- 首批 contract 覆盖复杂 applet 必需项：`services`、`skills`、`tasks`、`streams`、`agent`、`ai`、`telemetry` permissions。
- Error code 与 lifecycle state 补齐。
- JSON Schema 生成并提交。

验收：

- Desktop、SDK、Mobile 可消费同一 contract。
- 非法 manifest 在构建期和运行期都会失败。

### Phase 1: SDK Public Surface

交付：

- `PeersAppletSDK` 公开 API。
- `LynxBridgeAdapter`、`WebHostBridgeAdapter`、`StandaloneBridgeAdapter`。
- typed errors。
- event bus。
- `skills.register/list/invoke/onStream`。
- `tasks.start/get/cancel/onEvent`。
- `agent.startSession/send/stream`。
- `ai.generate/chat`。
- `telemetry.track/reportError/mark`。
- `packages/applet-runtime-simulate` contract test runtime。

验收：

- Applet 源码不直接访问 NativeModules。
- SDK 在 Desktop Lynx for Web、Mobile LynxView、Web Host 三种桥接下语义一致。
- `network.request`、`storage.*`、`ui.*`、`system.*` 的 allow/deny case 可在 simulate runtime 中测试。
- `skills`、`tasks`、`agent/ai`、`telemetry` 的 allowed/denied/stream/cancel case 可在 simulate runtime 中测试。

### Phase 1.5: Applet Development Tooling

交付：

- `applet-package`：接收任意符合 contract 的 applet bundle，生成 package metadata、integrity file。
- `applet-dev-attach`：让 Desktop/Web/Mobile Host 加载本地 applet package 或 dev bundle。
- `applet-test`：运行 manifest validation、typecheck、SDK contract tests。
- `applet-create`：从 contract template 创建 Peers-Touch native applet。

验收：

- 任意来源的 applet 只要产出 canonical package，即可被 Desktop Host 读取。
- applet package format 与未来 Station Store package format 一致。
- Standalone 是 applet 自己的独立出口；Peers-Touch integrated release gating 必须跑 Host attach 或 simulate Gateway。

### Phase 2: Desktop Complex Runtime Closure

交付：

- Desktop `<lynx-host>` session/lifecycle 补齐。
- Desktop package reader 支持 complex applet manifest。
- Desktop Gateway minimal complex slice：service binding resolver、skill registry、stream dispatcher、task lifecycle、AI/agent policy hooks。
- Desktop Skill Registry UI/dispatch。
- Desktop stream/task event bridge。
- Desktop service binding resolution。
- Desktop Gateway audit writer。

验收：

- 一个 conforming complex applet package 在 Desktop integrated runtime 中运行。
- Lynx UI 渲染、lifecycle/reportReady 成功。
- skill 可发现、可调用、可被 policy 拒绝。
- agent/AI streaming event 可到达 Host UI。
- long-running task 可 start/progress/cancel/fail/complete。
- service/network 调用只通过 Gateway。
- session destroy 后 invoke 返回 `INVALID_SESSION`。

### Phase 2.5: Web and Mobile Runtime Parity

交付：

- Android/iOS `AppletContainerView` 与 BridgeDispatcher 对齐。
- Web Host runtime 定义并实现基础容器。
- HarmonyOS 保留 manifest 与 adapter guard。

验收：

- 同一个 contract test package 在 Android、iOS、Web 跑通基础 lifecycle/Bridge/Gateway。
- HarmonyOS target 被识别但在未实现时明确拒载。
- 多端 parity 不阻塞 Phase 2 Desktop complex acceptance，但阻塞平台级发布。

### Phase 3: Gateway and Service Policy Hardening

交付：

- capability registry。
- permission matrix。
- parameter validation。
- audit writer。
- network allowlist。
- storage quota。
- service binding resolver hardening。
- skill registry hardening。
- stream dispatcher hardening。
- task lifecycle and cancellation hardening。
- AI/agent quota and policy hook hardening。

验收：

- 未授权调用失败。
- 每次 allowed/denied invoke 都有 audit。
- network 不暴露 token。
- streaming event 有 request/task id 且可取消。
- long-running task 有终态。
- agent/AI 不暴露 provider key、internal prompt、tool executor。

### Phase 4: Station Store Integration

交付：

- package registry。
- bundle storage。
- version channel。
- policy distribution。
- kill switch。
- audit ingestion。
- `applet-publish`：上传 package、policy snapshot、rollback target。

验收：

- Host 能从 Station 同步 catalog。
- integrity 失败拒载。
- Station revoke 后 Host 不创建新 session。
- local package install 与 Station package install 复用同一 package reader。

### Phase 5: First Complex Conforming Package Acceptance

交付：

- 选择一个 conforming complex applet package 作为验收样本。
- 验收样本使用 `@peers-touch/applet-sdk` 调用 network/storage/ui/system/skills/tasks/agent/ai/telemetry。
- Desktop 完成 complex acceptance。
- Mobile、Web 完成 parity smoke，或者明确记录阻塞项。

验收：

- Integrated package 无 DOM/iframe/postMessage 依赖。
- 所有敏感能力走 Gateway。
- skills、agent/AI、streaming/task、service binding、audit 都有 allowed 和 denied case。
- 跨端显示和生命周期事件一致；复杂能力 parity 按 Gate H 升级。

---

## 5. Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Lynx for Web in Tauri compatibility | Desktop runtime block | POC before feature migration; keep WebHostRenderer as non-iframe contingency |
| Mobile native Lynx SDK drift | Android/iOS behavior mismatch | Contract tests around Bridge envelope and lifecycle |
| SDK API over-expansion | Hard to stabilize | MVP method whitelist; high-risk capabilities require ADR |
| Web Host mistaken as standalone | Security regression | Formal Web Host requires Gateway, session, audit; standalone remains a separate non-integrated outlet |
| Station Store delayed | Local-only runtime cannot distribute safely | Phase 2 can use local packages, Phase 4 gates production distribution |
| Runtime design mistaken for platform completeness | Applet ecosystem cannot scale beyond POC | Tooling CLI, package format, simulate runtime, publish/install/rollback are explicit deliverables |
| Hello applet mistaken for useful acceptance | Complex applet cannot run | Phase 2 and Phase 5 require complex applet capabilities: skills, tasks, agent/AI, streaming, service binding, audit |

---

## 6. Acceptance Checklist

- SDK API 面有稳定能力域和 MVP 方法清单。
- Runtime 文档覆盖 Desktop、Android、iOS、HarmonyOS reserved、Web。
- 服务架构明确 Station、Host Gateway、Platform Handler 边界。
- Manifest/Bridge/Capability/Error/Lifecycle 有统一 contract。
- 执行计划按依赖顺序推进。
- 每个阶段有可验证交付物。
- conforming complex applet package 能跑通 Peers-Touch integrated runtime；验收重点是 Peers-Touch contract、SDK、Bridge、Gateway、service binding、skills/tasks/agent/AI、audit、package reader，而不是 package producer 的目录形态。
