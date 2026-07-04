# Frontend Runtime Architecture — 设计决策

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-07-02 | **Updated**: 2026-07-02
> **Owner**: Client Platform Team
> **Module**: `apps/desktop/src/kernel/`, `apps/desktop/src/runtimes/`

---

## 决策索引

| ID | 决策 | 状态 |
|----|------|------|
| D-01 | 将卡顿治理提升为 Frontend Runtime Architecture | accepted |
| D-02 | PageHost 是页面生命周期唯一 owner | accepted |
| D-03 | RuntimeProjection 是业务 freshness owner | accepted |
| D-04 | Settings/provider 使用 SectionHost 而不是页面内隐藏面板自管 | accepted |
| D-05 | Applet 容器作为一级运行单元 | accepted |
| D-06 | 性能证据内建，不依赖人工体感 | accepted |

---

## D-01: 将卡顿治理提升为 Frontend Runtime Architecture

**Status**: accepted
**Date**: 2026-07-02

### Context

登录背景动画停顿、主导航和 Settings tabs 切换粘滞，不能只解释为后端请求慢。请求少只能说明服务端压力小，前端仍可能被页面 materialization、store 广播、runtime bootstrap 或隐藏树 render 阻塞。

### Decision

将卡顿治理升级为 `docs/architecture/frontend-runtime/` 上游架构，而不是仅在 `frontend-component-tree.md` 中追加 UI 规范。

### Rationale

大前端系统包含 Desktop shell、Mobile shell、Applet/Lynx 容器、runtime projection、store subscription、boot pipeline 和资源回收。它们共同决定 UI 是否丝滑，不能由单个页面或单个 JS hook 局部治理。

### Alternatives Considered

- 只优化 React 组件：无法约束 runtime bootstrap、page prewarm、store invalidation。
- 只优化 CSS/动画：无法解决主线程被重任务抢占。
- 只改后端请求：无法解决点击帧内前端挂载和渲染竞争。

### Consequences

- 正面：卡顿问题有统一归因模型和执行计划。
- 负面：需要补内核 instrumentation、registry 预算字段和迁移治理，短期工作量增加。

---

## D-02: PageHost 是页面生命周期唯一 owner

**Status**: accepted
**Date**: 2026-07-02

### Context

Desktop 已有 `PageHost` 和 `PageDescriptor`，但 legacy fallback 和页面内 mount effect 仍可能绕过内核，导致同类页面有多套保活/预热策略。

### Decision

所有高频页面和动态页面必须通过 PageDescriptor 注册。PageHost 独占页面挂载、隐藏、LRU、eviction 和 page runtime lease。

### Rationale

只有 PageHost 具备全局视角，能统一 click frame、idle prewarm、keepAlive、LRU 和 fallback migration。

### Alternatives Considered

- 各页面自己 `useEffect` 预热：无法排序和取消。
- Router 直接 switch 渲染：会让高频页面重复 remount。
- 把所有页面 forever alive：内存和隐藏树 render 不可控。

### Consequences

- 新页面必须声明 preload、keepAlive、runtimes。
- legacy `PageRouter` 只能作为迁移 fallback，不能新增高频页面。

---

## D-03: RuntimeProjection 是业务 freshness owner

**Status**: accepted
**Date**: 2026-07-02

### Context

页面 mount/load 可以让当前屏看起来正确，但无法处理 missed event、hidden window、reconnect、identity switch 和 process resume。

### Decision

长期业务数据 freshness 必须由 RuntimeProjection 负责。页面和 section 只能渲染、触发用户动作或做 page-local one-shot prefetch。

### Rationale

RuntimeProjection 可以统一 install、bootstrap、event consumption、periodic reconcile 和 teardown，符合 Desktop 与 Mobile 双端共享运行时思路。

### Alternatives Considered

- 页面 mount 拉数据：隐藏/未挂载页面不 fresh。
- 每个组件独立订阅事件：事件消费碎片化，难以清理。
- store action 到处调用：无法证明谁是真源。

### Consequences

- 新 runtime 必须有 owner、scope、idempotent install/teardown、bootstrap/reconcile。
- 页面新增 mount-time API call 必须解释为什么不是 runtime responsibility。

---

## D-04: Settings/provider 使用 SectionHost 而不是页面内隐藏面板自管

**Status**: accepted
**Date**: 2026-07-02

### Context

Settings 是 alive primary page，但内部包含 provider、model discovery、applets、statistics、logs、help 等重 section。页面 shell alive 不等于所有 section 都应该长期隐藏保活。

### Decision

Settings/provider/logs/diagnostics 使用 SectionHost 模型：selected-only 或 intent lazy，具备 section-level budget、prefetch 和 hidden render guard。

### Rationale

Settings shell 可保留导航状态，但重 section 必须按用户意图挂载，否则切 tab 会同时承担重面板 render 和 store 更新。

### Alternatives Considered

- 所有 section 首访后 display:none：保留状态但隐藏 render 风险高。
- 每次切 tab 全卸载：状态丢失，返回慢。
- 每个 section 自己实现 lazy：策略不统一。

### Consequences

- 需要抽象 `SectionHost` / `SectionDescriptor`。
- registry 要拆出 section 预算，而不是只登记 Settings page shell。

---

## D-05: Applet 容器作为一级运行单元

**Status**: accepted
**Date**: 2026-07-02

### Context

Applet runtime 不只是页面内容。用户期望它像小程序一样运行：可以在 Desktop 容器里全屏，也可以独立窗口运行，并始终能退出、隐藏控制和调试错误。

### Decision

引入 `AppletContainerShell` 作为一级运行单元，统一 embedded、immersive、standalone 模式，拥有浮动控制、debug、lease 和恢复策略。

### Rationale

这与微信小程序、Electron/Tauri 多窗口、Lynx 容器一致：host shell 和 applet content 分离，host 负责容器生命周期，applet 负责自身内容。

### Alternatives Considered

- 在 `AppletRuntimePage` 内堆按钮：短期可用，但容器能力不可复用。
- 把 applet 当 iframe/webview 页面：忽略 Lynx bridge 和 runtime lease。
- 只做独立窗口：失去 Desktop 内嵌管理场景。

### Consequences

- `AppletRuntimePage` 应逐步瘦身为 PageBoundary。
- 容器能力迁移到 `AppletContainerShell`。

---

## D-06: 性能证据内建，不依赖人工体感

**Status**: accepted
**Date**: 2026-07-02

### Context

“非常卡”“动画停住”是有效产品信号，但工程上必须能归因到 page、section、runtime 或 store subscription，否则每次都只能人工猜。

### Decision

Frontend Runtime 必须提供 dev-only profiler，记录 route-to-visible、mount cost、hidden render count、long task、runtime bootstrap timing 和 click-frame violation。

### Rationale

性能治理要像类型检查和测试一样有证据。没有观测，就无法判断修复是否从补丁升级为架构闭环。

### Alternatives Considered

- 只靠 Chrome Performance 手工抓：成本高，不可回归。
- 只看 console log：缺少统一结构和预算。
- 只跑 E2E 截图：无法定位主线程阻塞来源。

### Consequences

- dev runtime 需要新增轻量 profiler。
- registry 的 `Evidence` 字段要记录采样结果或明确 `unproven`。
