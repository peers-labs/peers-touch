# Desktop Global Lag Framework Plan

> **Status**: proposed
> **Date**: 2026-07-06
> **Parent**: `docs/architecture/frontend-runtime/README.md`
> **Evidence**: `docs/context/implementation-reports/20260706-desktop-global-lag-diagnosis.md`

---

## 0. How To Read This Plan

This plan is organized by decision level, not by the order in which the investigation happened.

| Reader question | Read section | Meaning |
|---|---|---|
| Why does this plan exist? | §1 Objective | Goal and anti-patch boundary. |
| What is the performance bar? | §2 Target Red Lines | Budgets that future gates must enforce. |
| What materials and contracts must each task trace to? | [BOM / Spec / Trace Pilot](./20260706-desktop-global-lag-bom-spec-trace.md) | Construction control layer consumed by this plan. |
| How does Phase 0 become executable work? | [Phase 0 Construction Plan](./20260706-desktop-global-lag-phase0-construction-plan.md) | P0a/P0b/P0c task order, gates, evidence, skill integration, and completion audit. |
| What must be built before any fix? | §3 Phase 0: Evidence Gate | Shared telemetry, startup entry contracts, samplers, matrix runner, and report gate. |
| What framework layers will be fixed after evidence exists? | §4-§8 Phase 1-5 | Shell, hidden tree, store/projection, overlay, Tauri bridge. |
| In what order should work land? | §9 Implementation Order | Merge order and dependency order. |
| Which diagnosed defects map to which phase? | §10 Defect Mapping | Crosswalk from diagnosis IDs to work phases. |
| What is explicitly out of scope? | §11 Non-Goals | Guardrail against patch-style work. |
| When is the whole plan done? | §12 Definition of Done | Final acceptance across all phases. |

Phase 0 has more detail because it is the foundation. Read it in this order:

1. [BOM / Spec / Trace Pilot](./20260706-desktop-global-lag-bom-spec-trace.md): required materials, contracts, work packages, gates, and evidence chain.
2. [Phase 0 Construction Plan](./20260706-desktop-global-lag-phase0-construction-plan.md): executable P0a/P0b/P0c task order, dependencies, gates, evidence, and skill governance.
3. §3 Work Items: what Phase 0 must produce.
4. §3 Startup Entry Contracts: what `make desktop` / `make desktop-web` / `make station` must guarantee.
5. §3 Telemetry Contract: where events go and how all modules reuse them.
6. §3 Sampler Contract: which event families must exist.
7. §3 `profile=one` Minimum Preflight: one concrete baseline profile used by E2E.
8. §3 Acceptance / Exit Criteria: what blocks moving to Phase 1.
9. §3 Execution Checklist: task-level ledger `P0-1` to `P0-8`.

`tooling/acceptance/reports/*` is only a dev/CI mirror. Product telemetry ownership belongs to Station.

Execution must not jump from this plan directly into code. Every Phase 0 task must first bind to at least one BOM ID, one Spec ID, a P0a/P0b/P0c work package, and a gate/evidence target from the BOM / Spec / Trace pilot and the Phase 0 construction plan.

---

## 1. Objective

从框架层消除 Desktop 全局卡顿，让一级导航、二级 tab、右键菜单成为可度量、可回归、可阻断合入的基础能力。

本计划不接受“看到一个组件就优化一个组件”的补丁式修复。

---

## 2. Target Red Lines

| Interaction | Budget |
|---|---:|
| 一级菜单 click-to-first-feedback | `<50ms` |
| 一级菜单 click-to-visible | `<100ms` |
| 二级 tab click-to-visible | `<80ms` |
| 右键菜单 contextmenu-to-visible | `<50ms` |
| JS long task | 禁止 `>50ms` |
| hidden tree render during active switch | 默认禁止，例外必须登记 owner/budget |
| click frame Tauri invoke | 默认禁止，例外必须有超时和 trace |

---

## 3. Phase 0: Evidence Gate

Phase 0 is not a performance fix. It builds the measurement and Station-managed telemetry foundation that makes later fixes provable.

The logical contract stack is:

1. Stable startup entrypoints prove the runtime is clean and label side effects.
2. Desktop emits shared telemetry events with `interactionId`.
3. Station ingests, stores, aggregates, and serves telemetry for analysis.
4. Dev/CI mirrors the same event envelope into local reports.
5. The performance gate fails closed when required telemetry is missing.

### Scope

建立 Desktop 性能 E2E gate，不修改业务行为。

### Work Items

1. 增加稳定 E2E anchors：
   - primary nav item id
   - secondary tab id
   - section item id
   - context menu trigger id
2. 扩展现有 frontend runtime profiler：
   - click-to-feedback
   - contextmenu-to-menu-visible
   - React commit count/duration
   - hidden render owner
   - store update fanout
   - `tauri.invoke` command duration
   - production bundle boot status and runtime crash marker
3. 建立三组基线：
   - Vite browser + `profile=one`
   - Tauri WebView + `profile=one`
   - production build + Tauri WebView
   - no-gateway/offline shell fixture
4. 建立 baseline preflight：
   - Vite URL ready 不等于 baseline ready。
   - Gateway 端口必须监听且 `auth_restore_session` 可返回结构化响应。
   - `wait_for_gateway` 不允许 fail-open；gateway 未监听时必须使 baseline preflight fail。
   - `window.__PT_ACCEPTANCE__` 必须存在。
   - 测试账号登录必须成功进入 ready shell。
   - ready shell 可见后才允许采集 primary tab、secondary tab、context menu 性能。
5. 明确 Tauri WebView 自动化入口：
   - 首选：WebView/WebDriver/CDP 等可脚本化入口。
   - 备选：macOS Assistive Access + System Events。
   - 禁止：用 Chrome + gateway bridge gate 冒充真实 Tauri WebView 交互证据。
   - 现状阻塞：当前宿主可启动 `peers-touch-desktop`，但 System Events 读取窗口/控件被 `Assistive Access` 拒绝，`screencapture` 也无法创建 display image；因此 true-click trace 必须先满足权限前置，或提供非 AX 的 WebView telemetry channel。
6. 输出 Station-managed telemetry 与开发镜像：
   - Station ingestion/query/storage contract for frontend telemetry.
   - Station raw event and rollup persistence for user/operator analysis.
   - Dev/CI mirror: `tooling/acceptance/reports/desktop-performance-latest.json`
   - Dev/CI mirror: `tooling/acceptance/reports/desktop-performance-latest.md`
7. 修复 production baseline 的可测性：
   - `vite preview` 不能在 module evaluation 阶段 crash。
   - production build 需要记录 chunk graph、static/dynamic import conflicts、largest assets。
   - production E2E 需要能进入登录/ready shell，否则不能作为性能基线。
8. 修复 offline baseline 的可测性：
   - 无 gateway/Station 时必须能进入轻量 shell 或专用 fixture。
   - offline fixture 不允许加载业务 runtime、event stream、Station-backed projection。
   - offline fixture 只用于隔离 Shell/PageHost/Overlay 的 UI 主线程成本。
9. 固化启动入口合同：
   - `make desktop`、`make desktop-web`、`make station` 是开发者和 gate 依赖的稳定入口；内部 bash、Tauri config、predev 细节不是架构合同。
   - 启动入口必须能声明并保证目标 runtime：browser/gateway、Tauri WebView、prod preview、offline fixture。
   - 启动入口必须 fail-closed：Station/Gateway/Renderer/Ready Shell 任一前置不满足时，不允许输出可采样状态。
   - 启动入口必须支持“诊断模式”和“生产/真实启动模式”标签，报告不能混淆二者。

### `profile=one` Minimum Preflight

Phase 0 采样器必须先执行并记录以下 preflight。任一步失败，报告只能输出 `baseline preflight failure`，不得输出 tab/overlay 性能结论。

1. Station health：

   ```bash
   curl -fsS -m 5 http://10.37.246.80:18080/sub-oss/healthz
   ```

2. Gateway command round-trip：

   ```bash
   curl -fsS -H 'Content-Type: application/json' \
     -d '{"cmd":"auth_restore_session","args":{}}' \
     http://127.0.0.1:3031/
   ```

3. Renderer harness:
   - `window.__PT_ACCEPTANCE__` exists.
   - `loginWithPassword({ account: 'b@p.t', password: '1' })` returns authenticated.
   - ready shell exposes `[data-page="chat"]`.
4. Runtime label:
   - Browser samples must be labeled `browser/gateway`.
   - Tauri WebView samples must come from true WebView automation or explicit app WebView telemetry.
   - Headless Chrome/CDP samples cannot satisfy Tauri WebView evidence.
   - Tauri startup/API burst without a click `interactionId` must be labeled `startup/runtime amplification`, not `click-frame attribution`.
5. Existing acceptance reuse:
   - `make acceptance-chat-desktop-dom` can be reused as a chat DOM/gateway smoke after ports are overridden for the target runtime.
   - It is not sufficient as the performance gate until React commit, store fanout, overlay, and interaction correlation events are added.

### Startup Entry Contracts

The plan must not depend on implementation details inside shell scripts. The contract is owned by the stable command entrypoints and by the runtime state they prove.

Required entrypoint behavior:

| Entrypoint family | Required guarantee | Forbidden behavior |
|---|---|---|
| `make station` | Starts or validates the selected Station target and exposes explicit health status. | Returning success while the selected Station target is unknown, unhealthy, or silently replaced by another target. |
| `make desktop-web` | Starts browser/gateway runtime for the selected profile and proves Station, Gateway, Renderer harness, and Ready Shell before performance sampling. | Triggering hidden deploy/setup side effects that change the measured baseline without reporting them; returning success when gateway is absent. |
| `make desktop` | Starts the Tauri WebView runtime for the selected profile and proves app process, Gateway, Renderer harness, and Ready Shell before performance sampling. | Requiring ad hoc runtime config overrides as the normal diagnostic path; reporting startup/runtime command burst as click-frame evidence. |
| performance gate entrypoint | Runs the matrix and emits Station-managed telemetry plus dev mirror artifacts. | Sampling tab/overlay performance before preflight, or labeling browser/gateway samples as Tauri WebView samples. |

Required report fields:

- `entrypoint`: e.g. `make desktop`, `make desktop-web`, `make station`, or dedicated performance gate.
- `profile`: e.g. `one`.
- `runtime`: `browser-gateway`, `tauri-webview`, `prod-preview`, `offline-fixture`, or `unknown`.
- `startupMode`: `normal`, `diagnostic`, or `fixture`.
- `preflightStatus`: `pass`, `baseline preflight failure`, `blocked`, or `diagnostic incomplete`.
- `startupSideEffects`: explicit list of deploy/setup/build side effects that ran before sampling.

Current diagnosis may cite ad hoc commands as evidence of today's gaps, but future execution must fix the stable entrypoints instead of institutionalizing those ad hoc commands as framework contracts.

### Acceptance

- 任一 primary tab、secondary tab、context menu 超预算时 gate fail。
- 任一交互出现 `>50ms` long task 时 gate fail，除非有登记豁免。
- 报告能区分 browser、Tauri WebView、runtime/network 三类来源。
- Tauri WebView 交互样本必须来自真实 WebView；仅 gateway bridge / headless Chrome 只能标记为 browser/gateway 证据。
- Production preview 或 production Tauri bundle 若在 boot 阶段 crash，gate 直接 fail，并停止性能归因。
- 报告必须列出 React commit count/duration 和 store fanout；缺失时只能标记为 diagnostic incomplete。
- Offline/no-gateway 样本若只能到 boot failed screen，不得用于证明 tab/overlay 性能。
- Browser baseline 若 gateway 端口未监听、acceptance login 失败、或 ready shell 不可见，必须标记为 baseline preflight failure，不得输出 tab/overlay 性能结论。
- `make desktop-web` / acceptance gate 不允许在 gateway absent 时返回可采样状态。
- Tauri true-click cell may be `blocked` only when the report records:
  - app process visible,
  - gateway `3030` ready,
  - restore/login result,
  - exact automation blocker (`Assistive Access`, screenshot, or WebView telemetry missing).
  It may not be silently omitted.

---

### Phase 0 Sampler Contract

Current state:

- `frontendRuntimeProfiler.ts` only records boot phase, route requested/visible, surface render, hidden surface render, runtime events, and `>50ms` longtask.
- No React `Profiler` boundary exists in `apps/desktop/src`.
- Desktop stores use bare `zustand.create(...)`; there is no shared middleware, `subscribeWithSelector`, or store update fanout sampler.
- Existing `window.__PT_ACCEPTANCE__` is chat-focused and can login/sync data, but it does not prove ready-shell visibility or performance preflight by itself.

Required additions before any fix phase:

1. React commit sampler:
   - Wrap ready-shell roots/page frames/section frames with dev-only React `Profiler`.
   - Emit `react.commit` with `id`, `phase`, `actualDuration`, `baseDuration`, `startTime`, `commitTime`.
   - Gate must report commit count and total commit duration per interaction window.
2. Store fanout sampler:
   - Add a shared dev-only store factory or middleware layer.
   - Emit `store.update` with store name, changed top-level keys, listener count when available, and interaction id.
   - Emit component/store subscription owner metadata where available; if unavailable, report `unknown` and mark attribution incomplete.
3. Overlay latency sampler:
   - Emit `contextmenu.intent` at native event boundary.
   - Emit `overlay.visible` when menu DOM is actually visible.
   - Gate uses `overlay.visible - contextmenu.intent`, not handler completion.
4. Invoke sampler:
   - Wrap browser gateway invoke and Tauri invoke bridge with command name, duration, success/failure, and active interaction id.
   - Gate must detect any invoke in primary-tab click frame as a violation unless explicitly budgeted.
5. Interaction correlation:
   - All events in an interaction window must share an `interactionId`.
   - A tab/context-menu sample without `interactionId` is diagnostic-only and cannot satisfy Phase 0 gate.

Sampling repeatability:

- Each interaction/runtime cell must run at least `N >= 5` successful samples before reporting p50/p95.
- Cold boot and warm interaction are separate cohorts and must not be aggregated.
- Report `min`, `p50`, `p95`, `max`, sample count, failed preflight count, Station trace/query key, and dev mirror artifact path.
- Raw machine-readable events must be persisted through Station ingestion; `tooling/acceptance/reports/desktop-performance-*.json` is a local/CI mirror of the same envelope.
- Human summary must link the Station trace/query key and dev mirror JSON, and preserve blocked/incomplete cells instead of omitting them.
- Outliers are not removed unless the raw event stream proves an unrelated external interruption; removed samples must stay listed with reason.

Fail-closed rules:

- Missing React commit data => `diagnostic incomplete`.
- Missing store fanout data => `diagnostic incomplete`.
- Missing overlay visible event => context-menu sample fails.
- Missing ready-shell preflight => no tab/overlay performance sample may be emitted.
- Headless Chrome/browser gateway samples cannot be labeled as Tauri WebView samples.

Phase 0 exit criteria:

- Station telemetry ingestion, raw event storage, aggregate/query contract, and dev mirror report exist for every required matrix cell.
- Each cell is explicitly classified as `sampled`, `baseline preflight failure`, `blocked`, `not applicable`, or `diagnostic incomplete`.
- Preflight is fail-closed for gateway absence, acceptance login failure, and ready-shell invisibility.
- React commit, store fanout, overlay visible, invoke, and interaction correlation fields are present; missing fields fail the gate.
- No Phase 1-5 framework fix may start before this report exists and the incomplete cells are visible to reviewers.

### Phase 0 Telemetry Contract

The Phase 0 instrumentation is a Desktop frontend telemetry substrate, not a lag-only probe. Performance diagnosis is the first consumer, but every event must be reusable by module-level acceptance, feature debugging, runtime health checks, and future quality evidence.

Ownership:

| Capability | Owner | Rule |
|---|---|---|
| Event schema semantics | Model / shared contract | Cross-client event envelope must be versioned and not redefined by Desktop-only code. |
| Runtime collection queue | Desktop runtime | Desktop buffers events locally only for batching, retry, and E2E inspection. It is not the source of truth. |
| Ingestion, storage, retention, query, analysis | Station | Station owns telemetry management, persistence, aggregation, and user/operator-facing trace lookup. |
| Local acceptance mirror | Tooling | `tooling/acceptance/reports/*` is a developer/CI mirror only; it is not available to end users and must not be treated as the product telemetry sink. |

Production report destinations:

| Layer | Destination | Retention | Consumer |
|---|---|---|---|
| Desktop runtime queue | `window.__PT_FRONTEND_RUNTIME_EVENTS__` plus an internal bounded upload queue | Current renderer session plus retry window | Local inspection, E2E collection, batched upload to Station |
| Station ingestion API | Proposed `POST /telemetry/frontend/events/batch` or equivalent generated proto command | Online request lifecycle | Desktop/Web/Mobile upload path; validates actor/session/device ownership |
| Station raw event store | Proposed Station DB table such as `touch_frontend_telemetry_event` | Bounded retention by policy | Trace drill-down, incident/debug session replay, product analysis |
| Station aggregate store | Proposed rollup table/view such as `touch_frontend_telemetry_rollup` | Longer retention than raw events | p50/p95 trend, module health, red-line dashboard, regression detection |
| Station query API | Proposed list/query endpoints by actor/session/device/module/interaction/time window | Product/runtime API | Desktop diagnostics page, operator tooling, support trace lookup |
| Dev/CI mirror | `tooling/acceptance/reports/desktop-performance-*.json` and `.md` | Working tree artifact | Local/CI evidence only; mirrors the Station event schema for tests |
| Durable analysis | `docs/context/implementation-reports/*` | Long-lived contextual report | Architecture diagnosis and historical decisions, not raw telemetry storage |
| Temporary run scratch | `tmp/*` | Local task ledger / transient notes | Agent/human execution tracking only; not an authoritative evidence sink |

Station ingestion/storage contract:

- Desktop must upload telemetry through the existing authenticated Desktop -> Gateway -> Station command path, not by writing local files as the final sink.
- Station must validate subject actor, session/device identity, event schema version, event size, and allowed event kinds before persisting.
- Station DB must store at least: `event_id`, `schema_version`, `actor_id`, `device_id`, `session_id`, `interaction_id`, `runtime`, `module`, `source`, `kind`, `phase`, `severity`, `duration_ms`, `tags_json`, `data_json`, `occurred_at`, `received_at`.
- Raw `data_json` must be redacted and size-bounded; no secrets, message content, passwords, tokens, private keys, or unredacted PII.
- Station query APIs must support filtering by `interaction_id`, `module`, `source`, `runtime`, time range, and severity.
- Aggregation must happen Station-side so user-facing analysis does not depend on access to the source tree or local `tooling` artifacts.
- Upload failures must not block UI interactions; Desktop should batch and retry with bounded memory/disk policy, then record dropped-count telemetry.
- Dev/CI reports must be generated from the same event envelope as Station ingestion, so test artifacts are a mirror of production telemetry, not a parallel format.

Reusable event envelope:

```ts
type DesktopFrontendTelemetryEvent = {
  id: string;
  schemaVersion: number;
  ts: number;
  kind: string;
  source: 'shell' | 'page-host' | 'section-host' | 'overlay' | 'store' | 'invoke' | 'runtime' | 'applet' | 'acceptance';
  module: string;
  actorId?: string;
  deviceId?: string;
  sessionId?: string;
  owner?: string;
  pageId?: string;
  sectionId?: string;
  interactionId?: string;
  runtime: 'browser-gateway' | 'tauri-webview' | 'prod-preview' | 'offline-fixture' | 'unknown';
  phase?: 'startup' | 'interaction' | 'background' | 'acceptance';
  severity?: 'debug' | 'info' | 'warn' | 'error';
  durationMs?: number;
  tags?: Record<string, string | number | boolean>;
  data?: Record<string, unknown>;
};
```

Reuse rules:

- Modules may emit domain events through the shared frontend telemetry API, but must not create module-private global buffers or private upload paths.
- Every module event must set `module` and `source`; cross-cutting events must also set `owner` or `pageId`.
- Performance gates consume the same stream by filtering `phase='interaction'` and known `kind` values; they must not require a separate lag-only event path.
- Sensitive payloads are forbidden in `data`; events may carry ids, counts, durations, state names, and redacted error classes.
- Acceptance reports aggregate from the same raw event envelope that Station ingests; raw events remain linked so reviewers can audit p50/p95 and blocked cells.
- If a future module needs a new event kind, it extends the shared schema registry first, then uses the common reporter.
- User-facing analysis, trace lookup, and cross-session history must read from Station APIs, never from `tooling/acceptance/reports`.

### Phase 0 Execution Checklist

Phase 0 是独立可合入工作流，只建设可观测、采样、报告和 fail-closed gate；不改变业务交互语义。

| Task | Scope | Deliverable | Acceptance |
|---|---|---|---|
| `P0-1` | Stable E2E anchors | primary nav、secondary tab、section item、context menu trigger 的稳定 selector/test id | browser 和 Tauri/WebView telemetry 均能定位同一交互对象；不得依赖 CSS hash/class |
| `P0-2` | Station-managed telemetry substrate and interaction correlation | reusable event envelope、Desktop batch queue、Station ingest/query/storage contract、dev mirror sinks、`interactionId` 生命周期：pointer/contextmenu start、route/overlay visible、commit、store、invoke、longtask end | 任一 tab/context-menu 样本缺 `interactionId` 时报告为 `diagnostic incomplete`；任一模块新增打点不得绕过 shared telemetry API 和 Station ingestion |
| `P0-3` | React commit sampler | ready shell、PageFrame、SectionHost、OverlayHost 边界的 dev-only React Profiler event | 每个交互窗口输出 commit count、total duration、max commit、owner |
| `P0-4` | Store fanout sampler | Zustand shared dev middleware 或 store factory wrapper | 每次 store update 输出 store、changed keys、listener/fanout、active/hidden owner；裸宽订阅进入报告 |
| `P0-5` | Overlay latency sampler | `contextmenu.intent` 与 `overlay.visible` event | 右键菜单 gate 使用 DOM visible 时间；缺 visible event 直接 fail |
| `P0-6` | Invoke/API sampler | browser gateway invoke 与 Tauri invoke 统一 event schema | click frame 内 invoke 默认 fail；startup/runtime amplification 单独 cohort |
| `P0-7` | Baseline runner | `make desktop` / `make desktop-web` / `make station` / performance gate entrypoint contracts for browser-gateway、Tauri WebView、prod preview、offline fixture | 每个 matrix cell 产出 `sampled` / `blocked` / `baseline preflight failure` / `diagnostic incomplete`，并记录 entrypoint/profile/runtime/startupMode/side effects |
| `P0-8` | Station-backed report writer and dev mirror | Station query/rollup contract plus `desktop-performance-latest.json` 与 `.md` dev mirror | Station 可按 interaction/module/runtime 查询原始事件与聚合；dev JSON 包含 raw events、p50/p95、preflight、blocked reason；Markdown 汇总红线 pass/fail |

Phase 0 implementation order:

1. `P0-1` anchors first; no sampler can be stable without them.
2. `P0-2` interaction correlation before adding individual event families.
3. `P0-3` to `P0-6` can land independently after `interactionId` exists, but report remains incomplete until all four event families are present.
4. `P0-7` runner must treat missing runtime capability as data, not skip the cell.
5. `P0-8` report writer is the merge gate for Phase 0.

Phase 0 regression commands:

```bash
make acceptance-chat-desktop-dom
make acceptance-chat-desktop-gateway
```

These existing commands are smoke inputs only. The new performance gate must add its own command or profile once `desktop-performance-latest.json` is generated.

---

## 4. Phase 1: Shell Click Frame Isolation

### Scope

保证一级导航点击帧只做最小 route state 更新和即时视觉反馈。

### Work Items

1. 拆分 `PageContext`：
   - route context
   - navigation action context
   - applet pin context
2. 稳定 provider value identity。
3. 约束 `AppSideNav`：
   - 不宽订阅业务 store。
   - 不在 click handler 中触发数据加载、agent session 创建、IPC 等重操作。
4. 定义 Shell click frame contract：
   - click handler 同步部分必须 `<8ms`。
   - 数据动作进入 route-visible 后的 idle/transition 队列。

### Acceptance

- 一级导航切换不触发非目标页面 `surface.render`。
- 一级导航点击窗口内不出现 hidden render。
- 一级导航点击窗口内无 `tauri.invoke`。

---

## 5. Phase 2: Hidden Tree Governance

### Scope

把 hidden alive tree 从“默认保活”改为受预算管理的 runtime resource。

### Work Items

1. 给每个 PageDescriptor 增加明确 lifetime/budget：
   - `active-only`
   - `warm-hidden`
   - `frozen-hidden`
   - `evictable`
2. PageHost hidden policy：
   - inactive tree 默认冻结 store subscription。
   - inactive tree 不允许因 route context 改变而 render。
   - hidden render 必须记录 owner 和触发源。
3. 预热策略改为 budgeted idle queue：
   - 每个 idle slice 有时间预算。
   - 用户输入发生时立即取消预热。
4. legacy fallback 页面迁移或显式登记：
   - `notes`
   - `agent-profile`
   - `agent-orchestration`
   - module registry fallback pages

### Acceptance

- 登录 ready 后预热不产生 `>50ms` long task。
- 切换 primary tab 时 hidden render count = 0。
- legacy 页面有明确 lifetime，不再混入无登记路径。

---

## 6. Phase 3: Store Subscription and Projection Layer

### Scope

阻断宽订阅和 render-time full projection 进入 UI 点击帧。

### Work Items

1. 为 Zustand store 增加 subscription audit：
   - 检测裸 `useStore()`。
   - 检测一次 update fanout。
   - 输出 update source、notified component count、active/hidden owner。
2. 建立 projection store：
   - 会话列表 projection
   - unread projection
   - preview projection
   - settings section projection
3. render 阶段禁止全量 derive/sort：
   - `getIMConversations()` 迁出 component render。
   - 投影由 store action 或 runtime pipeline 增量维护。
4. hidden tree subscription freeze：
   - 非 active page 不订阅高频消息、typing、presence、preview。

### Acceptance

- chat hidden 时，消息/presence 更新不触发 chat surface render。
- 会话列表 projection 更新有上限和 owner。
- `useSocialChatStore()` 裸订阅被 lint/gate 拦截。
- `ChatSessionList`、`ChatMessageArea`、`ChatDetailPanel`、`ChatThreadPanel` 不再在 render path 调 `getIMConversations()` 做 full derive。

---

## 7. Phase 4: Overlay Priority Lane

### Scope

右键菜单、Dropdown、Popover 进入独立高优先级 overlay lane。

### Work Items

1. 建立 OverlayHost：
   - shell-level single host
   - contextmenu event 后先显示 shell placeholder
   - menu items 可延迟填充
2. 禁止每行常驻完整 Dropdown 树：
   - 列表只挂 trigger metadata。
   - 当前右键对象按需生成 menu model。
3. overlay latency profiler：
   - `contextmenu` event timestamp
   - menu portal first DOM visible timestamp
   - menu content ready timestamp

### Acceptance

- chat row context menu `<50ms` 可见。
- overlay 打开不依赖会话列表重 render。
- 右键时即使后台 store update 发生，菜单仍先显示。

---

## 8. Phase 5: Tauri Bridge Isolation

### Scope

确认并约束 Tauri/WebView/Rust bridge 对 UI click frame 的影响。

### Work Items

1. 对 `window.__TAURI_INTERNALS__.invoke` 包 trace：
   - command
   - start/end/duration
   - route/page owner
   - whether inside click frame
   - startup/runtime amplification cohort
2. 建立 browser vs Tauri 对照 gate。
3. Rust gateway / Station 网络错误不得污染 UI 点击帧：
   - auth expired
   - unknown command
   - event stream retry
   - sub-agent claim retry
4. 对 session lifecycle 做性能隔离：
   - session revoked / kicked 不得在用户 click frame 内触发完整登录态回退 command burst。
   - 登录态回退链路需要单独 trace，避免误归因给 tab/overlay。
5. 对 startup/runtime command burst 做单独 cohort：
   - browser/gateway startup
   - Tauri app startup
   - warm interaction
   - session restore / login
   - runtime bootstrap / deferred projections
   这些 cohort 必须分开统计，不能把 startup burst 当成 tab click frame 证据。
6. 固化 Tauri 可测性前置：
   - app process 可见
   - gateway `3030` ready
   - restore/login 完成
   - true-click automation 权限或 WebView telemetry 可用
   缺任一项时 Tauri true-click cell 标记为 `blocked` 或 `diagnostic incomplete`。

### Acceptance

- 可回答每个卡顿样本是否包含 Tauri invoke。
- Tauri WebView 额外耗时可量化。
- click frame 内无未登记 IPC。
- 冷启动 / session revoked / warm interaction 三类 Tauri bridge 证据分开统计。
- startup/runtime API burst 可单独报告，但不得替代 click-frame trace。

---

## 9. Implementation Order

1. Phase 0: Evidence Gate。
2. Phase 1: Shell click frame isolation。
3. Phase 2: Hidden tree governance。
4. Phase 3: Store projection layer。
5. Phase 4: Overlay priority lane。
6. Phase 5: Tauri bridge isolation。

原因：没有 gate，框架修复无法防回归；Shell/hidden tree 是共因；store/projection 是主线程放大器；overlay 和 Tauri bridge 是最后的专线隔离。

## 10. Defect Mapping

| Defect ID | Owning phase | Plan response |
|---|---|---|
| `DL-FD-01` | Phase 1 | Split PageContext and stabilize provider values so route changes do not broadcast through the whole ready shell |
| `DL-FD-02` | Phase 2 | Make hidden page lifetime budgeted, observable, and frozen unless explicitly warm |
| `DL-FD-03` | Phase 2 | Register or explicitly budget legacy fallback pages so primary tabs share one lifetime contract |
| `DL-FD-04` | Phase 2 | Apply the same hidden-tree governance to SectionHost and secondary tabs |
| `DL-FD-05` | Phase 3 | Replace broad social store subscriptions with selector/projection ownership gates |
| `DL-FD-06` | Phase 3 | Move full conversation derive/sort out of render and into maintained projection state |
| `DL-FD-07` | Phase 4 | Move context menu visibility to OverlayHost priority lane and lazily resolve row menu model |
| `DL-FD-08` | Phase 1 | Make SideNav a pure shell switcher; move chat/session creation off the click frame |
| `DL-FD-09` | Phase 0 | Make gateway/acceptance/ready-shell preflight fail-closed before any browser performance sample |
| `DL-FD-10` | Phase 0 / Phase 5 | Make stable startup entrypoints (`make desktop`, `make desktop-web`, `make station`, performance gate) prove clean runtime state; implementation scripts remain replaceable details; Tauri true-click blocked cells must record permission/telemetry blocker |

## 11. Non-Goals

- 不以 `useMemo`、`memo`、局部 selector 改几个组件作为完成标准。
- 不把某个页面临时改轻作为完成标准。
- 不通过关闭功能、删除页面、减少测试数据掩盖问题。

## 12. Definition of Done

1. Desktop performance gate 纳入质量证据。
2. 一级导航、二级 tab、右键菜单均满足红线。
3. hidden render、store fanout、Tauri invoke 都有可读 trace。
4. 任意新增页面/section 必须声明 lifetime 和预算。
5. 任意新增 overlay 必须走 OverlayHost 或登记豁免。
