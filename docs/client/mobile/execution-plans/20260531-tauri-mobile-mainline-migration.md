# Tauri Mobile 主线迁移实施计划

> Status: superseded by `docs/architecture/platform/client/mobile/` for target architecture;
> retained as historical migration context
> Owner: Client Architecture
> Created: 2026-05-31
> Related proposal: `../../../context/mobile/tauri-mobile-capability-topology-proposal.md`

---

## 1. 真实升级目标

本计划不是“给原生 Mobile 加一个 Tauri 实验壳”，而是一次 Mobile 主线迁移：

- 从 Android Compose / iOS SwiftUI 双 UI 主线，迁移到 Tauri v2 Mobile 主线。
- 从双端分别沉淀 UI/UX，迁移到 Desktop / Mobile 共享 Web UI 范式。
- 从原生端直接承载页面与业务编排，迁移到 Web UI + shared runtime + Rust kernel + native plugins。
- Station 共享业务真源不变。
- `model/domain/*.proto` 共享契约真源不变。

### 1.1 当前问题

- 原生双端很难长期维持统一 UI/UX 范式。
- Desktop 已有 Tauri / React / Rust 工程资产，Mobile 原生双端会形成重复设计系统。
- Mobile 需要复用 Desktop 的 runtime projection 思想，但不能复刻 Desktop 专属窗口、托盘、多窗口能力。
- Applet / Notification / Sync / Auth 等能力需要跨端语义一致，但移动端生命周期不同。

### 1.2 目标

- 建立 `apps/mobile` 的 Tauri v2 Mobile 主线。
- 抽出可被 Desktop 与 Mobile 共享的 UI、runtime、API、platform adapter。
- 用 native plugins 承接推送、深链、安全存储、相机相册、后台任务、生物识别、分享等移动系统能力。
- 让 Mobile 的 Chat / Auth / Notification / Profile 最小闭环可运行。
- 明确旧 `apps/mobile/android` 与 `apps/mobile/ios` 的迁移策略。

### 1.3 非目标

- 不在第一阶段重写 Station 业务域。
- 不改变 Station 作为共享业务真源的边界。
- 不把 Desktop 原页面树直接缩放成 Mobile。
- 不在第一阶段完成所有 Applet 能力。
- 不保留 Compose / SwiftUI 作为主 UI 长期并行演进路径。

---

## 2. 领域责任拆分

实施按领域责任拆分，不按页面或端侧目录拆分。

| 领域 | 责任 | 主要产物 |
| --- | --- | --- |
| Source-of-truth Migration | 把 Tauri Mobile 从 proposal 提升为 Mobile 平台正式方向 | `base.md`、`native-dual-platform.md`、docs 入口更新 |
| Tauri Mobile Shell | 建立移动端 Tauri 应用壳与构建链 | `apps/mobile/src`、`apps/mobile/src-tauri`、`tauri.conf.json`、脚本 |
| Shared Client Layer | 抽取 Desktop / Mobile 共享 UI、runtime、API | `packages/client-ui`、`client-runtime`、`client-api`、`client-platform` |
| Platform Adapter | 定义 Desktop / Mobile 能力接口与实现 | desktop adapter、mobile adapter、capability contract |
| Rust Capability Kernel | 承接 Tauri commands、权限、插件注册、事件桥接 | mobile Rust commands、state、event bridge |
| Native Plugin Layer | 承接移动系统能力 | secure storage、push、deep link、background、camera、share、biometric |
| Sync & Projection | 实现移动生命周期感知的数据新鲜度 | session/sync/social/notification/profile runtimes |
| Core Product Domains | 形成可用产品闭环 | Auth、Chat、Notification、Profile、Settings |
| Applet Host | 验证并落地移动 Applet 宿主 | Lynx plugin spike、Bridge V2、Manifest 校验 |
| Verification & Release | 建立移动端验证、构建、回归体系 | dev scripts、CI checks、device smoke tests |

---

## 3. 执行闭环

一次 Mobile 用户操作必须走完整闭环：

```text
User Action
  -> mobile-web UI
  -> shared client runtime
  -> client-api or tauri command
  -> mobile-rust capability kernel
  -> native plugin or Station API
  -> Station truth / device capability
  -> event / ACK / push / delta sync
  -> runtime projection
  -> UI render
```

闭环约束：

- 页面只负责渲染和用户动作，不拥有长期业务新鲜度。
- Station ACK 或事件是跨端业务状态的最终收敛来源。
- Native plugin 只能产生 capability event，不能裁决业务状态。
- Push 只唤醒与提示，恢复前台必须通过 delta sync 收敛。
- Offline outbox 必须幂等并可重放。

---

## 4. 依赖顺序

实施顺序按依赖拓扑排列：

```text
P0 文档真源迁移
  -> P1 Tauri Mobile Spike
  -> P2 Shared Client Layer
  -> P3 Mobile Shell
  -> P4 Runtime & Sync
  -> P5 Core Domains
  -> P6 Native Plugins
  -> P7 Applet Host
  -> P8 Verification & Release
```

关键依赖：

- 没有 P0，代码实现会和 docs 真源冲突。
- 没有 P1，不能确认 Tauri Mobile 在本项目无阻断项。
- 没有 P2，Mobile 会复制 Desktop 而不是共享资产。
- 没有 P4，Chat / Notification 会退化为页面刷新式实现。
- 没有 P6，Mobile 无法形成真正移动端能力闭环。

---

## 5. 分阶段计划

### P0：文档真源迁移

目标：

- 正式确认 Tauri Mobile 是 Mobile 主线。
- 把 proposal 中被采纳的内容迁移到平台层真源。

状态：

- Completed on 2026-05-31.

交付：

- 已更新 `docs/client/mobile/base.md`：主线从原生双端改为 Tauri Mobile。
- 已更新 `docs/client/mobile/native-dual-platform.md`：降级为 native plugin / legacy reference 文档。
- 已更新 `docs/client/mobile/applet-container.md`：补充 Tauri Mobile 下的 Lynx plugin 承载路径。
- 已更新 `docs/client/mobile/sync-protocol.md`：技术栈描述从原生 Room/SwiftData 改为 Tauri Mobile runtime/cache。
- 已更新 `docs/README.md`：Mobile 当前真源指向新口径。
- 已更新 `docs/.agent/mobile.md`：禁止把 Compose / SwiftUI 继续作为主 UI 路径。

验收：

- Mobile docs 中不存在“原生双端是未来主线”的冲突表述。
- Tauri Mobile 的正式边界、非目标、目录方向、验证命令清晰。
- Proposal 文档仍保留在 `docs/context/` 作为决策过程记录。

### P1：Tauri Mobile Spike

目标：

- 用最小工程验证 Tauri v2 Mobile 对 Peers Touch 无阻断项。

状态：

- In progress.
- Current report: `20260531-tauri-mobile-spike-report.md`.

交付：

- `apps/mobile` 初始化 Tauri v2 Mobile shell。
- iOS simulator 能启动 mobile-web。
- Station API 可从 mobile-web 或 mobile-rust 访问。
- OAuth / deep link 最小链路可回到 App。
- secure storage 能写入和读取 token。
- 前台 event stream 能驱动一个 runtime projection。
- push plugin 路径完成可行性验证。
- Applet Lynx plugin 做最小嵌入或打开验证。

验收：

- `pnpm mobile:dev:ios` 或等价脚本可启动 iOS dev。
- spike report 明确记录通过项、阻断项、需自研插件项。

### P1.5：Framework Skeleton

目标：

- 防止 Mobile shell 停留在 demo 形态，先固化框架边界再继续业务能力。

状态：

- Completed on 2026-05-31.

交付：

- `apps/mobile/src/app`：provider 边界。
- `apps/mobile/src/routes`：移动端 route shell。
- `apps/mobile/src/pages`：framework / runtime 页面边界。
- `apps/mobile/src/runtimes`：runtime descriptor registry。
- `apps/mobile/src/services/platform`：platform adapter interface。
- `apps/mobile/src-tauri/src/commands`：Tauri command registry。
- `apps/mobile/src-tauri/src/platform/ios`：iOS-first platform kernel。
- `apps/mobile/src-tauri/src/error.rs`：typed mobile error entry。
- `mobile:check`：Web + Rust + iOS Xcode project 三层门禁。

验收：

- 根组件不直接承载 runtime / platform / page 逻辑。
- Rust command 不继续堆在 `lib.rs`。
- 共享 Tauri 配置不硬编码个人 Apple development team。
- Tauri security 不使用 `csp: null` 作为默认配置。

### P2：Shared Client Layer

目标：

- 避免“复制 Desktop 到 Mobile”，先抽象共享资产。

交付：

- `packages/client-ui`：tokens、基础组件、响应式规则、mobile shell primitives。
- `packages/client-runtime`：session、sync、event、projection ownership、outbox interfaces。
- `packages/client-api`：Station API adapter、错误码映射、auth header、cursor sync helpers。
- `packages/client-platform`：platform capability interface。
- Desktop 接入 shared layer 的最小兼容适配。

验收：

- Shared 包不依赖 `apps/desktop` 或 `apps/mobile` 具体目录。
- Desktop 现有核心流程不因抽包退化。
- Mobile 可以只通过 shared API/runtime 建立 Auth + Chat skeleton。

### P3：Mobile Shell

目标：

- 建立可持续迭代的 Tauri Mobile 应用壳。

交付：

- `apps/mobile/src/app`：启动、provider、错误边界、i18n、theme。
- `apps/mobile/src/routes`：移动端路由、tab、stack、deep link dispatch。
- `apps/mobile/src/pages`：Auth、Chat、Notifications、Profile、Settings skeleton。
- `apps/mobile/src-tauri`：Tauri commands、capabilities、plugin registration。
- package scripts：`mobile:dev:ios`、`mobile:build:ios`。

验收：

- 移动端 UI 使用 shared tokens，不直接复制 Desktop 布局。
- 安全区、输入法避让、底部导航、返回手势有基础规则。
- Web UI 与 Rust command 通道可观测、可错误处理。

### P4：Runtime & Sync

目标：

- 建立移动生命周期感知的 projection 模型。

交付：

- `sessionRuntime`：token restore、refresh、logout、actor switch。
- `syncRuntime`：cold sync、resume reconcile、periodic reconcile、cursor state。
- `socialRuntime`：sessions、messages、unread、receipts。
- `notificationRuntime`：in-app notifications、badge projection、push click route。
- `profileRuntime`：current actor、peer profile、profile.updated invalidation。
- `outbox`：幂等写入、重试、ACK 收敛。

验收：

- Chat 新消息不能依赖页面 remount 才出现。
- App 从后台恢复后必须执行 delta sync。
- Push 点击进入会话后，projection 能补齐 Station 状态。
- 断网写入能进入 outbox，恢复网络后收敛。

### P5：Core Domains

目标：

- 交付 Mobile MVP 产品闭环。

交付：

- Auth：密码 / OAuth / session restore / logout。
- Chat：会话列表、私聊、群聊基础、发送、接收、已读。
- Notifications：列表、未读、badge、点击跳转。
- Profile：当前用户、peer profile、头像展示。
- Settings：账号、安全、通知、本机偏好。

验收：

- 一个新用户可以登录、进入 Chat、收发消息、收到通知、查看 Profile。
- Desktop 与 Mobile 对同一账号的消息、未读、Profile 状态最终一致。
- MVP 不依赖 mock API。

### P6：Native Plugins

目标：

- 把移动系统能力纳入 Tauri capability 边界。

当前状态：

- secure storage 已完成 framework boundary：Web smoke page、runtime port、platform adapter、Tauri command、Rust platform port。
- iOS Keychain 尚未作为正式 native plugin 链接；不得通过在 generated `main.mm` 注入 C symbol 的方式让 Rust dylib 反向依赖 app executable。
- 真正的 secure storage 落地必须以 Tauri iOS plugin / native capability package 承载，并注册显式 permission。

交付：

- `secure-storage` plugin：iOS Keychain。
- `push` plugin：APNs / FCM token、消息接收、点击事件。
- `deep-link` configuration：OAuth callback、notification route。
- `background-sync` plugin：WorkManager / BGTaskScheduler。
- `media-picker` plugin：相册、相机、文件选择。
- `biometric` plugin：本地敏感操作解锁。
- `share` plugin：系统分享。

验收：

- 所有 plugin 都有权限声明、错误映射、最小测试或手动验证步骤。
- token 不明文存储。
- plugin 不直接拥有业务状态。
- Android / iOS 的平台差异被封装在 adapter 内。

### P7：Applet Host

目标：

- 验证并确定 Mobile Applet 宿主路径。

交付：

- LynxView Tauri mobile plugin spike。
- Bridge V2 native invoke adapter。
- Manifest V2 校验。
- Applet lifecycle：open、pause、resume、destroy。
- 权限裁决：storage、network、notification、chat capability。

验收：

- 至少一个 sample applet 可在 Mobile 打开。
- Applet 不能调用未声明权限。
- Applet 生命周期不会破坏 Mobile navigation。
- 若 LynxView plugin 不可行，必须输出 WebView 内 applet runtime 的替代决策。

### P8：Verification & Release

目标：

- 建立移动端持续验证与发布准备。

交付：

- Android build check。
- iOS build check。
- TypeScript check。
- Rust check。
- Device smoke checklist。
- Store readiness checklist。

验收：

- 本地至少可完成 iOS simulator 构建。
- CI 能跑非签名构建或最小静态检查。
- 发布前 checklist 覆盖权限说明、隐私、push、deep link、crash 日志。

---

## 6. 影响面清单

| 区域 | 影响 |
| --- | --- |
| `docs/client/mobile` | 平台真源、同步协议、Applet 容器、执行计划需要迁移 |
| `docs/.agent/mobile.md` | Mobile agent guardrail 需要从原生主线改为 Tauri 主线 |
| `apps/mobile/android` | 从主 UI 工程降级为插件实现来源或迁移参考 |
| `apps/mobile/ios` | 从主 UI 工程降级为插件实现来源或迁移参考 |
| `apps/mobile/flutter` | 已移除，不再作为代码路径保留 |
| `apps/desktop` | 需要抽 shared UI/runtime/API，避免破坏现有 Desktop |
| `packages` | 需要新增 shared client packages |
| `model/domain` | 原则不变；如缺协议，仍 proto-first |
| `tooling/scripts` | 需要新增 mobile Tauri dev/build scripts |
| CI | 需要新增 mobile check/build 入口 |

---

## 7. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| Tauri Mobile plugin 成熟度不足 | P1 spike 先验证 push、secure storage、deep link、Applet |
| Desktop 抽包导致现有体验退化 | P2 采用兼容 adapter，Desktop check 必须持续通过 |
| Mobile 变成桌面缩小版 | `client-ui` 必须定义 mobile-first primitives |
| WebView 后台不可用 | 后台能力放 native plugin，恢复前台强制 reconcile |
| Applet Lynx 嵌入复杂 | 先做 Lynx plugin spike，失败再转 WebView applet runtime |
| 文档真源冲突 | P0 先迁移 docs，再进入代码实现 |
| Store 审核风险 | P8 增加权限、隐私、动态内容说明 checklist |

---

## 8. 成效评估

正向指标：

- Desktop / Mobile 共享 UI/runtime/API 代码比例提升。
- Mobile 核心页面不再有 Android / iOS 双实现差异。
- Chat / Notification 状态在 Desktop 和 Mobile 间最终一致。
- 新增一个跨端页面时，Mobile 适配成本低于原生双端分别实现。
- Mobile MVP 能完成登录、收发消息、通知跳转、Profile 查看。

反指标：

- Mobile 页面大量 fork Desktop 组件而没有 mobile-first 适配。
- Runtime 状态依赖页面 mount 或 tab click 刷新。
- Native plugin 直接处理业务状态。
- 原生双端 UI 继续新增主线能力，导致双轨并行。
- Tauri Mobile 只能 demo，无法完成真机 push / secure storage / deep link。

治理动作：

- P1 未通过时不得进入 P2-P8。
- P2 影响 Desktop 时必须先修复 Desktop 回归。
- P4 未完成前不得宣称 Chat / Notification MVP 完成。
- P6 未完成 secure storage 前不得持久化真实 token。

---

## 9. 验证命令草案

最终命令以实际脚本为准，目标形态如下：

```bash
pnpm mobile:check
pnpm mobile:dev:ios
pnpm mobile:build:ios
```

共享层回归：

```bash
pnpm desktop:check
pnpm --filter @peers-touch/client-ui run check
pnpm --filter @peers-touch/client-runtime run check
pnpm --filter @peers-touch/client-api run check
```

---

## 10. 第一批任务建议

1. 完成 P0 文档真源迁移 PR。
2. 初始化 Tauri Mobile spike 分支。
3. 跑通 iOS / Android 空壳启动。
4. 接入 Station health/auth API。
5. 验证 secure storage 与 deep link。
6. 抽 `client-platform` 最小接口。
7. 抽 Auth + Chat 所需的 `client-api` 最小子集。
8. 做 Chat 会话列表 skeleton。
9. 验证前台 event stream projection。
10. 输出 P1 spike report，决定是否进入 P2。
