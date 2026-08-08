# Peers-Touch Applet Development and Runtime Readiness Report

> **Status**: draft
> **Version**: v1.1
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Scope**: Whether the current applet runtime design can support applet development and runtime execution in Peers-Touch

---

## 1. 结论

当前设计 **可以作为 Peers-Touch 小程序开发与运行的目标架构**，但当前实现 **不能直接判定为已经足够支撑**。

本报告的结论必须由后文的 verification gates 证明。没有证据表、测试命令、失败用例和运行日志，任何 AI 或人工评审都不能仅凭本文档描述宣称“已经足够支撑”。

准确判断：

| 维度 | 判断 | 说明 |
|------|------|------|
| 小程序开发 | **目标架构能支撑；当前实现待验证** | applet producer 可自行选择开发工具，只要使用 Peers-Touch SDK 并产出符合 `applet-contract` 的 package |
| 小程序运行 | **目标架构能支撑；当前实现待验证** | Peers-Touch Host 可按 manifest / bundle / integrity / Bridge / Gateway 加载并治理 package |
| 当前实现成熟度 | **不能直接算可用** | Contract、Bridge envelope、SDK complex surface、Gateway policy、package reader、Web/Mobile Host 仍未闭环 |
| 首个有价值里程碑 | **必须是复杂 applet Desktop acceptance** | 仅 hello applet / bundle render 没有平台价值；首批验收必须覆盖 skills、agent/AI、streaming/task、service binding、Gateway allow/deny、audit |
| 长期生态 | **需要补平台工程** | 需要 package validation、simulate runtime、publish/install、audit/rollback、cross-host parity |

一句话：

> **这个设计方向可以支撑 Peers-Touch 小程序开发与运行；但是否已经足够支撑复杂 applet，只能由 Contract → SDK → Package → Host → Bridge → Gateway → Service/Skill/Agent → Audit 的 verification gates 判定。**

---

## 2. 开发模型是否成立

成立。

Peers-Touch 不应该规定 applet producer 使用什么 IDE、脚手架、monorepo、bundler 上层封装或业务目录结构。Peers-Touch 只定义三件事：

1. **开发时能力入口**：`@peers-touch/applet-sdk`
2. **提交时产物契约**：`applet-contract`
3. **运行时治理边界**：Host Runtime + Capability Gateway

标准开发链路应为：

```text
Applet producer chooses tools
  → imports @peers-touch/applet-sdk
  → declares manifest permissions and target platforms
  → builds ReactLynx bundle
  → produces applet package
  → validates package against applet-contract
  → submits / installs into Peers-Touch
```

这满足用户定义的开发方式：

- 开发能力来自 Peers-Touch SDK。
- 开发工具由 applet producer 自行选择。
- Peers-Touch 不反向依赖 producer 的仓库结构。
- 只要 package contract 一致，Host 不关心 package 从哪里来。

### 2.1 SDK 能力是否足够

作为首批 MVP，设计中的 SDK 能力基本够支撑普通 applet：

| 能力域 | 是否必须首批 | 用途 |
|--------|--------------|------|
| `app.getContext` | 是 | 获取 applet id、session、launch params、host info |
| `lifecycle.reportReady/onShow/onHide/onDestroy` | 是 | applet 与 Host 生命周期闭合 |
| `network.request` | 是 | 访问被 policy 允许的业务服务 |
| `storage.get/set/remove/clear/getInfo` | 是 | per-applet local state |
| `config.get` | 是 | 读取 Host / Station 下发的只读配置 |
| `system.getInfo/getTheme/getNetworkType` | 是 | 适配端环境 |
| `ui.showToast/showLoading/hideLoading/showModal` | 是 | 由 Host 呈现系统 UI |
| `events.on/subscribe/unsubscribe` | 是 | Host 事件和业务事件订阅 |
| `invoke<T>()` | 是 | 新 capability 的扩展入口 |

暂不应首批承诺：

- file/media/share。
- camera/microphone/location/contacts。
- payment/ads/cloud equivalents。
- 任意原生平台私有 API。

这些能力风险高，必须后续按 ADR 独立评估。

### 2.2 SDK 提供方式是否正确

正确，但需要坚持两个原则：

- SDK 是 importable package，不做全局 `wx` 风格对象作为主入口。
- SDK 是 typed client，不执行权限，不持有 token，不直接调用 Host 私有 API。

推荐边界：

```text
Applet source
  → @peers-touch/applet-sdk
  → BridgeAdapter
  → Host Bridge
  → Capability Gateway
```

SDK 负责：

- typed API。
- typed error。
- adapter selection。
- response unwrap。
- lifecycle/event client。

SDK 不负责：

- permission final decision。
- network token injection。
- Station internal API access。
- storage namespace enforcement。
- audit truth。

---

## 3. 运行模型是否成立

成立。

Peers-Touch 要运行别人或自己开发的 applet，核心不是识别 producer，而是识别 package contract。

标准运行链路应为：

```text
Applet package
  → Host validates manifest
  → Host verifies integrity
  → Host checks platform support
  → Host creates applet session
  → Host creates Lynx runtime container
  → SDK detects Bridge
  → applet calls SDK
  → Bridge sends invoke envelope
  → Gateway validates session / permission / params
  → Platform handler executes
  → Gateway audits result
  → SDK receives typed response
```

这条链路能支撑：

- Peers-Touch 自研 applet。
- 非 Peers-Touch 团队开发的 applet。
- 本地安装 package。
- Station Store 分发 package。
- Desktop / Android / iOS / Web Host 多端运行。

前提是所有 package 都符合 `applet-contract`。

---

## 4. 当前设计的强项

### 4.1 边界清楚

当前设计已经把关键角色拆开：

| 角色 | 职责 |
|------|------|
| Applet package | 声明 manifest、bundle、assets、integrity |
| SDK | applet 调用 Host capability 的唯一 typed client |
| Runtime Host | 加载 package、创建 session、承载 Lynx runtime |
| Bridge | 传输 invoke/event，不做最终授权 |
| Gateway | session、permission、params、audit、handler dispatch |
| Station Store | registry、policy、distribution、audit ingestion、rollback |

这个拆分是对的，避免了 applet 直接接触平台私有能力。

### 4.2 Web / Standalone 区分正确

设计里把 Web Host 和 Standalone 分开是必要的：

| 模式 | 定位 |
|------|------|
| Web Host | Peers-Touch integrated runtime，必须有 session、Gateway、proxy、audit |
| Standalone | package producer 的独立运行出口，不证明 Peers-Touch 权限与审计 |

这能避免把浏览器 fallback 误当生产 Host。

### 4.3 Lynx-first 方向合理

TypeScript + ReactLynx 作为 integrated applet UI 基线，可以同时覆盖 Desktop Lynx for Web、Mobile native LynxView、Web Host。相比 React DOM / iframe，这更符合跨端 runtime 的长期目标。

---

## 5. 当前设计的硬缺口

这些缺口不解决，设计只能支撑局部 demo，不能支撑真正的小程序平台。

### 5.1 Contract 没有唯一真源

需要把以下内容统一到 `packages/applet-contract`，并让 Desktop、Mobile、Web、SDK、package tooling、Station 都消费它：

- `AppletManifest`
- `AppletIndex`
- `TargetPlatform`
- `load.<platform>`
- `BridgeEnvelope`
- `BridgeResponse`
- `CapabilityMethod`
- `AppletError`
- `PackageIntegrity`

这是第一优先级。没有统一 contract，开发和运行都会漂移。

### 5.2 Bridge request/response 还未闭合

必须统一：

```text
SDK invoke
  → BridgeInvokeRequest
  → Host Gateway
  → BridgeInvokeResponse
  → SDK typed result / typed error
```

首批必须强制包含：

- `protocol`
- `appletId`
- `sessionId`
- `requestId`
- `method`
- `params`
- `ok`
- `result`
- `error`

否则 Desktop、Mobile、Web 会各自形成一套临时协议。

### 5.3 Gateway 还不是完整安全执行点

Gateway 必须形成硬链路：

```text
manifest declared permission
  ∩ Station policy
  ∩ Host platform policy
  ∩ user/session grant
  = granted permission
```

首批至少要实现：

- method registry。
- permission guard。
- params validation。
- network allowlist。
- storage namespace / quota。
- lifecycle state check。
- typed audit。

### 5.4 Package format 和 reader 还要固化

不管 package 来自哪里，Peers-Touch 应只接受统一格式：

```text
applet-package/
  ├── manifest.json
  ├── main.lynx.bundle
  ├── assets/
  └── integrity.json
```

Local install 和 Station install 必须复用同一个 package reader。否则后续接 Station Store 会重写。

### 5.5 开发验证工具还不完整

要支撑“别人开发 applet”，不能只靠人工打开 Desktop。

必须提供：

- manifest validation。
- package integrity validation。
- SDK contract test。
- simulate runtime。
- Host attach dev。
- Gateway allow/deny tests。

这不是限制 producer 的开发工具，而是定义 Peers-Touch 接收 package 前的验收工具。

---

## 6. 是否能支撑“小程序开发”

可以，但必须满足以下完成定义。

### 6.1 Peers-Touch 必须提供

- `@peers-touch/applet-sdk`
- `packages/applet-contract`
- package validation CLI。
- SDK API 文档。
- Bridge protocol 文档。
- capability permission matrix。
- simulate runtime / contract test。
- Host attach dev path。

### 6.2 Applet producer 只需要遵守

- 使用 SDK 调 Host capability。
- 声明 manifest。
- 不访问 Host 私有对象。
- 不在 integrated package 中依赖 iframe / DOM privileged API / `postMessage` 主链。
- 产出符合 `applet-contract` 的 package。

### 6.3 不应要求 producer

- 使用 Peers-Touch 指定 IDE。
- 使用 Peers-Touch 指定 monorepo 结构。
- 放弃 standalone 运行方式。
- 暴露 producer implementation detail 给 Host。
- 了解 Desktop Rust / Android / iOS / Web Host 内部实现。

---

## 7. 是否能支撑“小程序运行”

可以，但运行验收必须按 Host 闭环判断，而不是按 bundle 能否显示判断。

### 7.1 最小运行验收

一个 package 运行在 Peers-Touch 上，至少要满足：

- manifest 校验通过。
- integrity 校验通过。
- target platform 匹配。
- Host 创建 session。
- RuntimeContainer 加载 bundle。
- SDK `reportReady()` 成功。
- `network.request` 走 Gateway。
- 未授权调用失败。
- 授权调用成功。
- allowed / denied 都有 audit。
- session destroy 后 invoke 返回 `INVALID_SESSION`。

### 7.2 首批验收端

建议第一阶段只把 Desktop 作为硬验收端：

```text
Desktop Host
  → package reader
  → Lynx for Web
  → BridgeEnvelope
  → Tauri Gateway
  → storage/network/system/config handlers
```

Desktop 通过后，再推进：

- Web Host POC。
- iOS LynxView。
- Android LynxView。
- Station Store publish/install。

原因是 contract 一旦冻结，多端只是执行同一协议；如果 contract 未冻结，同时做多端只会放大漂移。

---

## 8. AI Verification Gates

本节是强制验证机制。AI 评审必须按本节输出证据，不能只复述架构意图。

### 8.1 判定等级

| Level | 名称 | 含义 | 可对外声称 |
|-------|------|------|------------|
| L0 | `NOT_READY` | contract / SDK / Host 任一关键链路缺失 | 不能支撑小程序开发或运行 |
| L1 | `DESIGN_READY` | 文档和目标分层成立，但实现未闭环 | 设计方向可行，不能声称已可用 |
| L2 | `HELLO_RUNTIME_READY` | Desktop 上完成 trivial package → SDK → Bridge → Gateway → audit 最小闭环 | 只能证明基础运行时，不足以支撑复杂 applet |
| L3 | `COMPLEX_DESKTOP_READY` | Desktop 上完成 complex package → skills/tasks/agent/AI/service binding → Gateway allow/deny → audit | 可证明复杂 applet Desktop integrated acceptance |
| L4 | `COMPLEX_DEVELOPMENT_READY` | SDK、contract validation、simulate runtime、Host attach dev 可供 producer 开发复杂 package | 可支撑受控复杂 applet 开发试点 |
| L5 | `COMPLEX_PLATFORM_READY` | Desktop/Web/Mobile/Station Store 支持复杂 applet 的发布、安装、运行、回滚、审计、配额、安全策略 | 可作为正式小程序平台 |

当前文档默认只能给出 **L1: `DESIGN_READY`**。升级到更高等级必须有下面 gates 的证据。

### 8.2 Evidence Bundle

每次 AI 判断“是否支撑”时，必须生成一份 evidence bundle，至少包含：

```text
tooling/acceptance/evidence/applets/
├── summary.md
├── contract/
│   ├── schema-source.txt
│   ├── schema-consumers.txt
│   └── validation-output.txt
├── design/
│   ├── capability-matrix-output.md
│   └── sandbox-scenarios-output.md
├── sdk/
│   ├── exported-api.txt
│   ├── forbidden-api-scan.txt
│   ├── complex-surface-output.txt
│   └── contract-test-output.txt
├── package/
│   ├── sample-package-tree.txt
│   ├── manifest-validation-output.txt
│   └── integrity-validation-output.txt
├── desktop/
│   ├── host-load-output.txt
│   ├── gateway-allow-deny-output.txt
│   ├── skills-output.txt
│   ├── tasks-streaming-output.txt
│   ├── agent-ai-output.txt
│   ├── service-binding-output.txt
│   └── audit-output.txt
├── web/
│   └── host-bridge-output.txt
├── mobile/
│   ├── ios-output.txt
│   └── android-output.txt
└── station/
    ├── publish-install-output.txt
    └── rollback-revoke-output.txt
```

如果某项能力还未实现，证据文件必须写明 `NOT_IMPLEMENTED`，不能留空。

### 8.3 Gate A: Design Capability Matrix Is Exercised

目标：证明设计本身经过能力域沙盘，而不是只看实现文件是否存在。

AI 必须读取并执行：

- `docs/architecture/applet-runtime/wechat-miniprogram-sdk-study.md`
- `docs/architecture/applet-runtime/design-validation-matrix.md`

必须输出：

- 每个 required first-release capability 的状态：`PASS_DESIGN` / `PARTIAL_DESIGN` / `FAIL_DESIGN`。
- 每个 capability 对应的 WeChat reference 或 Peers-Touch-specific reason。
- 每个 capability 的 sandbox scenario。
- 每个 `PARTIAL_DESIGN` / `FAIL_DESIGN` 的 blocking gap。

通过标准：

- Runtime foundation、package/manifest、SDK API、network、storage、system/device low-risk、UI feedback、events/lifecycle、Gateway permission/audit、Web Host distinction、simulate runtime、AI/skills/telemetry 都至少达到 `PARTIAL_DESIGN`。
- `docs/architecture/applet-runtime/complex-applet-acceptance.md` 中的 required complex capabilities 至少达到 `PARTIAL_DESIGN`。
- 首批必需能力不能出现 `FAIL_DESIGN`。
- 微信独有能力必须明确 `REJECTED` 或 `DEFERRED`，不能静默遗漏。
- Peers-Touch 特有能力不能因为微信没有等价能力而遗漏。

失败即判定：

- 不能高于 L1。
- 如果出现必需能力 `FAIL_DESIGN`，整体为 L0。

### 8.4 Gate B: Contract Is Single Source

目标：证明 Peers-Touch 对 applet package 的理解只有一个真源。

AI 必须检查：

- `packages/applet-contract` 是否定义 canonical `AppletManifest`、`AppletIndex`、`BridgeEnvelope`、`BridgeResponse`、`CapabilityMethod`、`AppletError`。
- Desktop schema 是否直接或生成式消费 `packages/applet-contract`，而不是复制一份不同 schema。
- package tooling 是否消费同一 contract。
- Mobile/Web/Station 的 applet-facing schema 是否不再自定义另一套字段语义。

最低验证命令：

```bash
rg -n "AppletManifest|BridgeEnvelope|CapabilityMethod|AppletError" packages/applet-contract apps/desktop apps/mobile apps/station packages/applets
rg -n "targetPlatforms|load\\.|standalone|harmony|web" packages/applet-contract apps/desktop/src/applet packages/applets
```

通过标准：

- contract 类型有唯一真源。
- 没有互相冲突的 target platform 枚举。
- 没有一套 schema 接受、另一套 schema 拒绝的同一合法 manifest。

失败即判定：

- 不能高于 L1。

### 8.5 Gate C: SDK Surface Is Sufficient and Bounded

目标：证明 producer 能用 SDK 开发 applet，而不是直接碰 Host 私有能力。

AI 必须检查 SDK 是否提供：

- `app.getContext`
- `lifecycle.reportReady/onShow/onHide/onDestroy`
- `network.request`
- `storage.get/set/remove/clear/getInfo`
- `config.get`
- `system.getInfo/getTheme/getNetworkType`
- `ui.showToast/showLoading/hideLoading/showModal`
- `events.on/subscribe/unsubscribe`
- `skills.register/list/invoke/onStream`
- `tasks.start/get/cancel/onEvent`
- `agent.startSession/send/stream`
- `ai.generate/chat`
- `telemetry.track/reportError/mark`
- `invoke<T>`

AI 还必须扫描 forbidden access：

```bash
rg -n "desktop_api|invoke\\(|NativeModules|Tauri|window\\.parent|postMessage|localStorage|fetch\\(" packages/applets apps/desktop/applets-dev packages/applet-sdk
```

解释规则：

- `packages/applet-sdk` 内允许出现 adapter 层的 bridge access。
- applet package 业务源码不允许直接访问 Host 私有 API。
- applet package 业务源码不允许用 `window.parent.postMessage` 作为 integrated bridge。
- applet package 业务源码不允许直接持有 token 或调用 Station internal API。
- applet package 业务源码不允许直接访问内部 skill registry、agent runtime、LLM provider、system log 或 audit writer。

通过标准：

- applet 业务代码只依赖 SDK public API。
- SDK 通过 BridgeAdapter 进入 Host。
- forbidden scan 中没有未解释的业务层违规。
- skills/tasks/agent/AI/telemetry 通过 Gateway 执行，不能只是 TypeScript facade。

失败即判定：

- 不能高于 L2；如果 complex surface 缺失，不能达到 L3。

### 8.6 Gate D: Package Validation Is Executable

目标：证明 Peers-Touch 接收的是 package contract，不是 producer implementation detail。

必须存在可执行 package validation：

```bash
pnpm applet:validate <package-dir>
```

如果命令尚未实现，当前报告必须标记为 `NOT_IMPLEMENTED`。

验证内容：

- `manifest.json` 存在。
- `main.lynx.bundle` 或 manifest 指向的 entry 存在。
- `integrity.json` 覆盖所有 load entries 和 assets。
- `targetPlatforms` 与 `load.<platform>` 完全匹配。
- unsupported platform 明确拒绝。
- permission 字段只允许 capability registry 中存在的权限。
- services/skills/tasks/agent/ai/telemetry declarations 符合 contract。

通过标准：

- 合法 package 通过。
- 缺 manifest 失败。
- 缺 entry 失败。
- integrity hash 不匹配失败。
- 声明 unsupported platform 失败。
- 声明未知 permission 失败。
- skill input schema 不合法失败。
- service binding 不合法失败。

失败即判定：

- 不能高于 L2；如果 complex package validation 缺失，不能达到 L3。

### 8.7 Gate E: Bridge Envelope Is Tested

目标：证明 Desktop/Web/Mobile 不会各自发明协议。

必须有 contract tests 覆盖：

- request contains `protocol/appletId/sessionId/requestId/method/params`。
- response contains `protocol/appletId/sessionId/requestId/ok/result/error`。
- error contains stable `code/message/details?`。
- requestId 在 allowed / denied / error case 中保持一致。
- session destroyed 后 invoke 返回 `INVALID_SESSION`。
- stream/task request 保持 requestId/taskId 一致。
- cancellation 有稳定 response envelope。

最低测试命令：

```bash
pnpm applet:contract-test
```

如果命令尚未实现，当前报告必须标记为 `NOT_IMPLEMENTED`。

失败即判定：

- 不能高于 L2。

### 8.8 Gate F: Desktop Complex Runtime Closure

目标：证明至少 Desktop 可以跑通 integrated runtime 的复杂 applet 闭环，而不只是 bundle render。

必须验证：

```text
package reader
  → manifest validation
  → integrity validation
  → session creation
  → Lynx runtime load
  → SDK reportReady
  → system/storage/network invoke
  → skills register/list/invoke
  → agent/AI stream
  → task start/progress/cancel/complete/fail
  → service binding resolution
  → Gateway allow/deny
  → audit output
  → session destroy
```

最低命令形态：

```bash
pnpm applet:desktop-smoke <package-dir>
```

必须包含失败用例：

- package 没有 network permission，`network.request` 失败。
- package 有 network permission，但 domain 不在 allowlist，失败。
- package 有 permission 且 policy allow，成功。
- skill 未授权，失败。
- agent/AI 超出 policy/quota，失败。
- task cancel 后不再继续投递 progress。
- session destroy 后再次 invoke，返回 `INVALID_SESSION`。

通过标准：

- allowed 和 denied 都有 `requestId`。
- allowed 和 denied 都有 audit。
- SDK 收到 typed response，不是平台私有 error。
- Host UI 能收到 skill/agent/task streaming event。
- provider key、internal prompt、tool executor、system log、audit writer 不暴露给 applet。

失败即判定：

- 不能高于 L2；如果只有 bundle 显示成功，仍然不能算 L2；如果缺 skills/tasks/agent/AI/service binding，不能算 L3。

### 8.9 Gate G: Development Workflow Is Producer-Independent

目标：证明 Peers-Touch 支撑“producer 自选工具开发”，而不是反向要求 producer 使用 Peers-Touch 内部目录。

AI 必须验证：

- Host 只读取 package directory。
- validation CLI 只读取 package contract。
- smoke CLI 只接收 package path。
- 文档和脚本不引用具体 producer 路径、业务名、仓库名。

最低扫描：

```bash
rg -n -f tooling/config/applet-forbidden-producer-terms.txt docs tooling packages apps
```

`applet-forbidden-producer-terms.txt` 由 verification tooling 维护，不在本架构文档内列出具体 producer 名称或业务名称。

通过标准：

- 没有具体 producer 路径或业务名。
- 没有 Host 读取 producer source layout 的描述或代码。

失败即判定：

- 不能高于 L1；如果不能以 producer-independent 方式开发/验证 complex package，不能到 L4。

### 8.10 Gate H: Web and Mobile Parity

目标：证明 runtime contract 可以跨端，而不是 Desktop-only 临时实现。

Web 必须验证：

- `WebHostBridgeAdapter` 存在。
- Web Host 注入 `globalThis.__PEERS_TOUCH_APPLET_HOST__` 或等价 host bridge。
- Web Host 走 Gateway/BFF，不退回 production raw browser fetch。

iOS / Android 必须验证：

- native LynxView 或明确的 Lynx runtime container。
- BridgeDispatcher 与 Desktop 使用同一 envelope。
- network/storage/system/config handler 使用同一 capability method 和 error model。
- permission denied 与 Desktop 错误码一致。

通过标准：

- 至少 Desktop + Web 或 Desktop + 一个 Mobile 端通过同一 package 的 smoke。

失败即判定：

- 可以是 L2 或 L3 或 L4，但不能到 L5。

### 8.11 Gate I: Station Store Closure

目标：证明 package 可以发布、安装、撤回，而不是只靠本地复制。

必须验证：

- package registry。
- manifest registry。
- bundle storage。
- version channel。
- policy distribution。
- install state。
- audit ingestion。
- revoke / rollback。

最低命令形态：

```bash
pnpm applet:publish <package-dir> --channel dev
pnpm applet:install <applet-id> --channel dev
pnpm applet:revoke <applet-id> --version <version>
```

失败即判定：

- 不能到 L5。

### 8.12 AI Review Output Contract

AI 每次回答“是否足够支撑”时，必须输出这个结构：

```markdown
## Readiness Verdict

Level: L?
Verdict: NOT_READY | DESIGN_READY | HELLO_RUNTIME_READY | COMPLEX_DESKTOP_READY | COMPLEX_DEVELOPMENT_READY | COMPLEX_PLATFORM_READY

## Evidence

| Gate | Status | Evidence path / command | Blocking issue |
|------|--------|-------------------------|----------------|
| A Design matrix | PASS/FAIL/PARTIAL | ... | ... |
| B Contract | PASS/FAIL/NOT_IMPLEMENTED | ... | ... |
| C SDK | PASS/FAIL/NOT_IMPLEMENTED | ... | ... |
| D Package validation | PASS/FAIL/NOT_IMPLEMENTED | ... | ... |
| E Bridge envelope | PASS/FAIL/NOT_IMPLEMENTED | ... | ... |
| F Desktop complex runtime | PASS/FAIL/NOT_IMPLEMENTED | ... | ... |
| G Producer independence | PASS/FAIL/NOT_IMPLEMENTED | ... | ... |
| H Web/Mobile parity | PASS/FAIL/NOT_IMPLEMENTED | ... | ... |
| I Station Store | PASS/FAIL/NOT_IMPLEMENTED | ... | ... |

## Final Claim

One of:
- 当前只能证明设计方向。
- 当前只能证明 hello runtime。
- 当前能支撑复杂 applet Desktop integrated acceptance。
- 当前能支撑复杂 applet 受控开发试点。
- 当前能支撑复杂 applet 正式平台。
```

如果 AI 没有填这个表，就不能给出“足够支撑”的结论。

---

## 9. 依赖顺序

必须按这个顺序推进：

1. **C0 Contract complex slice**  
   统一 manifest、target platform、service binding、skill descriptor、task/stream/agent/AI/telemetry permission、bridge envelope、error、capability method。

2. **S1 SDK complex surface**  
   实现 app/lifecycle/network/storage/config/system/ui/events/invoke，以及 skills/tasks/agent/ai/telemetry。

3. **G2 Gateway minimal complex slice**  
   实现 service binding resolver、network proxy、skill registry、task lifecycle、stream dispatcher、agent/AI policy hook、telemetry、audit。

4. **D3 Desktop complex runtime integration**  
   建立 package reader、session、Lynx load、Bridge dispatcher、Host UI event delivery、Gateway integration、session destroy semantics。

5. **T4 Tooling and evidence**  
   提供 `applet:validate`、`applet:contract-test`、`applet:desktop-smoke`、forbidden producer scan、evidence bundle。

6. **A5 External complex acceptance**  
   让任意 conforming complex applet package 通过 service override 接入 Desktop Host，跑完 package、SDK、Gateway、skill、agent/task stream、audit、session destroy 验收。

7. **Web/Mobile parity**  
   WebHostAdapter、iOS LynxView、Android LynxView 对齐 Desktop 语义。

8. **Station Store**  
   registry、policy、install、rollback、audit ingestion。

任务级执行源：

- `docs/architecture/applet-runtime/execution-plans/2026-06-06-complex-applet-implementation-plan.md`

---

## 10. 最终判断

这个设计可以作为 Peers-Touch 小程序开发、运行的目标架构，条件是 Peers-Touch 把自己定义成 **Applet Platform Host**，而不是只做一个 bundle loader。

成立的目标形态是：

```text
Producer chooses development tools
  → Peers-Touch SDK defines available capabilities
  → applet-contract defines accepted package
  → Host validates and loads package
  → Bridge carries capability intent
  → Gateway authorizes and executes
  → Station distributes, governs, revokes, audits
```

当前设计最需要守住的底线：

- 不按 package producer 反向设计 Host。
- 不让 applet 直接调用平台私有能力。
- 不把 standalone 当 Web Host。
- 不把 bundle 能显示当作 runtime 成立。
- 不在 Contract 冻结前扩张高风险 capability。

因此最终报告结论是：

> **目标架构能支撑，但当前设计和实现是否足够支撑复杂 applet 必须由 Gate A-I 证明。没有能力矩阵、complex sandbox 推演、evidence bundle 和 gate 结果，只能说设计方向成立，不能说 Peers-Touch 已经具备有业务价值的小程序开发和运行能力。**
