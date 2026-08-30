# Frontend Runtime Architecture

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-07-02 | **Updated**: 2026-08-27
> **Owner**: Client Platform Team
> **Module**: `apps/desktop/src/kernel/`, `apps/desktop/src/runtimes/`, `docs/client/common/ui-identity/`

---

## 1. Document Scope

本文档定义：

- Peers Touch 大前端运行时的上游架构边界。
- 页面树、运行时投影、启动调度、隐藏树治理、动态容器和性能观测之间的职责关系。
- Desktop、Mobile、Applet/Lynx 容器可以共享的生命周期模型。
- 卡顿、停帧、tab 切换粘滞、applet 容器不直观等问题的架构级解决口径。

本文档不定义：

- 具体视觉风格；见 `docs/client/common/ui-identity/README.md`。
- Desktop 内部 PageHost/RuntimeDescriptor 代码细节；见 `docs/client/desktop/runtime-projections.md`。
- Applet SDK、服务绑定和包格式；见 `docs/architecture/applet-runtime/README.md`。
- 具体编码规范；见 `docs/global/coding-guide/`。

## 2. 背景与问题

Peers Touch Desktop 已经具备 `PageHost`、`PageDescriptor`、`RuntimeDescriptor`、UI component tree registry 等基础，但近期登录和 tab 切换卡顿暴露出一个上游缺口：我们有 UI 树标准，却还没有把“大前端运行时”作为系统级架构来约束。

典型症状：

- 登录/PIN 后背景动画停顿，说明认证 click frame 被 runtime bootstrap 或 store hydration 抢占。
- 主侧栏和 Settings tabs 切换粘滞，说明隐藏 alive tree、宽 store 订阅或重 section 挂载在同一帧竞争。
- Applet runtime 页面能跑，但容器产品语义不足，缺少独立运行、容器内全屏和浮动退出/隐藏控制的正式宿主模型。
- 性能问题只能靠人工截图和体感反馈定位，缺少 route-to-visible、long task、hidden render、mount cost 等内建证据。
- Desktop native 明显慢于 desktop-web 是已观察到的 runtime 差异，但当前 Tauri WebView matrix cell 仍是 `UNPROVEN`；它不能直接证明 WKWebView IPC、Rust handler、React/store 或日志/event 放大中的任何一项是唯一根因。

这些问题不是传统 JS 层面的局部优化问题，而是大前端运行时问题：Shell、页面实例、业务投影、嵌入式运行容器、资源 lease、预热、保活、回收和观测必须由同一个架构模型管理。

Native 卡顿的技术拓扑仍处于 evidence gate：在 packaged/native 交互 trace 能区分 WebView 主线程、React commit、store fanout、device bridge、Rust handler、日志/event 和大载荷影响之前，不接受以 WebSocket、HTTP、Tauri invoke 或固定线程池为名的不可逆终态设计。

## 3. 设计目标

1. 把前端 UI 从“页面集合”升级为“客户端运行时系统”。
2. 统一 Desktop、Mobile、Applet/Lynx 容器的生命周期语言。
3. 让点击帧保护、idle 分片、隐藏树治理和资源回收成为架构规则，而不是事后优化。
4. 让每个页面、section、overlay、applet runtime 都有声明化 lifetime 与预算。
5. 内建性能证据，要求卡顿问题能够归因到 page、section、runtime 或 store subscription。
6. 约束 Applet 容器作为小程序宿主，而不是普通页面内嵌区域。
7. 对 native/runtime 性能问题实行 evidence-first：比较差异只能生成假设，不能替代同条件 trace 和 packaged-runtime gate。
8. 所有交互后工作必须具备有界准入、取消/合并、优先级、公平性和失败语义；“换传输”本身不视为性能闭环。

## 4. 文档导航

| 文档 | 说明 |
|------|------|
| [design.md](./design.md) | 架构设计、系统图、核心契约 |
| [decisions.md](./decisions.md) | 关键设计决策 |
| [data-model.md](./data-model.md) | 页面/section/runtime 生命周期与性能预算模型 |
| [module-layout.md](./module-layout.md) | 文档与代码模块映射 |
| [integration.md](./integration.md) | 与现有 UI Identity、Desktop Runtime、Applet Runtime 的集成 |
| [execution-plans/20260702-frontend-runtime-upgrade.md](./execution-plans/20260702-frontend-runtime-upgrade.md) | 分阶段升级执行计划 |
| [execution-plans/20260706-desktop-global-lag-framework-plan.md](./execution-plans/20260706-desktop-global-lag-framework-plan.md) | Desktop 全局卡顿框架级治理计划 |
| [execution-plans/20260706-desktop-global-lag-bom-spec-trace.md](./execution-plans/20260706-desktop-global-lag-bom-spec-trace.md) | Desktop 卡顿治理 BOM / Spec / Gate / Trace 试点 |
| [execution-plans/20260706-desktop-global-lag-phase0-construction-plan.md](./execution-plans/20260706-desktop-global-lag-phase0-construction-plan.md) | Desktop 卡顿治理 Phase 0 施工图 |
| [execution-plans/20260713-desktop-native-evidence-matrix-plan.md](./execution-plans/20260713-desktop-native-evidence-matrix-plan.md) | P0c-3 修订计划：同 cohort browser/dev-native/packaged-native 证据矩阵 |
| [execution-plans/20260710-desktop-global-lag-phase1-optimization.md](./execution-plans/20260710-desktop-global-lag-phase1-optimization.md) | 已废弃：其 Phase 0 完成前提与旧 runtime inventory 已被证伪；不得执行 |

## 5. 下游真源

本架构是上游口径。下游文档按职责落地：

- `docs/client/common/ui-identity/frontend-component-tree.md`：组件树和 alive 标准。
- `docs/client/common/ui-identity/frontend-component-tree-registry.md`：页面/section/容器生命周期登记。
- `docs/client/desktop/runtime-projections.md`：Desktop Page/Runtime/Boot 内核契约。
- `docs/architecture/mobile/`：Mobile NavigationHost、runtime dependency graph、
  native lifecycle 与 `InteractionAdmission` 平台实现。
- `docs/architecture/applet-runtime/README.md`：Applet/Lynx 运行时与小程序容器契约。
