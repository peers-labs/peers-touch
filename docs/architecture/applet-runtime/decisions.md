# Applet Runtime Architecture — 设计决策

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-05-19 | **Updated**: 2026-05-19
> **Owner**: Architecture Team
> **Module**: `apps/desktop/src/applet/`, `apps/mobile/`, `packages/applet-sdk/`, `packages/applets/`

---

## 决策索引

| ID | 决策 | 状态 |
|----|------|------|
| D-01 | Applet UI 统一采用 Lynx / ReactLynx | accepted |
| D-02 | Desktop 使用 Lynx for Web `<lynx-view>` | accepted |
| D-03 | Mobile 使用原生 LynxView | accepted |
| D-04 | 删除 iframe runtime 路线 | accepted |
| D-05 | Capability Gateway 由 Host 强制执行 | accepted |
| D-06 | Applet SDK 只暴露跨端能力接口 | accepted |
| D-07 | Manifest / Bridge / Bundle 协议先于功能扩展稳定 | accepted |
| D-08 | 第一阶段避免复杂 Web 图表依赖 | accepted |

---

## D-01: Applet UI 统一采用 Lynx / ReactLynx

**Status**: accepted
**Date**: 2026-05-19

### Context

Applet 前端必须同时运行在 Desktop、Android、iOS。React DOM 只能保证 Desktop Webview 可运行，不能保证 Mobile 原生 LynxView 可运行。

### Decision

正式 Applet UI 统一使用 ReactLynx 与 Lynx 元素编写。业务代码可继续保持 domain / application / infrastructure / presentation 分层，但 presentation 层必须是 Lynx UI。

### Rationale

- Lynx 是当前已确认的跨端 Applet 容器方向。
- ReactLynx 能保留 React 心智，同时输出 Lynx Runtime 可运行的 bundle。
- 一套源码构建多端 bundle，符合长期跨端复用目标。

### Alternatives Considered

- **React DOM + WebView/iframe**：开发快，但 Mobile 无法原生复用，安全边界差。
- **原生双端分别写 UI**：体验可控，但 Applet 失去“一套前端”价值。
- **Flutter / Dart**：项目已明确废弃 Flutter 路线。

### Consequences

- 现有 React DOM Applet 需要迁移 UI 层。
- 复杂 Web 组件无法直接复用。
- Applet 开发者必须接受 Lynx 的元素、样式、运行时限制。

---

## D-02: Desktop 使用 Lynx for Web `<lynx-view>`

**Status**: accepted
**Date**: 2026-05-19

### Context

Desktop 是 Tauri Webview + Rust Runtime。Desktop 需要承载 Lynx Applet，但不应通过 iframe 模拟小程序容器。

### Decision

Desktop `<lynx-host>` 是 Peers-Touch Host 封装，内部使用 Lynx for Web 的 `<lynx-view>` 加载 Desktop web bundle。

### Rationale

- 与 Mobile 的 Lynx 编程模型一致。
- 不需要在第一阶段把 C++ LynxView 直接嵌入 Tauri 原生窗口。
- 能复用 Tauri Rust 作为 Capability Gateway。

### Alternatives Considered

- **Tauri 直接嵌原生 C++ LynxView**：理论更接近原生，但 macOS/Windows 集成成本高，当前不适合作为第一阶段。
- **Shadow DOM + dynamic import React bundle**：适合可信插件，不满足 Lynx 跨端和强治理目标。
- **iframe**：明确拒绝，安全和架构语义都不符合长期方案。

### Consequences

- 需要验证 Lynx for Web 在 WebView2 / WKWebView 中的兼容性。
- 需要处理 Worker、asset path、custom protocol、CSP 等 Desktop 特有问题。

---

## D-03: Mobile 使用原生 LynxView

**Status**: accepted
**Date**: 2026-05-19

### Context

Mobile 已明确是 Android Kotlin/Compose 与 iOS Swift/SwiftUI 双原生路线，Applet 容器方向是 Lynx。

### Decision

Android 使用 LynxView 嵌入 Compose / 原生 View，iOS 使用 LynxView 嵌入 SwiftUI / UIKit 桥接层。

### Rationale

- Mobile 对性能和启动速度要求更高，原生 LynxView 比 WebView 更合适。
- Lynx 原生引擎提供更好的移动端渲染管线。
- 与官方 Lynx 集成路径一致。

### Alternatives Considered

- **Mobile WebView 承载 Web bundle**：简单但性能与体验上限低。
- **Compose/SwiftUI 重写每个 Applet**：失去 Applet 跨端价值。

### Consequences

- Mobile Host 需要实现 Lynx 初始化、Bundle loader、NativeModule bridge、生命周期管理。
- Applet UI 必须遵守 Lynx 支持的元素和样式能力。

---

## D-04: 删除 iframe runtime 路线

**Status**: accepted
**Date**: 2026-05-19

### Context

历史实现曾出现 `<lynx-host>` 内部创建 iframe，并通过 postMessage 做 RPC。这会造成“名称是 Lynx，实际是 iframe”的架构漂移。

### Decision

正式 Applet Runtime 不允许 iframe 加载 Applet，不允许 `window.parent.postMessage` 作为 Bridge 主链。

### Rationale

- iframe 与 Lynx Runtime 不是同一类容器。
- iframe sandbox 容易出现配置误用和越权面。
- postMessage 协议难以做到和原生 LynxView 一致。
- 继续保留会让 Desktop 与 Mobile 走向双栈分裂。

### Alternatives Considered

- **保留 iframe 作为 fallback**：短期容错更强，但长期会阻碍迁移和治理。
- **只加固 iframe 安全**：能降低风险，但不能解决跨端一致性问题。

### Consequences

- 存量 React DOM Applet 需要重新适配或迁移。
- Desktop 必须先完成 Lynx for Web 容器 POC。

---

## D-05: Capability Gateway 由 Host 强制执行

**Status**: accepted
**Date**: 2026-05-19

### Context

Applet 是可扩展代码，不能默认信任。网络、存储、配置、通知、系统信息都涉及权限和审计。

### Decision

所有敏感能力调用必须进入 Host Capability Gateway，由 Host 做 session 校验、Manifest 权限校验、参数校验、审计和执行。

### Rationale

- 安全边界从“前端约定”升级为“Host 强制”。
- Desktop 可复用 `desktop-rust` 作为本地 BFF / command gateway。
- Mobile 可在 Native bridge 层执行同等策略。

### Alternatives Considered

- **SDK 内部自行判断权限**：容易被绕过。
- **Applet 直接 fetch/直接 localStorage**：不可审计，无法跨端一致。

### Consequences

- Gateway 需要维护能力注册表与权限矩阵。
- 每个端都必须实现一致的错误码和审计语义。

---

## D-06: Applet SDK 只暴露跨端能力接口

**Status**: accepted
**Date**: 2026-05-19

### Context

Applet 开发者需要稳定 API，但不应知道 Desktop、Android、iOS 的 Bridge 注入细节。

### Decision

`packages/applet-sdk` 只暴露跨端接口，例如 `storage.get`、`network.request`、`config.get`、`system.getInfo`。底层通过 Lynx NativeModules 或等价桥接调用 Host。

### Rationale

- 保持 Applet 源码跨端一致。
- Host 可以独立演进 Bridge 实现。
- SDK 可做类型收口、错误归一、能力发现。

### Alternatives Considered

- **Applet 直接调用 NativeModules**：破坏封装，导致平台分支扩散。
- **每个平台一个 SDK**：短期可行，长期形成生态割裂。

### Consequences

- SDK 必须严格版本治理。
- Bridge breaking change 必须同步升级 SDK 和 Host。

---

## D-07: Manifest / Bridge / Bundle 协议先于功能扩展稳定

**Status**: accepted
**Date**: 2026-05-19

### Context

Applet 生态一旦扩展，协议漂移会造成 Host、SDK、Applet、构建工具多方不一致。

### Decision

先稳定 Manifest、Bridge、Bundle Target、Capability 方法命名和生命周期状态机，再扩展复杂功能。

### Rationale

- 协议是生态边界，不是某个功能的内部实现。
- 稳定协议能降低 Applet 开发和 Host 升级成本。

### Alternatives Considered

- **边做功能边补协议**：速度快但会产生历史包袱。

### Consequences

- 第一阶段功能范围必须克制。
- 构建校验、运行时校验、CI contract test 要先落地。

---

## D-08: 第一阶段避免复杂 Web 图表依赖

**Status**: accepted
**Date**: 2026-05-19

### Context

big-a 的首个面板需要图形化展示多空力量，但 Lynx 跨端不等于 Web DOM 全能力。

### Decision

第一阶段使用 Lynx 原生布局实现得分条、维度卡片、文本研判，不引入 SVG/Antd/LobeUI/DOM Canvas 作为跨端基础。复杂图表在容器和 Bridge 稳定后专项评估。

### Rationale

- 先验证端到端架构链路，比先追求复杂 UI 更重要。
- 避免将 Web-only 组件带入跨端 Applet 主线。

### Alternatives Considered

- **直接迁移现有 SVG 雷达图**：Desktop 可能可行，但 Mobile 风险高。
- **引入 Web 图表库**：不符合 Lynx 跨端约束。

### Consequences

- 第一版视觉表现会比 Web 图表克制。
- 后续需要针对 Lynx Canvas / 自定义元素评估图表能力。
