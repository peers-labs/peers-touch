# Frontend Runtime Architecture Upgrade — 执行计划

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-07-02 | **Updated**: 2026-07-02
> **Owner**: Client Platform Team
> **Module**: `apps/desktop/src/kernel/`, `apps/desktop/src/pages/`, `apps/desktop/src/applet/`

---

## 1. 背景与目标

近期反馈的登录停帧、主侧栏切换卡、Settings tabs 卡、Applet 容器不直观，说明 Peers Touch 需要把现有前端树标准升级成正式 Frontend Runtime Architecture。

目标不是单点优化，而是形成可执行闭环：

- 有上游架构真源。
- 有生命周期和预算模型。
- 有 dev runtime profiler 证明卡顿归因。
- 有 SectionHost 治理 Settings/provider/logs 等重 section。
- 有 AppletContainerShell 治理 embedded、immersive、standalone 容器。
- 有 registry / CI gate 防止新页面退回补丁式实现。

## 2. 范围与非目标

范围：

- Desktop 当前卡顿路径：login ready、主侧栏、Settings tabs、Applet runtime。
- 跨端架构语言：PageHost、SectionHost、RuntimeProjection、AppletContainer、Profiler。
- 文档、注册表、内核能力和分阶段迁移。

非目标：

- 不重写整个 Desktop shell。
- 不一次性迁移所有 legacy PageRouter 页面。
- 不改变 Applet SDK 业务协议。
- 不把 dev profiler 直接变成生产遥测。

## 3. 方案设计

方案以 [design.md](../design.md) 为真源，按领域拆分为：

1. Architecture source：正式文档和导航。
2. Observability：dev-only profiler。
3. Scheduler/PageHost：click frame、idle prewarm、LRU、lease。
4. SectionHost：Settings/provider 重 section 生命周期。
5. AppletContainerShell：小程序式容器。
6. Policy gates：registry、CI、review checklist。

## 4. 实施状态

| Phase | 状态 | 完成日期 | 备注 |
|-------|------|----------|------|
| Phase 0: Immediate alignment | done | 2026-07-02 | deferred runtime projections、side nav selector、Settings section 初步切换、Applet standalone/fullscreen 初步入口 |
| Phase 1: Architecture source | done | 2026-07-02 | frontend-runtime 架构文件集、docs 入口、UI tree/registry/Desktop runtime 引用已落盘 |
| Phase 2: Runtime profiler | done | 2026-07-02 | dev-only 采样已接入 boot/runtime/PageHost/Settings/Applet，并完成 login、侧栏、Settings、applet open 采样 |
| Phase 3: SectionHost | done | 2026-07-02 | `SectionHost`/`section.ts` 已落地，Settings section 生命周期迁移，logs/statistics/tools/help selected-only，provider 等草稿型 section first-visit-cache |
| Phase 4: AppletContainerShell | done | 2026-07-02 | `AppletContainerShell` 已抽取，AppletRuntimePage 保留 orchestration，contained/immersive/standalone shell chrome 归容器层 |
| Phase 5: Policy gates | done | 2026-07-02 | registry gate 已新增并接入 review pipeline、Make target、根 package script |

## 5. 实施阶段

### Phase 0: Immediate alignment

- 目标：快速消除最明显的 click-frame 竞争。
- 涉及文件/模块：
  - `apps/desktop/src/App.tsx`
  - `apps/desktop/src/services/appRuntime.ts`
  - `apps/desktop/src/components/AppSideNav.tsx`
  - `apps/desktop/src/pages/SettingsPage.tsx`
  - `apps/desktop/src/pages/AppletRuntimePage.tsx`
  - `apps/desktop/src/views/ReadyView.tsx`
- 验收标准：
  - `cd apps/desktop && pnpm run check` 通过。
  - identity/page runtime 相关测试通过。
  - 不再新增页面内 mount-time long-lived freshness。
- 依赖：现有 PageHost/RuntimeDescriptor。

### Phase 1: Architecture source

- 目标：建立 `docs/architecture/frontend-runtime/` 上游真源。
- 涉及文件/模块：
  - `docs/architecture/frontend-runtime/README.md`
  - `docs/architecture/frontend-runtime/design.md`
  - `docs/architecture/frontend-runtime/decisions.md`
  - `docs/architecture/frontend-runtime/data-model.md`
  - `docs/architecture/frontend-runtime/module-layout.md`
  - `docs/architecture/frontend-runtime/integration.md`
  - `docs/README.md`
  - `docs/client/common/ui-identity/frontend-component-tree.md`
  - `docs/client/common/ui-identity/frontend-component-tree-registry.md`
- 验收标准：
  - 文档符合 `docs/global/architecture-document-standard.md`。
  - docs README 能找到新真源。
  - frontend tree 文档明确下游于 frontend runtime。
- 依赖：无。

### Phase 2: Runtime profiler

- 目标：让卡顿可归因。
- 涉及文件/模块：
  - `apps/desktop/src/kernel/frontendRuntimeProfiler.ts`
  - `apps/desktop/src/kernel/PageHost.tsx`
  - `apps/desktop/src/kernel/boot.ts`
  - `apps/desktop/src/kernel/runtime.ts`
  - `apps/desktop/src/pages/SettingsPage.tsx`
  - `apps/desktop/src/pages/AppletRuntimePage.tsx`
- 验收标准：
  - dev console 输出 `route.requested -> route.visible`。
  - page mount cost、runtime bootstrap timing 可见。
  - long task > 50ms 可记录 owner 或 unknown。
  - 能采样登录、主侧栏、Settings tabs、applet open。
- 依赖：Phase 1。
- 落地证据：
  - `apps/desktop/src/kernel/frontendRuntimeProfiler.ts` 已提供 dev-only event stream 和 `window.__PT_FRONTEND_RUNTIME_EVENTS__`。
  - `boot.ts`、`runtime.ts`、`PageHost.tsx`、`SettingsPage.tsx`、`AppletRuntimePage.tsx` 已接入采样点。
  - `cd apps/desktop && pnpm run check` 通过。
  - `cd apps/desktop && pnpm run test -- page pageRuntimeLease useAppLifecycle identityLifecycle` 通过，21 files / 150 tests。
  - `git diff --check` 通过。
  - Runtime sample: Settings `settings:group:ai` recorded `route.requested -> route.visible`，约 213ms。
  - Runtime sample: side nav Settings -> Chat recorded `chat route.requested -> route.visible`，约 121ms。
  - Runtime sample: login/app startup recorded `boot.phase`、`runtime.install`、`runtime.bootstrap`、`longtask.detected`。
  - Runtime sample: applet open recorded `applet:hello-lynx route.visible` and applet runtime render evidence。

### Phase 3: SectionHost

- 目标：把 Settings/provider/logs 等重 section 从页面内策略迁移到内核 section 生命周期。
- 涉及文件/模块：
  - `apps/desktop/src/kernel/section.ts`
  - `apps/desktop/src/kernel/SectionHost.tsx`
  - `apps/desktop/src/pages/SettingsPage.tsx`
  - `apps/desktop/src/components/settings/*`
  - `docs/client/common/ui-identity/frontend-component-tree-registry.md`
- 验收标准：
  - Settings shell alive，但 heavy section selected-only/lazy。
  - provider editor 只挂当前 provider schema。
  - logs/diagnostics 不默认 alive。
  - hidden render count 在 budget 内。
- 依赖：Phase 2 profiler。
- 落地证据：
  - `apps/desktop/src/kernel/section.ts` 定义 `SectionDescriptor`、`SectionHostPolicy` 和纯策略函数。
  - `apps/desktop/src/kernel/SectionHost.tsx` 统一拥有 section mount/cache/hidden render profiling。
  - `apps/desktop/src/pages/SettingsPage.tsx` 不再维护页面内 `mountedSections`，改为委托 `SectionHost`。
  - `apps/desktop/src/modules/registry.ts` 支持模块声明 `sectionHostPolicy`。
  - `apps/desktop/src/modules/logs.ts` 声明 `selected-only`，避免 logs/diagnostics 默认 alive。
  - `cd apps/desktop && pnpm run check` 通过。
  - `cd apps/desktop && pnpm run test -- section page pageRuntimeLease useAppLifecycle identityLifecycle` 通过，22 files / 152 tests。
  - `git diff --check` 通过。
  - Runtime sample: Settings AI/providers recorded `settings:section-host:providers` surface render and `settings:group:ai` route-to-visible，约 189ms。
  - Runtime sample: Data/logs/statistics recorded `settings:section:logs` route-to-visible，约 151ms；切回 `statistics` 后 mounted section hosts only included `providers`、`account`、`statistics`，`logs` no longer stayed mounted。
  - 说明：provider editor schema split/model discovery audit 仍保留在 registry `needs audit`，不随 Phase 3 过度宣称完成。

### Phase 4: AppletContainerShell

- 目标：把 applet runtime 容器升级为小程序式产品容器。
- 涉及文件/模块：
  - `apps/desktop/src/applet/AppletContainerShell.tsx`
  - `apps/desktop/src/pages/AppletRuntimePage.tsx`
  - `apps/desktop/src/applet/LynxContainer.tsx`
  - `apps/desktop/src/runtimes/appletsRuntime.ts`
  - `docs/architecture/applet-runtime/`
  - `docs/client/common/ui-identity/frontend-component-tree-registry.md`
- 验收标准：
  - embedded、immersive、standalone 三种模式可用。
  - immersive 保留浮动退出/隐藏/关闭。
  - standalone 不显示 Desktop 全局侧栏。
  - close/release 不阻塞回到 applets/home 的点击帧。
  - Lynx debug panel 不遮挡主任务，可显式打开/隐藏。
- 依赖：Phase 2 profiler；可与 Phase 3 并行。
- 落地证据：
  - `apps/desktop/src/applet/AppletContainerShell.tsx` 已抽出容器 shell，拥有 PageHeader actions、immersive floating controls、runtime content frame 和 Lynx debug panel。
  - `apps/desktop/src/pages/AppletRuntimePage.tsx` 保留 page orchestration、store projection、Lynx Host handlers、standalone window helper 和 product render reporting。
  - `cd apps/desktop && pnpm run check` 通过。
  - `cd apps/desktop && pnpm run test -- applet pageRuntimeLease section` 通过，22 files / 152 tests。
  - `git diff --check` 通过。
  - Runtime sample: `hello-lynx` rendered `data-applet-container-shell="hello-lynx"` with contained mode and actions `Open standalone`、`Fullscreen`、`Pin`、`Close`。
  - Runtime sample: `Fullscreen` switched shell to immersive mode；floating controls exposed `Exit fullscreen`、`Hide controls`、`Close`；`Hide controls` switched to the compact `Controls` affordance；`Exit fullscreen` returned to contained shell。
  - Runtime sample: `applet:hello-lynx` recorded route-to-visible，约 122ms；`applets` runtime page-acquire，约 792ms。
  - 说明：本阶段未改 `apps/applets/**` 产品源码，未改 `LynxContainer` / `appletsRuntime` lease ownership。

### Phase 5: Policy gates

- 目标：阻止新 UI 退化回补丁式生命周期。
- 涉及文件/模块：
  - `tooling/scripts/check-frontend-runtime-registry.sh`
  - `docs/client/common/ui-identity/review-checklist.md`
  - `docs/client/common/ui-identity/frontend-component-tree-registry.md`
  - CI / review skill profiles
- 验收标准：
  - 新 primary page 必须有 PageDescriptor、runtime owner、budget、evidence。
  - 新 heavy section 必须登记 SectionHost policy。
  - 新 applet runtime UI 必须登记 container mode。
  - `needs audit` 条目有 owner 和 revisit condition。
- 依赖：Phase 1；可在 Phase 2 后启用严格 gate。
- 落地证据：
  - `tooling/scripts/check-frontend-runtime-registry.sh` 已新增，检查 registry 必填字段、alive/status 枚举、evidence、`needs audit` owner/revisit wording、关键 runtime 架构文件存在。
  - `tooling/scripts/review/run.sh` 已接入 `Frontend runtime registry` 阶段。
  - `tooling/make/review.mk` 已新增 `review-frontend-runtime-registry` target。
  - `package.json` 已新增 `frontend-runtime:registry-gate`。
  - `tooling/scripts/README.md` 已登记新 gate。
  - Gate 首次运行发现并修复 registry 中 `Command palette`、`Model discovery panel` revisit wording 缺口，以及 Mobile tabbar evidence 中未转义 `||` 导致的表格破裂问题。
  - `bash tooling/scripts/check-frontend-runtime-registry.sh --range HEAD` 通过。
  - `make review-frontend-runtime-registry REVIEW_RANGE=HEAD` 通过。
  - `pnpm frontend-runtime:registry-gate` 通过。
  - `git diff --check` 通过。

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| profiler 本身造成开销 | dev runtime 误判卡顿 | dev-only、sampling、可关闭 |
| SectionHost 迁移破坏 Settings 状态 | 表单状态丢失 | 先迁移 read-only/轻 section，再迁移 provider editor |
| standalone applet window 与 auth/session 生命周期冲突 | 独立窗口打开后过期或状态错乱 | 复用 identityRuntime authenticated edge，独立窗口不自建身份状态 |
| registry 过重没人维护 | 文档失真 | CI gate 检查必填字段，Evidence 可标 unproven 但不能空白 |
| legacy PageRouter 长期存在 | 架构分叉 | 每次新增高频页面禁止 fallback，旧页面按风险逐步迁移 |

## 7. 验证方式

- Static:
  - `rg "frontend-runtime" docs/README.md docs/client/common/ui-identity docs/client/desktop`
  - `rg "needs audit|unproven" docs/client/common/ui-identity/frontend-component-tree-registry.md`
- Type/Test:
  - `cd apps/desktop && pnpm run check`
  - `cd apps/desktop && pnpm run test -- page pageRuntimeLease useAppLifecycle identityLifecycle`
- Runtime:
  - `make desktop`
  - login/PIN route-to-ready sample
  - sidebar route-to-visible sample
  - Settings group/section switch sample
  - applet embedded/immersive/standalone sample
- Acceptance:
  - 卡顿问题必须报告 owner：page、section、runtime、store subscription 或 unknown。
  - unknown owner 不能合并为“已解决”，只能合并为“instrumented with follow-up”。
