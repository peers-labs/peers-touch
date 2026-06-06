# Peers-Touch Applet Runtime Support Assessment

> **Status**: draft
> **Version**: v1.1
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Scope**: Whether the Peers-Touch applet runtime design can host conforming applet packages

---

## 1. 问题定义

本评估只回答一个问题：

> Peers-Touch 当前设计和部分实现，是否真的能支撑一个符合 Peers-Touch contract 的 applet package 运行在 Peers-Touch applet runtime 里？

本文不引用任何具体 package producer 或业务样本。Peers-Touch 只定义自己接受的 package contract、runtime contract、Host Gateway contract 和验收口径。

---

## 2. 结论

**方向成立，但闭环还不成立。**

Peers-Touch 设计方向是正确的：

- TypeScript + ReactLynx 作为 applet UI 基线。
- `@peers-touch/applet-sdk` 作为 applet 唯一 Host 能力入口。
- Bridge 把 applet intent 送入 Host。
- Host Capability Gateway 负责权限、session、审计和平台 handler。
- Desktop / Android / iOS / Web 使用同一语义，不暴露平台私有 API。

但当前 Peers-Touch 设计和已有实现之间存在几处硬断点。它们不解决，某个 applet package 可以被“局部跑起来”，但不能证明 Peers-Touch applet runtime 已经成立。

当前判断：

| 目标 | 结论 |
|------|------|
| Desktop 单端 POC | **可支撑，但需要先冻结 contract 与 bridge 返回格式** |
| Desktop 正式 Host Gateway 验收 | **暂不充分，permission/session/policy/audit 还不闭环** |
| Android/iOS 跨端运行 | **设计可支撑，实现明显不足** |
| Web Host 正式运行 | **设计可支撑，实现尚未形成** |
| Station 分发 / 安装 / 回滚 | **有历史服务基础，但与新 runtime contract 未闭合** |
| 长期 applet 开发流水线 | **需要补齐 package format、contract test、Host attach、publish/install gating** |

---

## 3. Peers-Touch 必须提供的承载闭环

一个 applet package 要运行在 Peers-Touch runtime 里，Peers-Touch 自身必须提供这条闭环：

```text
Applet package
  → manifest validation
  → bundle integrity verification
  → Host creates session
  → Host creates Lynx runtime container
  → SDK detects Host bridge
  → applet invokes capability
  → Gateway validates session / permission / params
  → platform handler executes
  → audit result
  → lifecycle teardown
```

这里的关键不是 package 来自哪个仓库，而是 Peers-Touch 能不能把任意符合 contract 的 applet package 放进这条链路。

---

## 4. 当前 Peers-Touch 的主要断点

### 4.1 Contract 还没有唯一真源

当前至少存在三套 manifest / package 口径：

| 位置 | 当前口径 | 问题 |
|------|----------|------|
| `docs/architecture/applet-runtime/data-model.md` | `desktop/android/ios/web/harmony` + platform load map | 架构目标 |
| `packages/applet-contract/src/manifest.ts` | `desktop/android/ios/standalone` | 缺 `web` / `harmony` |
| `packages/applets/schema.js` | `desktop/mobile/web` + `load.type = lynx` + bridge protocol v2 | 与 contract 包和 Desktop schema 不一致 |
| `apps/desktop/src/applet/schema.ts` | `desktop/android/ios/standalone` | 与新架构 Web Host / Harmony 口径不一致 |

这会直接阻断 applet package 接入：同一个 package 可能构建工具接受，Desktop Host 拒绝，或者 SDK/Station 无法解释。

必须先冻结：

- `AppletManifest`
- `AppletIndex`
- `TargetPlatform`
- `load.<platform>`
- `BridgeEnvelope`
- `CapabilityMethod`
- `ErrorEnvelope`
- `PackageIntegrity`

并让 Desktop、SDK、build tools、Mobile、Station 全部消费同一个 `packages/applet-contract`。

### 4.2 Bridge 语义还没对齐

架构文档里的 Bridge 是 envelope：

```typescript
{
  protocol: 'peers-touch.applet.bridge',
  appletId,
  sessionId,
  requestId,
  method,
  params
}
```

但当前 SDK 的 `LynxBridgeAdapter` 调用是：

```typescript
NativeModules.bridge.invoke({ method, params })
```

Desktop `<lynx-host>` 再把它拆成：

```text
appletId + capability + action + params → api.appletInvoke(...)
```

Rust 侧返回的是 `StubPayload { command, status: string }`，而 SDK 期望可 unwrap 的 `{ ok, result, error }` 或直接 result。

这意味着 Bridge 当前能做简单调用，但还不能作为跨端稳定协议。

必须统一：

- request envelope。
- response envelope。
- error code。
- request id。
- session id。
- Host event envelope。
- SDK unwrap 规则。

### 4.3 Desktop Host 有雏形，但还不是完整 runtime

已有实现：

- `apps/desktop/src/applet/LynxHost.tsx`
- `apps/desktop/src/applet/lynx-host-element.ts`
- `apps/desktop/src/applet/AppletManager.ts`
- `apps/desktop/src/pages/AppletRuntimePage.tsx`
- `apps/desktop/src-tauri/src/interface/tauri_commands/applets.rs`
- `apps/desktop/src-tauri/src/application/applets/mod.rs`

这些证明 Desktop 方向不是空想。

但缺口仍然明显：

- package integrity 未形成强制链路。
- session lifecycle 还只是前端实例状态和简单 Rust context，不是完整 applet session。
- `reportReady/onShow/onHide/onDestroy` 没有闭合到 SDK。
- permission 不是来自 manifest ∩ policy ∩ platform ∩ user grant。
- network handler 直接 `reqwest`，缺 domain allowlist、header denylist、token 注入策略、body size 限制。
- audit 是日志事件，还不是可查询、可上报、可回放的审计模型。

结论：Desktop 可以作为第一个 POC 承载端，但不能跳过 contract / bridge / gateway 的修正。

### 4.4 Mobile Host 设计有方向，实现不足

iOS 已有：

- `AppletManager`
- `AppletBridgeSession`
- `BridgeDispatcher`
- `StorageBridgeModule`
- `NetworkBridgeModule`
- `SystemBridgeModule`
- `AppletContainerView`

但 `AppletLynxViewRepresentable` 仍是 placeholder，注释里写明真实 Lynx iOS SDK 尚未集成。

Android 当前没有对应 Applet Host 实现。

iOS permission check 当前没有强制 throw，network 也没有 allowlist / policy。它只能证明 module shape，不证明生产治理成立。

结论：跨端设计可以支撑，但 Mobile 不能作为当前验收端。

### 4.5 Web Host 是设计项，不是实现项

Web Host 的设计很重要，因为它避免把 `standalone` 当成生产 Web。

但当前 SDK detect 只有：

```text
LynxBridgeAdapter
StandaloneBridgeAdapter
```

还没有正式 `WebHostBridgeAdapter` 实现。因此浏览器环境会落到 standalone，不会证明 Web Host 的 session / Gateway / proxy。

结论：Web Host 设计必要，但必须进入首批 POC，否则 SDK 会被 Lynx/native bridge 形态锁死。

### 4.6 Station Store 与新 runtime contract 尚未闭合

Station 里已有 `applet_store` 相关 proto 和 Go 服务，但历史文档仍描述 WebF / Web 技术栈和 mock applets。

它还没有和当前新设计闭合：

- package format。
- bundle integrity。
- platform artifact list。
- manifest version。
- policy distribution。
- revocation / rollback。
- audit ingestion。

结论：第一个 Desktop POC 可以不依赖 Station Store，但 Peers-Touch 生产集成必须把 Station Store 重新对齐到新 contract。

---

## 5. 对 Applet Package 的输入要求

Peers-Touch 不关心 applet package 由哪个 producer 产出，也不关心 producer 是否支持 standalone 运行。Peers-Touch 只关心 integrated package 是否符合 canonical contract。

最小要求：

```text
applet-package/
  ├── manifest.json          # Peers-Touch canonical manifest
  ├── main.lynx.bundle       # ReactLynx artifact
  ├── assets/
  └── integrity.json
```

如果 applet package producer 还提供 standalone 运行方式，那是 producer 自己的独立能力；Peers-Touch integrated runtime 只验收上面的 package contract。

因此 Peers-Touch 对输入 package 的要求只有：

- 使用 Peers-Touch canonical manifest。
- 使用 `@peers-touch/applet-sdk`。
- 不在 integrated bundle 中依赖 DOM / iframe / postMessage。
- Host 能通过 Gateway 调用它需要的能力。

不是要求 package producer 放弃 standalone，也不是要求 package producer 按 Peers-Touch 的内部目录重组。

---

## 6. 支撑判断矩阵

| Peers-Touch 能力 | 是否能支撑 applet package | 当前问题 | 必须完成的修正 |
|------------------|----------------------|----------|----------------|
| Canonical manifest | 方向能支撑 | contract / schema / build tool 不一致 | 统一 `packages/applet-contract` |
| Lynx bundle loading | Desktop 方向能支撑 | Desktop 需验证 Lynx for Web in Tauri；Mobile 未完成 | Desktop POC + Mobile Lynx SDK 接入 |
| SDK API | 部分能支撑 | 缺 app/lifecycle/ui/events/WebHostAdapter；bridge unwrap 不统一 | SDK MVP 与 envelope 对齐 |
| Bridge | 部分能支撑 | request/response envelope 不一致 | 定义并实现统一 BridgeEnvelope |
| Gateway | 方向能支撑 | permission/policy/session/audit 不闭合 | Registry + policy guard + typed audit |
| Network | 部分能支撑 | raw request，无 allowlist/token/header/body policy | Host proxy policy |
| Storage | 部分能支撑 | Desktop 有 namespace 文件，Mobile namespace/clear 语义不足 | quota + namespace + clear rules |
| Web Host | 设计能支撑 | 未实现 | WebHostBridgeAdapter + BFF/Gateway |
| Station Store | 历史基础能支撑 | 与新 runtime contract 未接上 | package registry + policy + integrity |
| Tooling pipeline | 部分能支撑 | `packages/applets/schema.js` 与新 contract 冲突 | package CLI 消费 canonical contract |

---

## 7. 最小证明路径

要证明 Peers-Touch 设计真的能支撑 applet package，不需要先做全量 Station / Mobile / Web。应该先做一条最短闭环：

### Step 1: Contract Freeze

冻结一份 canonical contract：

- `TargetPlatform = desktop | android | ios | harmony | web | standalone`
- `standalone` 是 non-integrated outlet。
- `load.desktop/web.type = lynx-web`
- `load.android/ios/harmony.type = lynx-native`
- `BridgeEnvelope` 带 `protocol/appletId/sessionId/requestId/method/params`
- `BridgeResponse` 带 `ok/result/error/requestId`

验收：`packages/applet-contract`、Desktop schema、build schema、Mobile schema 全部一致。

### Step 2: Desktop Integrated POC

先只证明 Desktop：

```text
sample main.lynx.bundle
  → Desktop <lynx-host>
  → LynxBridgeAdapter
  → BridgeEnvelope
  → Tauri applets_invoke
  → Gateway permission / session / audit
  → network.request / storage.get
```

验收：

- manifest 缺 network 权限时 `network.request` 必须失败。
- manifest 声明 network 但 domain 不在 allowlist 时必须失败。
- allow 后能请求到 manifest policy 允许的后端。
- 每次 allowed / denied 都有 request id 和 audit。
- SDK 看到的是统一 typed error / typed response。

### Step 3: Simulate Runtime

新增 `packages/applet-runtime-simulate`，在不启动 Desktop 的情况下测试：

- SDK adapter。
- envelope shape。
- allow/deny。
- lifecycle。
- typed error。

这一步防止每个 applet 都靠手工打开 Desktop 验证协议。

### Step 4: Package Reader

即使先不接 Station，也要让 local package 长得像 Station package：

```text
package.tar
  ├── manifest.json
  ├── main.lynx.bundle
  ├── assets/
  └── integrity.json
```

Desktop local install 和未来 Station install 复用同一 reader。

### Step 5: Cross-host Parity

Desktop 通过后，再补：

- WebHostBridgeAdapter + Web Host POC。
- iOS Lynx SDK integration。
- Android LynxView host。
- Station package / policy / audit ingestion。

---

## 8. 最终回答

Peers-Touch 的设计 **可以支撑** 符合契约的 applet package 运行进 applet runtime，但只有在以下前提成立时才算真正支撑：

1. Contract 只有一个真源。
2. Bridge request/response envelope 统一。
3. Desktop Host 形成完整 session + Gateway + audit 闭环。
4. SDK 不只会 standalone / Lynx，还要支持正式 Web Host。
5. Package format 和 local install 从第一天就按 Station package 形态设计。
6. Mobile/Web 可以后置，但不能改变 contract。

当前状态更准确的说法是：

> **设计方向能支撑，现有实现不能直接证明支撑。下一步应先把 Peers-Touch 自己的 contract、Bridge、Desktop Gateway、package reader 做成最小闭环，然后用任意符合 contract 的 applet package 做验收样本。**
