# Peers Touch Mobile

> Mobile platform-level source for the current Mobile mainline, target architecture, shared constraints, and responsibility boundaries.
> Since 2026-05-31, the Mobile mainline is **Tauri v2 Mobile + Shared Web UI + Rust Capability Kernel + Native Plugins**.
> The `InteractionAdmission` and Rust durable-command ownership refinement was
> accepted with the Mobile PRODUCT/DESIGN package on 2026-08-27.

---

## 1. 文档定位

本文定义：

- Mobile 平台的当前实现基线
- Mobile 平台的目标架构方向
- Tauri Mobile 与 native plugin 的共同约束
- Mobile 在整个系统中的职责边界

本文不定义：

- 详细同步协议
- Applet 容器细节
- 实施 phase 与落地进度
- 每个 native plugin 的实现细节
- 每个模块的编码规范正文

继续阅读请看：

- `native-dual-platform.md`（当前作为 Native Plugin 能力层与历史原生双端参考）
- `lifecycle.md`（Mobile 顶层生命周期：Station selection、Station/Auth gate、runtime bootstrap、foreground/background/resume）
- `../chat/chat-ux-contract.md`（Desktop 与 Mobile 共同遵守的 Chat / IM 产品体验契约）
- `chat-layout-contract.md`（Mobile Chat 布局、键盘、安全区、底部输入区、触控菜单边界契约）
- `../common/ux-design-methodology.md`（客户端 UX 问题从案例沉淀成准则、契约、invariant 的方法论）
- `../common/form-control-ux-contract.md`（跨端表单控件与组合输入控件体验契约）
- `form-control-layout-contract.md`（Mobile 表单控件、BottomSheet、触控、安全区边界契约）
- `applet-container.md`
- `sync-protocol.md`
- `execution-plans/implementation-plan-20260403.md`
- `execution-plans/20260531-tauri-mobile-mainline-migration.md`（Tauri Mobile 主线迁移实施计划）
- `../../context/mobile/tauri-mobile-capability-topology-proposal.md`（设计过程记录，不是当前真源）
- `../../architecture/platform/station-desktop-boundary.md`
- `../../global/coding-guide/mobile/`

---

## 2. 当前实现基线

当前仓库中的 Mobile 主线是：

- Tauri v2 Mobile：移动端应用壳
- Web UI：共享 Desktop 的 Web 技术栈与设计范式
- Rust Capability Kernel：Tauri commands、本地状态、能力权限、插件事件桥接
- Native Plugins：Android Kotlin / iOS Swift 系统能力接入
- 目录位置：
  - `apps/mobile/`
  - `apps/mobile/src/`
  - `apps/mobile/src-tauri/`
- `apps/mobile/src-tauri/gen/android/`
  - `apps/mobile/src-tauri/gen/apple/`

Mobile 当前已明确成立的事实：

1. Tauri v2 Mobile 是主 UI 与应用壳主线。
2. 共享契约来自 `model/domain/*.proto`。
3. 共享业务真源在 Station，不在 Mobile。
4. Mobile 通过 Station / Relay 风格链路获取共享业务数据。
5. Android Kotlin / iOS Swift 用于 native plugin，不再作为主 UI 双端实现路径。
6. Applet 方向优先验证 Tauri mobile plugin 承载 Lynx 容器。
7. Flutter 代码路径已移除，不作为当前或未来主线。

---

## 3. 平台职责

Mobile 负责：

- 移动端 Web UI 呈现
- 移动端布局、手势、导航、主题、输入法避让、安全区适配
- 本地交互与 runtime projection 编排
- 对 Station 数据的读取、展示与必要的本地缓存
- 通过 native plugins 接入移动系统能力

Mobile 不负责：

- 成为跨端共享业务真源
- 复刻 Desktop 专属窗口、托盘、菜单、多窗口能力
- 承担 Desktop 专属系统能力（窗口、托盘等）
- 让 native plugin 绕过 Station 定义私有业务协议

一句话：

- Mobile 是 Tauri 移动客户端，不是独立业务后端。

---

## 4. 技术栈约束

| 维度 | Mobile 主线 |
| --- | --- |
| 应用壳 | Tauri v2 Mobile |
| UI 框架 | Web UI（React / TypeScript，与 Desktop 范式对齐） |
| 本地核心 | Rust Capability Kernel (`src-tauri`) |
| Android 系统能力 | Tauri mobile plugin + Kotlin |
| iOS 系统能力 | Tauri mobile plugin + Swift |
| 构建工具 | Tauri CLI + pnpm + Rust toolchain + Android / Xcode toolchain |
| 架构模式 | Web UI → shared runtime → client-api / Tauri commands → Station / native plugins |
| Proto 生成 | 以 `model/domain/*.proto` 为真源；Mobile 生成链随 Tauri contract 方案演进 |
| Applet 容器方向 | 优先 LynxView native plugin；失败时评估 WebView 内 applet runtime |

说明：

- 具体依赖库可演进，但不能推翻上述平台主轴。
- 规范正文不在本文展开，详见 `docs/global/coding-guide/mobile/`。

---

## 5. 核心架构原则

1. **UI 主线统一，系统能力原生化**
   - UI/UX 范式通过 Web UI 与 shared client layer 统一
   - Android / iOS 差异沉入 native plugin
2. **Station 为真源**
   - 跨端可见业务状态由 Station 持有
3. **Runtime Projection 优先**
   - 页面只读 projection，不靠页面 mount 保持业务新鲜度
4. **Lifecycle Gate 优先**
   - 进入 Station shell 前必须先完成 Station gate 与 Auth gate
5. **Relay/Station 优先**
   - Mobile 不承担 P2P 主链职责
6. **Native Plugin 边界明确**
   - 插件只提供设备能力，不定义业务真源
7. **Applet 化边界明确**
   - 某些能力以 Applet 方式承载，而不是主 App 无限膨胀

---

## 6. 当前实现与目标架构的边界

本文区分三个概念：

### 6.1 当前实现基线

指当前仓库里已经明确存在并成立的内容，例如：

- Mobile 主线迁移到 Tauri v2 Mobile
- 原生 Android / iOS 工程不再作为主 UI 真源
- Lynx 容器方向已确定
- Station 真源原则已确定

### 6.2 目标架构方向

指平台期望收敛到的形态，但不等于“当前已全部落地”，例如：

- 与 Desktop 的 UI/UX 范式、runtime projection、API 语义逐步趋同
- Notebook / Cron 等能力通过 Applet 形态承载
- 更完整的模块化结构与统一导航策略
- 更完整的同步、事件、记忆、搜索等能力接入

### 6.3 历史与迁移材料

指曾经作为 Mobile 主线或探索路径存在，但不再作为当前主线的内容，例如：

- Android Compose / iOS SwiftUI 主 UI 双端实现
- Flutter / Dart 路径
- 原生 DTO 或 JSON 过渡模型

因此：

- 本文中的“方向”不应被误读为“全部已完成”
- 具体落地状态应放在计划或报告文档中，不混入平台总纲

---

## 7. 目标结构方向

### 7.1 Tauri Mobile Shell

目标方向是：

- `apps/mobile/src/` 承载 mobile-web UI、routes、pages、runtime glue
- `apps/mobile/src-tauri/` 承载 Rust capability kernel、commands、plugin registration
- `apps/mobile/src-tauri/gen/apple/` 承载 Tauri 生成的 iOS 工程
- 页面按 mobile-first shell 设计，不直接缩放 Desktop 页面

### 7.2 Shared Client Layer

目标方向是：

- `packages/client-ui` 承载 tokens、基础组件、响应式规则
- `packages/client-runtime` 承载跨端 session/sync/projection 与
  `InteractionAdmission` 纯语义；不直接拥有平台持久化
- `packages/client-api` 承载 Station API 与 proto contract glue
- `packages/client-platform` 承载平台能力抽象
- `apps/mobile/src/runtimes` 承载 Mobile descriptor adapters；
  `mobile-rust` encrypted command ledger 是 Mobile durable-command 唯一
  持久化 owner，social outbox 只做可见 projection

### 7.3 Native Plugin Layer

目标方向是：

- Android Kotlin / iOS Swift 只承载系统能力与 Tauri plugin
- push、secure storage、deep link、background sync、camera、share、biometric 等能力走 plugin
- plugin 事件进入 Rust kernel 或 shared runtime，再驱动 UI projection
- plugin 不直接拥有业务状态

---

## 8. 功能范围口径

Mobile 的目标能力范围可覆盖：

- Auth
- Chat（Friend / Group）
- AI / Agent 对话相关能力
- Search
- Timeline
- Profile
- Settings
- Channels
- Skills
- Memory
- Applets

但要注意：

- 这代表目标能力范围，不等于当前每一项都已完整落地
- Notebook / Cron 等能力优先走 Applet 形态
- Desktop 专属系统能力不属于 Mobile 范围

---

## 9. 网络与同步口径

Mobile 通过 Station 提供的 API、Relay、同步与事件机制工作。

约束：

- 不直接承担数据库真源职责
- 不引入 Desktop 专属窗口 / 托盘 / 多窗口运行时模式
- 共享业务状态依赖 Station
- 前台 event stream 与恢复前台 delta sync 必须共同维护 projection 新鲜度
- 后台 push 只用于唤醒、提示与标记 stale，不替代 authoritative sync

详细协议见：

- `sync-protocol.md`

---

## 10. 目录总览

```text
apps/mobile/
├── src/          # mobile-web UI
├── src-tauri/    # Rust capability kernel
│   └── gen/
│       ├── android/ # Tauri generated Android project
│       └── apple/   # Tauri generated iOS project
├── android/      # legacy/native plugin source during migration
└── ios/          # legacy/native plugin source during migration
```

---

## 11. 继续阅读

- [Native Dual Platform / Native Plugin Layer](./native-dual-platform.md)
- [Applet Container](./applet-container.md)
- [Sync Protocol](./sync-protocol.md)
- [Tauri Mobile Mainline Migration Plan](./execution-plans/20260531-tauri-mobile-mainline-migration.md)
- [Tauri Mobile Capability Topology Proposal](../../context/mobile/tauri-mobile-capability-topology-proposal.md)（设计过程记录）
- [Station/Desktop Scope Boundary](../../architecture/platform/station-desktop-boundary.md)
- [Mobile Coding Guide](../../global/coding-guide/mobile)
