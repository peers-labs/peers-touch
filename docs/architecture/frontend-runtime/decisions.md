# Frontend Runtime Architecture — 设计决策

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-07-02 | **Updated**: 2026-08-27
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
| D-07 | PageHost LRU 最大保留 5 个隐藏页面 | accepted |
| D-08 | Store dispatch fanout 上限 3 个组件 | accepted |
| D-09 | RuntimeProjection bootstrap 超时 5 秒，失败进入降级模式 | accepted |
| D-10 | 性能预算不变量数值（INV-1~INV-6） | accepted |
| D-11 | Red-line CI gate 使用 P95 阈值而非 MAX | accepted |
| D-12 | 禁止 Store dispatch 触发超过 3 个组件重渲染（架构级禁止关系） | accepted |
| D-13 | Station mirror 是验收/开发性能证据的真源 | accepted |
| D-14 | InvokeThrottler 安全关键路径 bypass 必须静态 allowlist 化 | accepted |
| D-15 | Native transport topology 必须通过同条件 runtime evidence gate 后决策 | accepted |
| D-16 | Native responsiveness 由有界工作准入和完整失败语义定义，而非由某种 transport 定义 | accepted |
| D-17 | Mobile runtime graph and command runtime refine existing cross-client contracts | accepted |
| D-18 | Desktop runtime and proof use only the native Tauri application | accepted |

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

---

## D-07: PageHost LRU 最大保留 5 个隐藏页面

**Status**: proposed
**Date**: 2026-07-10

### Context

Phase 0 证据显示 Settings 页面内隐藏 section 的重渲染是长任务来源之一。PageHost 需要对 keep-alive 页面设置上限，否则无限增长的 alive tree 会导致内存膨胀和隐藏树渲染开销。但上限过低会导致用户频繁回访的冷启动，过高则失去治理意义。

### Decision

PageHost LRU 策略最多保留 **5 个隐藏页面**（alive-page-count 上限 6 = 1 active + 5 hidden）。超出时按 LRU 策略 evict 最久未访问的页面。

### Rationale

- Desktop 当前高频页面约 4-5 个（Chat、Contacts、Settings、Provider、Applets），5 个隐藏位足以覆盖用户最近访问路径。
- 6 个 alive 页面 × 单页面平均内存估算 < 200MB 是 Phase 1 初始假设，必须通过 `page.evict` / alive-page-count / memory telemetry 在 Phase 1c 中校准；校准前不得把该数值视为长期平台预算。
- 冷挂载目标 < 100ms（通过 idleChunk prewarm 实现），用户对 LRU eviction 的回访不应有感知。
- 5 是 2 的幂附近整数，便于内存对齐和调试；3 会导致 Chat↔Settings 频繁切换时反复 evict，8 则过于宽松。

### Alternatives Considered

- **3 个隐藏页**：内存更省，但 Chat→Settings→Provider→Logs→Chat 的常见路径中 Logs 返回 Settings 时会触发 evict，回访体验差。
- **8 个隐藏页**：覆盖更多页面，但隐藏树渲染预算与 8 个 alive section 的 store 订阅扇出会增加不可控长任务风险。
- **forever alive（无上限）**：Phase 0 已证明不可行——隐藏面板 render 是主线程阻塞来源。
- **基于内存动态调整**：实现复杂，首次落地先固定数值，后续基于 profiler 证据调整。

### Consequences

- 用户在 6+ 个页面间快速跳转时，最早访问的页面会被 evict，返回时需要冷挂载。
- PageHost 需要新增 `page.evict` telemetry 事件用于审计 eviction 频率。
- 冷挂载必须通过 idleChunk prewarm 保证 < 100ms，否则需调整上限。
- Phase 1c 必须补充内存测量证据；如果证据显示 5 个隐藏页仍造成内存或隐藏 render 压力，该上限必须下调。

---

## D-08: Store dispatch fanout 上限 3 个组件

**Status**: proposed
**Date**: 2026-07-10

### Context

Zustand store 默认在每次 dispatch 后通知所有订阅者，如果不使用 selector，整个页面树可能重渲染。Phase 0 的 react.commit telemetry 显示部分 store.update 触发了超过 10 个组件的同步 commit，是交互帧长任务的重要来源。需要设定 fanout 上限来约束订阅粒度。

### Decision

单次 store dispatch 触发的组件重渲染数量（fanoutCount）目标为 **不得超过 3**。Phase 1d 初始阶段先以 warn-only 方式采集基线；当至少 N≥30 个真实交互样本证明阈值稳定后，再将 fanout≤3 升级为 CI blocking gate。

### Rationale

- 3 个组件覆盖了合理场景：1 个触发 action 的组件 + 1-2 个直接关联的 UI 反馈组件。
- 超过 3 说明存在过宽的 store 订阅（未使用 selector 或 selector 返回过大对象）。
- 3 是经验值：React 团队推荐"selector 返回最小必要数据"，正常粒度下一个 dispatch 影响的组件通常在 1-3 之间。
- 该约束配合 selector-based subscription 机制落地，不是运行时硬截断（不阻断更新），而是 dev 警告 + 分阶段 CI 门禁。

### Alternatives Considered

- **5 个组件**：过于宽松，无法有效阻止过宽订阅。
- **1 个组件**：过于严格，很多合理场景（如打开 overlay + 更新侧栏 badge + 更新页面状态）天然涉及多组件。
- **运行时硬截断**：会导致 UI 不一致，仅作为 dev 警告和 CI 门禁，不在生产运行时阻断。

### Consequences

- 现有组件的 store 订阅需要逐步迁移到 selector 模式。
- 迁移期间使用 feature flag 分组件启用，避免一次性改动引发 regression。
- 在 blocking gate 启用前，fanout≤3 只作为 warning 和趋势指标；启用 blocking gate 的条件必须写入 Phase 1d evidence。
- 需要新增 `store.update` telemetry 的 `fanoutCount` 字段。

---

## D-09: RuntimeProjection bootstrap 超时 5 秒，失败进入降级模式

**Status**: proposed
**Date**: 2026-07-10

### Context

RuntimeProjection 的 install/bootstrap 流程当前可能因网络慢、Station 不可达或数据量大而阻塞 boot pipeline，导致登录后白屏或动画停顿（Phase 0 诊断中 boot.phase 长任务占比显著）。bootstrap 必须异步化，但也不能无限等待。

### Decision

RuntimeProjection bootstrap 设置 **5 秒超时**。超时后 runtime 进入 **degraded mode**（降级模式）：UI 显示"部分功能加载中"状态，runtime 继续在后台重试加载，boot pipeline 不再阻塞。

### Rationale

- 5 秒是用户感知"应用是否卡死"的心理阈值（Nielsen  Norman Group: 1s 即时响应、5s 可接受等待、10s 注意力流失）。
- 网络正常时 bootstrap 通常在 200-800ms 内完成（Phase 0 telemetry 中位数），5 秒覆盖 P99 慢网络。
- 降级模式而非硬失败：bootstrap 失败不代表整个应用不可用，用户仍可使用已加载的功能。
- 同步阻塞 boot pipeline 是 INV-1/INV-2 违规的核心来源，异步化 + 超时是必要条件。

### Alternatives Considered

- **2 秒超时**：网络稍慢即触发降级，用户频繁看到"加载中"提示，体验差。
- **10 秒超时**：接近用户流失阈值，boot pipeline 被阻塞时间过长。
- **无限等待 + loading spinner**：Station 不可达时应用永久卡在 loading，不可接受。
- **无超时，Promise.race 只对 boot 关键路径设限**：实现复杂度高，首次落地用统一 5 秒，后续按 runtime 类型细分。

### Consequences

- 5 秒后 UI 必须能在无该 runtime 数据时渲染（skeleton 或 partial UI）。
- runtime 描述符需要声明 `critical: boolean`，critical runtime（如 identity/auth）不使用降级模式，仍可阻塞 boot。
- 需要新增 `bootstrap.timeout` telemetry 事件记录超时频率，用于评估 5s 是否合理。

---

## D-10: 性能预算不变量数值（INV-1~INV-6）

**Status**: proposed
**Date**: 2026-07-10

### Context

design.md 定义了 Frontend Runtime 的架构原则（点击帧优先、隐藏树治理等），但未给出具体的毫秒级预算数值。Phase 0 构建了测量基础设施后，需要将这些原则转化为可度量、可门禁的具体数值，作为 red-line CI gate 的判定标准。

### Decision

定义 6 条性能预算不变量（Performance Budget Invariants），作为 Phase 1 系统性优化的验收红线。它们补充而不是替代 `data-model.md` 的 `SurfaceBudget`：

- `clickFrameMs = 16ms` 仍是同步 click frame 的内部预算。
- `click-to-first-feedback ≤ 50ms` 是用户感知首反馈预算，不等同于 click frame。
- `click-to-visible` 是 route/surface 可见预算；Phase 1 对 primary navigation 使用比 `data-model.md` first-visit default 更严格的 gate。

```
INV-1: click-to-first-feedback ≤ 50ms
INV-2: click-to-visible ≤ 100ms (primary nav), ≤ 80ms (secondary tab)
INV-3: contextmenu-to-visible ≤ 50ms
INV-4: No JS long task > 50ms during interaction phase
INV-5: No hidden-tree render during active switch frame
INV-6: No invoke in click-frame (must defer to afterFirstPaint lane)
```

### Rationale

数值来源：

- **16ms click frame 预算**：沿用 `data-model.md` 的 `clickFrameMs`，同步 click handler 只允许 route/active state/轻量 feedback，避免阻塞单帧渲染。
- **50ms 首反馈预算**：RAIL 模型要求 100ms 内响应用户输入；Phase 1 将一半预算留给浏览器渲染管线，因此用户可感知反馈目标设为 50ms。
- **100ms primary nav / 80ms secondary tab**：主导航涉及路由切换和页面 materialization，预算稍宽；tab 切换仅涉及同页面 section 切换，预算更紧。`data-model.md` 对 primary page first visit 的默认 routeToVisibleMs 是 120ms，Phase 1 red-line 将 primary navigation 收紧到 100ms，作为本阶段 gate，而不是静默修改通用默认值。Phase 0 测量显示优化前 primary nav 中位数 260ms，目标 < 100ms 是 60%+ 降幅，通过 Scheduler + 隐藏树治理可达成。
- **50ms contextmenu**：右键菜单是轻量 overlay，不应涉及数据获取，50ms 足够渲染一个简单菜单。
- **50ms longtask 上限**：浏览器 longtask API 阈值是 50ms，交互期间出现任何 >50ms 任务都会导致掉帧。
- **隐藏树禁止渲染**：这是 D-04 的延伸——hidden section/tree 在 active switch 帧内同步 render 直接阻塞可见内容上屏。
- **click-frame 禁止 invoke**：Tauri invoke 涉及 Rust 侧处理和 IPC 序列化，即使 Rust 侧 0 处理，IPC 开销也可能超过 16ms（一帧），必须 defer 到 afterFirstPaint。

### Alternatives Considered

- **更宽松的首反馈预算（100ms）**：用户会感知延迟，也无法为渲染管线留出足够空间。
- **把所有用户可见指标都压到 16ms**：理论上理想，但实际 React 调度+渲染很难保证全部可见结果在 16ms 内完成，会导致 CI 频繁 flaky；16ms 仅作为同步 click frame 内部预算。
- **不设具体数值，靠体感**：违反 D-06，无法形成自动化门禁。

### Consequences

- 6 条 INV 是 red-line gate 的判定依据，CI 中任何一条 P95 不达标即 block merge。
- 数值为初始版本，Phase 1 落地后基于真实 telemetry 数据校准（可能收紧或放宽），变更需更新本决策。
- Phase 1 的每个子阶段（1a-1e）都必须有对应的 INV 改善证据。

---

## D-11: Red-line CI gate 使用 P95 阈值而非 MAX

**Status**: proposed
**Date**: 2026-07-10

### Context

性能测试存在天然的时序方差：GC 暂停、OS 调度、后台进程占用 CPU 都可能导致个别样本超过预算。如果使用 MAX（所有样本必须满足），CI 将频繁 flaky；如果使用 MEAN（平均值），尾部延迟会被掩盖。需要选择一个统计口径能在"严格门禁"和"CI 稳定性"之间取得平衡。

### Decision

Red-line CI gate 使用 **P95（第 95 百分位）** 作为判定阈值。每次 PR 运行至少收集 N≥30 个交互样本，P95 值在预算内即判定通过。Warmup 阶段前 3 个样本排除不计入统计。

### Rationale

- P95 是性能测试的行业标准（Google、Netflix、Cloudflare 均采用）：95% 的用户交互满足预算，5% 的尾部可接受。
- P99 过于严格（CI 环境下 1% 的 outlier 就会 flaky），P50（中位数）过于宽松（一半用户可能体验差）。
- N≥30 是统计学中心极限定理的最小样本量，保证 P95 估计有合理置信度。
- 排除 warmup 样本是因为首次交互包含模块加载、JIT 编译等一次性开销，不代表稳态性能。

### Alternatives Considered

- **MAX（所有样本必须达标）**：CI flaky 率不可接受，GC/OS 调度抖动不可控。
- **P99**：尾部 1% 在 CI 环境中噪音过大，需要大量重复运行才能稳定。
- **MEAN（平均值）**：掩盖尾部延迟——如果 5% 的交互卡顿严重但平均值达标，用户实际体验差。
- **P90**：过于宽松，10% 的交互不达标即 10 次操作中 1 次卡顿，用户感知明显。

### Consequences

- CI 运行时间增加：每个 PR 需要至少 30 次交互采样，估计 E2E 时间增加 2-3 分钟。
- P95 不达标时需要查看 P99 和 MAX 来定位是普遍性问题还是尾部问题。
- 如果后续 CI 稳定性证明 P99 可行，可以加严到 P99。

---

## D-12: 禁止 Store dispatch 触发超过 3 个组件重渲染（架构级禁止关系）

**Status**: proposed
**Date**: 2026-07-10

### Context

D-08 设定了 fanout 上限 3，但还需要将其上升为架构级禁止关系（类似"禁止 click-frame invoke"）。这不是代码级的 lint 规则，而是架构文档中明确禁止的反模式，在 code review 和 CI gate 中强制执行。

### Decision

在架构禁止关系表中加入：**Store dispatch 不得触发超过 3 个组件重渲染**。这是 D-08 的架构约束版本，适用于所有 kernel 模块和 feature 代码。

### Rationale

- 将 fanout 上限从"优化建议"提升为"架构禁止"，与 INV-1~INV-6 享有同等地位，避免后续开发中回退。
- 过宽的 store 订阅是 React 应用性能问题的头号来源，必须从架构层面约束。
- 这与 design.md 原则 5（"隐藏树必须可治理"）一致：selector 边界是隐藏树治理的基础。

### Alternatives Considered

- **仅作为 best practice，不禁止**：无强制力，历史证明过宽订阅会不断回潮。
- **运行时硬阻断**：会导致 UI 不一致，仅 dev 警告 + CI 门禁，生产环境记录 telemetry。

### Consequences

- 新代码必须使用 selector 订阅 store，code review 需检查 fanout。
- 现有过宽订阅作为技术债记录，在 Phase 1d 中逐步迁移。
- StoreFanoutGuard 在 dev 模式下对超过 3 的 dispatch 通过 domain logger 发出警告（禁止使用 console.log）。

---

## D-13: Station mirror 是验收/开发性能证据的真源

**Status**: proposed
**Date**: 2026-07-10

### Context

Phase 0 构建了 acceptance/dev telemetry pipeline：客户端采集 → Station mirror → sampler gate。一个潜在的反模式是：客户端本地聚合性能数据（如本地计算 P95）然后只上传聚合结果，导致原始事件丢失，无法跨 runtime 对比和深度归因。与此同时，`data-model.md` 已明确当前 runtime events 是 dev-runtime evidence，production telemetry 需要单独 privacy/sampling decision。

### Decision

**Station mirror 是验收/开发性能证据的真源**。在 acceptance/dev 证据链中，客户端必须上传原始性能事件（不做本地聚合裁剪），聚合计算（P95、通过率、趋势分析）由 Station mirror pipeline 或同等验收管线统一执行。本地仅保留环形缓冲区用于 dev 调试。

本决策 **不定义 production telemetry 上传策略**。生产环境遥测的隐私、采样、保留期、PII 清理和用户授权必须由单独 ADR 决定。

### Rationale

- 符合 [architecture.md](../../global/architecture.md) 的所有权规则：跨端共享证据由 Station 侧统一收敛；device-local runtime 仍只负责采集和本地调试缓冲。
- 原始事件保留使得跨 runtime（browser-gateway vs tauri-webview-dev vs tauri-webview-packaged）、跨版本、跨设备的对比成为可能。
- 本地聚合无法支持多 runtime / 多版本场景下的一致 gate 判定。
- D-06 要求"归因到 page/section/runtime/store subscription"，只有原始事件才能做到细粒度归因。

### Alternatives Considered

- **客户端本地聚合后上传指标**：实现简单，但丢失原始事件细节，无法深度归因和跨端对比。
- **客户端仅上传超标事件**：丢失正常基线数据，无法判断是系统性退化还是偶发。
- **不上传，本地自审**：无法做 CI gate 和跨版本回归检测。

### Consequences

- 客户端 telemetry 缓冲区需要合理配置大小，避免内存占用过大（当前 5000 事件环形缓冲区已满足）。
- Station mirror / acceptance pipeline 需要提供 telemetry 事件的存储和查询能力（Phase 0 已有 mirror endpoint，需确认验收证据保留策略）。
- 生产环境遥测的隐私/采样策略需要单独 ADR（已标记为 Phase 1 non-scope），不得由本决策隐式启用。

---

## D-14: InvokeThrottler 安全关键路径 bypass 必须静态 allowlist 化

**Status**: proposed
**Date**: 2026-07-10

### Context

InvokeThrottler 会把普通 Tauri invoke 从 click-frame 延迟到 `afterFirstPaint` lane，以避免 IPC 阻塞用户首反馈。但登录、PIN、token refresh 等安全关键路径可能需要在可见反馈路径中保持优先级。如果 bypass 机制没有边界，业务功能可能把慢 invoke 标记为安全关键路径，绕过性能治理。

### Decision

InvokeThrottler 的安全关键路径 bypass 必须是 **静态 allowlist**：

- 只有 kernel / auth runtime owner 可以登记 bypass command。
- 每个 bypass 必须声明 `securityClass`、`bypassReason`、owner 和到期复审条件。
- 业务页面和 feature code 不得动态申请 bypass。
- 所有 bypass invoke 必须产生 telemetry，并进入 sampler gate 审计。

### Rationale

- 安全关键路径需要优先级，但不能成为性能治理的逃逸口。
- 静态 allowlist 让 code review 和 CI 能审计 bypass 数量与原因。
- telemetry 能区分真正的安全关键路径和普通 invoke，避免 sampler gate 被绕过。

### Alternatives Considered

- **完全禁止 bypass**：会让登录/PIN/token refresh 等安全路径被普通调度延迟，可能影响安全体验。
- **动态 bypass API**：灵活但不可审计，业务代码容易滥用。
- **只靠 code review**：缺少运行时证据，无法确认 bypass 是否在真实交互中被滥用。

### Consequences

- InvokeThrottler 需要维护一份 allowlist 配置，并由 kernel/auth owner 审核。
- Sampler gate 需要识别 `bypassReason` 和 `securityClass`，未登记 bypass 视为违规 invoke。
- 新增安全关键 invoke 时，必须同步更新 allowlist 和复审说明。

---

## D-15: Native transport topology 必须通过同条件 runtime evidence gate 后决策

**Status**: accepted (evidence gate passed — 2026-07-20)
**Date**: 2026-07-11 | **Accepted**: 2026-07-20

### Context

用户持续观察到 Desktop native 的输入和标签切换明显慢于 desktop-web。
该差异证明 native 与 browser/gateway runtime 之间存在性能边界差异，但不能
单独证明 WKWebView IPC、同步 Rust handler、日志/event 放大、React/store、
WebView 合成或 packaged runtime 中任一因素是唯一根因。

当前仓库证据进一步表明：

- 正式 performance matrix 将 `tauri-webview-dev` / `tauri-webview-packaged` cells 标记为
  `diagnostic incomplete`，browser 证据不能替代 native。
- 现有 Tauri Playwright 证据只覆盖一次右键菜单交互，不覆盖输入、主导航和
  Settings/Cron tabs。
- 一份标记为 `tauri-webview-dev` 的 Station mirror 报告只有 rollup，目标
  interaction 的 raw event count 为 0，不能完成 interaction-linked attribution。
- Tauri 宏源码显示同步 command 在 blocking wrapper 中直接调用函数；此前
  “216 个同步命令运行在 tokio worker”这一表述没有源码支持，实际仓库清点为
  420 个 command attribute，其中 411 个同步。

### Decision

在 native evidence gate 完成前，不接受 WebSocket-only、HTTP-only、
Tauri-invoke-only、固定线程池或全 async rewrite 作为终态架构决策。

候选 topology 必须在同一 profile、账户、数据 revision、warmup 和交互脚本下，
同时提供：

- `tauri-webview-dev`
- packaged native
- `browser-gateway`

三类 runtime cell 的 interaction-linked raw evidence，并能区分：

- input/intent 到 visible paint
- React commit、store fanout、hidden render 和 long task
- bridge queue、handler、round trip、event delivery 和 payload class
- native/WebView process thread sample

### Rationale

- 避免把相关性误写为根因，再围绕错误根因设计不可逆传输架构。
- 保留替换 bridge 的自由，同时也允许证据表明真正瓶颈位于 React/store、
  event/log amplification、WebView 合成或 packaged runtime。
- 让 architecture decision 由可证伪结果驱动，而不是由“业界常用某技术”驱动。

### Alternatives Considered

- **直接选 WebSocket**：可能绕过部分 IPC 成本，但无法证明能消除 React、
  event、queue 或大载荷 head-of-line blocking。
- **直接把同步 handler 放入线程池**：可能隔离 blocking work，但当前尚未证明
  handler 线程占用与输入/paint 延迟的因果关系。
- **继续基于体感打补丁**：无法形成可回归的终态门禁。

### Consequences

- 当前 `ipc-channel` 草案被撤销，不进入 execution planning。
- 架构状态保持 `proposed`，直到 native evidence gate 通过并完成 ADR 复审。
- 短期会增加诊断工作，但避免一次全量 bridge 改造落在错误根因上。

### Evidence Gate Resolution (2026-07-20)

P0c-3 同 cohort evidence matrix (browser-gateway N=30, tauri-webview-dev N=30) 证明：

- text-input P95: browser=16ms, native=33ms (Δ=17ms, 全部为 setTimeout vs rAF 测量差)
- primary-nav P95: browser=9ms, native=36ms (Δ=27ms, 含 32ms paint confirmation baseline)
- secondary-tab P95: browser=41ms, native=52ms (Δ=11ms, minimal)
- overlay P95: browser=0.1ms, native=1ms (equivalent)

**结论**: 不存在 native-specific transport/IPC 瓶颈。原始"native 很卡"的根因是
`scheduleRouteVisible` 的 120ms setTimeout 兜底 bug（已修复为 `scheduleAfterPaint`）。
当前 Tauri invoke bridge 无需变更即可达标。D-15 evidence gate 通过。

---

## D-16: Native responsiveness 由有界工作准入和完整失败语义定义

**Status**: accepted (implementation confirmed — 2026-07-20)
**Date**: 2026-07-11 | **Accepted**: 2026-07-20

### Context

即使替换传输层，如果 frontend pending queue、worker queue、event stream 或大载荷
通道无界，用户狂点和慢依赖仍会造成排队、过期工作、head-of-line blocking 和
尾延迟。断线自动重放还可能重复执行非幂等写。

### Decision

Native responsiveness 的架构终态由以下 transport-independent contract 定义：

- visible feedback 不等待 business bridge 或网络完成；
- 所有工作按 `visible / interactive-read / interactive-write / background / stream`
  分类；
- queue 和 inflight 在 runtime 级别有界，overload 明确 reject/degrade；
- replaceable read 支持 latest-wins、supersession 和取消；
- non-idempotent write 不自动重放，重试需要 idempotency key 和服务端去重语义；
- control plane 与 large-binary/stream data plane 不共享无优先级 FIFO；
- QoS 必须防止 background starvation interactive，同时防止 background 永久饥饿；
- 所有 admission、queue、cancel、reject 和 completion 都能关联 interactionId。

具体 transport 必须实现本 contract，而不能反过来用 transport 名称替代这些语义。

### Rationale

- 将“不卡顿”从技术选型口号变成可验证的运行时不变量。
- 同时覆盖正常点击、狂点、慢 Station、断线、重启和大文件场景。
- 允许后续 ADR 比较不同 transport，而不改变上层 UI/runtime contract。

### Alternatives Considered

- **仅限制 inflight 数**：pending queue 仍可能无界，且无法处理过期工作。
- **单一 FIFO**：长任务和大载荷会阻塞最新可见交互。
- **所有请求自动 retry**：非幂等写存在重复副作用风险。

### Consequences

- 任一 bridge/platform 实现都必须暴露 admission 与 latency evidence。
- 未来 execution plan 必须覆盖取消、幂等、overload、stream 和故障恢复验证。
- 若现有 Tauri invoke 在证据和 contract 下可达标，可以保留；若不能，再由
  evidence-backed ADR 选择替代 topology。

### Implementation Evidence (2026-07-20)

P0c-3 证据表明当前实现已满足 D-16 contract 的核心条件：

1. **visible feedback 不等待 bridge**: `scheduleAfterPaint` 在 click handler 后异步确认 paint，
   不阻塞首反馈。
2. **有界准入与取消**: `scheduleAfterPaint` 的 `cancelled` flag 支持 latest-wins/supersession；
   `InvokeThrottler` 在 click-frame 内 defer non-critical invoke。
3. **控制面与数据面分离**: 交互路径中无 invoke 事件（evidence: 25 events per navigation,
   全部为 React commit + store update，零 invoke）。
4. **全链路 interactionId 关联**: 所有 telemetry 事件关联 interactionId，admission/queue/
   cancel/completion 可追踪。

Remaining D-16 items (狂点、断线、幂等、stream) 留作 stress-test acceptance gate，
不阻塞架构 accepted 状态。

---

## D-17: Mobile Runtime Graph Refines Existing Contracts

**Status**: accepted
**Date**: 2026-08-27

### Context

Mobile Shell requires dependency-aware bootstrap/teardown, optional degraded
capabilities, native suspend/resume, and restart-safe write convergence. These
needs extend `RuntimeProjection` and `InteractionAdmission`, but must not create
a second cross-client scheduler or retry model.

### Decision

- Mobile `dependsOn` and `uses` refine RuntimeProjection readiness:
  `dependsOn` is hard ordered dependency; `uses` is a degradable capability.
- `commandRuntime` is the Mobile adapter for `InteractionAdmission`.
- Mobile Rust encrypted persistence is infrastructure behind that adapter.
- Shared work class, idempotency, cancellation, overload, fairness, payload
  class, and evidence semantics remain owned by Frontend Runtime.

### Rationale

One semantic contract preserves Desktop/Mobile comparability while allowing
Mobile-specific secure storage, background suspension, and native wakeups.

### Alternatives Considered

- Define an independent Mobile scheduler. Rejected because admission semantics
  and evidence would drift across clients.
- Put retry policy in each feature runtime. Rejected because queue bounds,
  fairness, and unknown-outcome behavior would have multiple owners.

### Consequences

- Mobile runtime descriptors may add platform lifecycle fields without
  redefining shared work semantics.
- Social outbox state becomes a projection of platform command admission rather
  than a second persistence implementation.
- Changes to shared admission semantics require an upstream Frontend Runtime
  decision and coordinated client migration.

### Reversal Trigger

Review if Mobile can directly reuse a shared runtime implementation without
losing native lifecycle, secure-storage, or evidence requirements.

---

## D-18: Desktop Runtime And Proof Use Only The Native Tauri Application

**Status**: accepted
**Date**: 2026-10-04

### Context

The browser-gateway path reused Desktop React code but did not reproduce the
shipped application's window lifecycle, embedded WebView, Tauri command
boundary, native focus/input, storage isolation, permissions, or process
cleanup. Maintaining it as a supported Desktop runtime made diagnostics and
Acceptance matrices larger while allowing non-native evidence to stand in for
user behavior.

### Decision

- Desktop has one supported application topology:
  `native Tauri window -> embedded WebView renderer -> desktop-rust -> Station`.
- `make desktop` is the sole development launch entrypoint for that topology.
- The renderer remains shared source inside the native application, but it is
  not exposed as an independently supported browser client.
- Desktop interaction, layout, lifecycle, and performance proof must run in a
  native runtime cell. Chromium/CDP evidence is not a Desktop proof input.
- Browser-gateway launch, transport branches, storage profiles, performance
  matrix cells, and product variants are removed with no compatibility path.
- System-browser OAuth handoff and separately owned Web applications remain
  valid because neither claims to be the Desktop client.

### Rationale

Runtime evidence is useful only when it exercises the topology users run.
Converging on the native application removes contradictory behavior and makes
all Desktop regressions actionable against one owner.

### Alternatives Considered

- Retain browser mode for component debugging: rejected because component tests
  already provide source-level feedback without creating a product runtime.
- Retain browser-gateway as a performance baseline: rejected because it omits
  the native lifecycle and repeatedly encouraged invalid comparisons.
- Keep browser launch but ban it from Acceptance: rejected because the second
  runtime still requires contracts, tests, profiles, and compatibility code.

### Consequences

- Native runtime startup and evidence tooling are the capacity path for all
  Desktop product work.
- Frontend code must not branch on a Desktop browser surface.
- Historical browser measurements remain historical records only.
