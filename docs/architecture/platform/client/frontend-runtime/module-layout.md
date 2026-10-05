# Frontend Runtime Architecture — 模块目录结构

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-07-02 | **Updated**: 2026-07-11
> **Owner**: Client Platform Team
> **Module**: `apps/desktop/src/kernel/`, `apps/desktop/src/runtimes/`

---

## 目录树

```text
docs/architecture/platform/client/frontend-runtime/
├── README.md
├── design.md
├── decisions.md
├── data-model.md
├── module-layout.md
├── integration.md
└── execution-plans/
    ├── 20260702-frontend-runtime-upgrade.md
    ├── 20260706-desktop-global-lag-framework-plan.md
    ├── 20260706-desktop-global-lag-bom-spec-trace.md
    ├── 20260706-desktop-global-lag-phase0-construction-plan.md
    └── 20260710-desktop-global-lag-phase1-optimization.md

docs/client/common/ui-identity/
├── frontend-component-tree.md
└── frontend-component-tree-registry.md

docs/client/desktop/
└── runtime-projections.md

apps/desktop/src/
├── App.tsx
├── views/
│   └── ReadyView.tsx
├── components/
│   ├── GlobalLayout.tsx
│   └── AppSideNav.tsx
├── kernel/
│   ├── boot.ts
│   ├── page.ts
│   ├── PageHost.tsx
│   ├── pageRuntimeLease.ts
│   ├── runtime.ts
│   └── usePrefetch.ts
├── pages/
│   ├── registry.ts
│   ├── *.descriptor.tsx
│   ├── SettingsPage.tsx
│   └── AppletRuntimePage.tsx
├── runtimes/
│   └── *Runtime.ts
├── services/
│   └── appRuntime.ts
├── store/
│   └── *.ts
└── applet/
    ├── LynxContainer.tsx
    ├── LynxHost.tsx
    ├── lynx-host-element.ts
    └── LynxDebugPanel.tsx
```

## 文件职责

| 路径 | 职责 |
|------|------|
| `docs/architecture/platform/client/frontend-runtime/README.md` | 大前端运行时架构入口 |
| `docs/architecture/platform/client/frontend-runtime/design.md` | 上游架构、核心接口、组件关系 |
| `docs/architecture/platform/client/frontend-runtime/decisions.md` | 关键决策 ADR |
| `docs/architecture/platform/client/frontend-runtime/data-model.md` | surface lifecycle、budget、interaction work/admission、native evidence cohort 模型 |
| `docs/architecture/platform/client/frontend-runtime/integration.md` | 与现有 Desktop/UI/Applet 文档和代码的映射、native evidence ledger 与目标集成条件 |
| `docs/client/common/ui-identity/frontend-component-tree.md` | 下游组件树和 alive 标准 |
| `docs/client/common/ui-identity/frontend-component-tree-registry.md` | 页面/section/container 生命周期登记表 |
| `docs/client/desktop/runtime-projections.md` | Desktop Page/Runtime/Boot 内核契约 |
| `apps/desktop/src/kernel/PageHost.tsx` | Desktop 页面挂载、预热、保活、LRU、lease 分发 |
| `apps/desktop/src/kernel/page.ts` | PageDescriptor registry 和动态路由解析 |
| `apps/desktop/src/kernel/boot.ts` | boot phases、idle scheduling、phase instrumentation |
| `apps/desktop/src/kernel/runtime.ts` | RuntimeDescriptor registry 和 bootstrap sequencing |
| `apps/desktop/src/services/appRuntime.ts` | app-level runtime registration 和 critical/idle runtime install |
| `apps/desktop/src/pages/registry.ts` | kernel-managed pages 注册入口 |
| `apps/desktop/src/pages/*.descriptor.tsx` | 页面 lifecycle 声明 |
| `apps/desktop/src/pages/SettingsPage.tsx` | 当前 Settings shell 与 section lifecycle 实现，目标迁移到 SectionHost |
| `apps/desktop/src/pages/AppletRuntimePage.tsx` | 当前 applet runtime PageBoundary，目标迁移到 AppletContainerShell |
| `apps/desktop/src/applet/LynxContainer.tsx` | Lynx runtime frame、loading/error/ready boundary |
| `apps/desktop/src/applet/lynx-host-element.ts` | Lynx custom element 和 host bridge |

## 依赖方向

```text
architecture/platform/client/frontend-runtime
  -> client/common/ui-identity/frontend-component-tree
  -> client/desktop/runtime-projections
  -> apps/desktop/src/kernel
  -> apps/desktop/src/pages / runtimes / applet
```

禁止反向定义：

- `SettingsPage.tsx` 不能定义新的 section lifecycle 口径，只能实现或推动 `SectionHost`。
- `AppletRuntimePage.tsx` 不能定义新的 applet container 口径，只能实现或推动 `AppletContainerShell`。
- `PageRouter` fallback 不能新增高频页面生命周期策略。
- 单个 runtime 不能绕过 `RuntimeDescriptor` 自行成为 boot pipeline。

## 目标新增模块

| 目标模块 | 目标路径 | 说明 |
|----------|----------|------|
| Frontend runtime profiler | `apps/desktop/src/kernel/frontendRuntimeProfiler.ts` | dev-only route/mount/long-task/hidden-render 采样 |
| Native evidence correlator | target path decided by platform design after D-15 evidence gate | 关联 input/paint、React/store、bridge/handler/event 和 native process evidence |
| Interaction admission | target path decided by platform design after D-15 evidence gate | transport-neutral bounded admission、QoS、cancel、supersession、idempotency |
| SectionHost | `apps/desktop/src/kernel/SectionHost.tsx` | selected-only/lazy/first-visit-cache section 生命周期 |
| Section registry | `apps/desktop/src/kernel/section.ts` | SectionDescriptor 定义与 registry |
| AppletContainerShell | `apps/desktop/src/applet/AppletContainerShell.tsx` | embedded/immersive/standalone 容器 shell |
| Surface budget checks | `tooling/scripts/check-frontend-runtime-registry.mjs` | 跨平台检查 registry 预算/evidence 字段完整性 |
