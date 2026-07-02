# Frontend Runtime Architecture — 集成与迁移

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-07-02 | **Updated**: 2026-07-02
> **Owner**: Client Platform Team
> **Module**: `docs/client/common/ui-identity/`, `docs/client/desktop/`, `apps/desktop/src/`

---

## 1. 上下游关系

```text
docs/architecture/frontend-runtime/
  owns: cross-client runtime model, scheduling, lifetime, budget, evidence

docs/client/common/ui-identity/frontend-component-tree.md
  implements: component tree layers, alive taxonomy, review rules

docs/client/common/ui-identity/frontend-component-tree-registry.md
  records: per-surface lifetime, owner, budget, evidence

docs/client/desktop/runtime-projections.md
  implements: Desktop PageDescriptor, RuntimeDescriptor, BootPipeline

apps/desktop/src/kernel/
  implements: PageHost, Runtime registry, scheduling, profiler, SectionHost
```

## 2. 与 UI Identity 的关系

UI Identity 回答“产品应该感觉如何”；Frontend Runtime 回答“实现树怎样加载、保活、调度和观测，才能持续给出这种感觉”。

Required updates:

- `frontend-component-tree.md` 必须引用本架构作为上游。
- `frontend-component-tree-registry.md` 必须补 budget/evidence 口径。
- UI review checklist 的 frontend tree 项必须要求性能证据或明确 `unproven`。

## 3. 与 Desktop Runtime Projections 的关系

Desktop `runtime-projections.md` 已经定义：

- `RuntimeDescriptor`
- `PageDescriptor`
- Boot phases
- Page-local prefetch
- Page runtime leases

Frontend Runtime 作为上游补齐：

- 为什么这些契约存在。
- 跨端与 Applet 容器的统一生命周期语言。
- click frame、hidden alive tree、section lazy、applet container、profiler 的架构要求。

Required updates:

- `runtime-projections.md` 应引用 `architecture/frontend-runtime/`。
- `PageDescriptor` 后续可扩展 `budget` 或通过 registry 关联 budget。
- `PageHost` 应输出 dev-only route-to-visible 和 mount cost。

## 4. 与 Applet Runtime 的关系

Applet Runtime 负责 applet manifest、SDK、service binding、Lynx bridge 和 applet-local product logic。

Frontend Runtime 负责 host container：

- embedded mode
- immersive container fullscreen
- standalone product window
- floating controls
- runtime page lease
- debug/error visibility
- host shell recovery

Required updates:

- `AppletRuntimePage` 应逐步瘦身为 PageBoundary。
- `AppletContainerShell` 应成为 applet 容器能力 owner。
- Applet registry row 需要记录 `embedded / immersive / standalone` 三种模式 evidence。

## 5. 与现有卡顿修复的关系

当前已做的修复应作为 Phase 0 的临时对齐，不视为最终架构闭环：

| 已做修复 | 架构位置 | 后续正式化 |
|----------|----------|------------|
| 登录后 deferred runtime projections | Scheduler / RuntimeProjection | 用 FrontendScheduler + runtime budget 表达 |
| `AppSideNav` 收窄 store selector | StoreSubscription | 加 hidden/shell broad subscription 检查 |
| Settings section memo + delayed active content | SectionHost | 抽出通用 SectionHost |
| Applet standalone/fullscreen UI | AppletContainerShell | 抽出 AppletContainerShell 并接入 window lifecycle |

## 6. 迁移策略

### Phase A: 架构真源

- 新增 `docs/architecture/frontend-runtime/`。
- 更新 `docs/README.md` 真源导航。
- 更新 frontend tree 文档引用上游架构。

### Phase B: Observability first

- 增加 dev-only profiler。
- 先测 `login -> ready`、主侧栏切换、Settings tabs、applet open。
- registry evidence 从 `unproven` 更新为采样值。

### Phase C: SectionHost

- 抽象 SectionDescriptor 和 SectionHost。
- Settings 的 provider/model/logs/help/statistics 迁移到 SectionHost。
- 移除页面内分散的隐藏 section lifecycle。

### Phase D: AppletContainerShell

- 抽象 embedded/immersive/standalone。
- PageRuntime 只负责 route boundary 和 applet id 解析。
- Standalone window 统一由 container shell 管理。

### Phase E: Policy gates

- 增加 registry 检查脚本。
- CI 检查高频页面是否有 descriptor、budget、evidence。
- 新页面不能绕过 PageHost。

## 7. 兼容策略

- Existing `PageHost` 保持兼容，先通过文档和 profiler 升级，不一次性重写。
- Legacy `PageRouter` fallback 保留，但不得新增高频页面。
- Settings 可分 section 迁移，避免一次性破坏所有设置面板。
- Applet standalone 先保留现有路由模式，再逐步接入正式 window lifecycle。

## 8. 验收映射

| 验收项 | 证据 |
|--------|------|
| 主导航切换不卡 | route-to-visible 采样，long task < budget |
| Settings tabs 不粘滞 | SectionHost evidence，隐藏 section render count |
| 登录背景动画不停止 | login click frame + runtime bootstrap timing |
| Applet 像小程序容器 | embedded/immersive/standalone screenshots + lifecycle lease logs |
| 架构不是补丁 | docs 真源、registry、profiler、CI gate 都闭环 |
