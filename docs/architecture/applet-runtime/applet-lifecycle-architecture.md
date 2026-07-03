# Applet Lifecycle Architecture — 小程序生命周期与保活架构

> **Status**: draft
> **Version**: v2.0
> **Created**: 2026-07-02 | **Updated**: 2026-07-02
> **Owner**: Architecture Team
> **Module**: Applet Kernel (cross-platform), Desktop Shell, Mobile Shell, `packages/applet-sdk/`

---

## 1. 目标

定义跨 Desktop、Android、iOS 的小程序运行时生命周期管理架构。

- **保活/回收是 Applet Kernel 的职责，与底层渲染 runtime 无关。** 状态机、LRU/TTL/内存压力策略在所有平台一致。
- Desktop 使用 **Tauri WebView + Lynx for Web** 承载 Lynx surface；Mobile 使用原生 `LynxView`。
- 两端共用同一份 `main.lynx.bundle`，共用同一套生命周期语义。

**非目标**：
- 不定义具体 Applet 的业务状态持久化策略
- 不定义 Applet Store、审核、分发、计费
- 不替代 `sdk-architecture.md` 中的 SDK 接口定义

---

## 2. 核心原则

1. **Applet Kernel 管生命周期，Shell 管 surface**
   - Applet Kernel 是跨端内核，负责 session、permission、lifecycle orchestration、resource scheduling。
   - Host Shell（Desktop/Mobile）只负责 surface 编排和系统事件翻译，不做生命周期决策。
   - **保活不依赖具体渲染技术**：无论 Desktop 的 WebView Lynx surface 还是 Mobile 的原生 LynxView，Kernel 都通过统一的 `show/hide/detach/destroy` 语义控制。

2. **Desktop = Tauri WebView + Lynx for Web**
   - Desktop 用系统 WebView 承载 Lynx for Web runtime（`<lynx-view>`），复用与 Mobile 相同的 Lynx bundle。
   - 这是长期主线，不是过渡方案。理由见 §2.1。
   - Native FFI 直接嵌入 Lynx C/C++ engine 是远期观察项，不是当前路线。

3. **切换不重载，长期回收**
   - 短期切换（tab 切换、页面导航）保留 Lynx surface、JS context、session。
   - 长期不用（超过 TTL/LRU/内存压力）分级回收，最终销毁。
   - 保活的本质是 Kernel 保留实例 + Shell 控制可见性（`display`/`detach`），不是每次都重建。

4. **验证先行**
   - 任何架构层假设必须通过 spike gate 验证后才能正式确认。
   - 未验证的路径标记为 `unproven`，不得作为下游实施依据。

### 2.1 为什么 Desktop 选 WebView + Lynx for Web，而不是自研 native runtime

| 维度 | Tauri WebView + Lynx for Web（选定） | 自研 Rust FFI 嵌入 Lynx engine（否决） |
|------|-------------------------------------|----------------------------------------|
| 官方支持 | Lynx for Web 是官方 GA runtime | 官方无 Desktop native FFI 集成文档 |
| 成本 | 复用现有 Tauri WebView 栈，与 Mobile 共用 bundle | 需自研 C/C++ FFI、surface、输入、IME、多实例，成本极高 |
| 风险 | 低，可增量落地 | 高，地基假设未经验证 |
| Lynx 官方 Desktop 参照 | — | Lynxtron 本身是 **Electron X（Electron fork）+ Lynx**，即官方 Desktop 也走 Chromium/WebView 血统，未走纯 native FFI；且非 GA（2026 H1 才逐步开源） |

结论：官方旗舰 Desktop 方案（Lynxtron）本质是 Electron/Chromium + Lynx，我们更没有理由自研一个比它还底层的 native 嵌入。Desktop 用 WebView 承载 Lynx 是被官方路线印证的稳妥长期方向。保活能力完全由 Kernel 提供，不因 WebView 而受损。

---

## 3. 生命周期状态机

```text
                    ┌──────────────┐
                    │     cold     │
                    └──────┬───────┘
                           │ launch
                           ▼
                    ┌──────────────┐
                    │ materializing│
                    └──────┬───────┘
                           │ ready
                           ▼
              ┌─────────────────────────┐
              │        visible          │◄─────────────────┐
              └─────┬──────────┬────────┘                  │
                    │          │                            │
          hide     │          │ app-background       show  │
                    ▼          ▼                            │
         ┌──────────────┐  ┌──────────┐                    │
         │ hidden-warm  │  │  paused  │────resume──────────┤
         └──────┬───────┘  └──────────┘                    │
                │                                          │
     suspend    │                                          │
     (ttl/lru)  ▼                                          │
         ┌──────────────┐                                  │
         │  suspended   │──────restore─────────────────────┘
         └──────┬───────┘
                │ destroy (memory-pressure/explicit-close/lru-evict/upgrade)
                ▼
         ┌──────────────┐
         │  destroyed   │
         └──────────────┘
```

### 状态定义

| 状态 | Surface | JS Context | Session | 描述 |
|------|---------|-----------|---------|------|
| `cold` | 无 | 无 | 无 | 未加载，无资源占用 |
| `materializing` | 创建中 | 创建中 | 已创建 | 解析 manifest、准备 surface、加载 bundle |
| `visible` | 有，前台 | 有，活跃 | 有效 | 可交互，允许动画/输入/实时任务 |
| `hidden-warm` | 有，保留 | 有，保留 | 有效 | 切走但保留全部资源，切回 instant |
| `paused` | 有，保留 | 有，暂停 timer/rAF | 有效 | App 后台或系统 idle |
| `suspended` | 可释放 GPU | 有，冻结 | 有效（续租） | 长期不用，保留最小状态，可快速恢复 |
| `destroyed` | 无 | 无 | 已销毁 | 完全回收，再次打开是 cold start |

### 状态转换事件

| 事件 | 触发条件 | 源状态 | 目标状态 |
|------|---------|--------|---------|
| `launch` | 用户/系统打开小程序 | cold | materializing |
| `ready` | SDK `reportReady()` + surface mounted | materializing | visible |
| `show` | 切回/恢复可见 | hidden-warm/paused/suspended | visible |
| `hide` | tab 切换/页面导航走开 | visible | hidden-warm |
| `pause` | app background/窗口最小化/系统 idle | visible/hidden-warm | paused |
| `resume` | app foreground/窗口恢复 | paused | visible (如果之前是 visible) 或 hidden-warm |
| `suspend` | TTL 超时/LRU 淘汰但未到 destroy 门槛 | hidden-warm/paused | suspended |
| `restore` | 用户切回 suspended 小程序 | suspended | visible |
| `destroy` | 显式关闭/LRU 极限/内存压力严重/权限撤销/版本升级 | 任意非 cold | destroyed |

### 错误/异常状态

| 异常 | 处理 |
|------|------|
| manifest 校验失败 | materializing → destroyed + 错误上报 |
| bundle 加载超时 | materializing → destroyed + 可重试 |
| crash/unhandled error | visible/hidden-warm → destroyed + crash report |
| session 过期 | Gateway 拒绝 invoke → 触发 re-materialize 或 destroy |

---

## 4. 事件映射标准

### Desktop (Tauri WebView + Lynx for Web)

| 平台事件 | 生命周期事件 | 说明 |
|---------|------------|------|
| 用户点击打开小程序 | launch | cold start，创建 `<lynx-view>` host |
| Lynx surface ready + SDK reportReady | ready → show | 首次可见 |
| 用户切到其他 tab/page | hide | 保留 host，切走的容器 `display:none` / detach |
| 用户切回 | show | instant 恢复，不重建 host |
| 窗口 minimize / 失焦 / document hidden | pause | 暂停 timer/rAF（WebView 可能自行节流，Kernel 统一发 pause） |
| 窗口 restore / 获焦 / document visible | resume | 恢复 |
| 闲置超过 suspend TTL | suspend | 卸载 host 保留最小状态，或释放重资源 |
| 用户切回 suspended applet | restore → show | 重新 attach host |
| 用户点关闭 / LRU 淘汰 / 内存压力 / 版本升级 | destroy | 完全回收 `<lynx-view>` host |

### Mobile (Android/iOS: Native Lynx)

| 平台事件 | 生命周期事件 | 说明 |
|---------|------------|------|
| 用户打开小程序 | launch | 创建 LynxView |
| LynxView ready + SDK reportReady | ready → show | |
| 用户切到其他 tab/小程序 | hide | 保留 LynxView |
| 用户切回 | show | |
| App 进入后台 (onStop/viewDidDisappear) | pause | |
| App 回到前台 (onStart/viewDidAppear) | resume | |
| 长时间后台 / 系统 trim memory | suspend 或 destroy | 按等级判断 |
| 用户主动关闭 / 任务清理 | destroy | |

---

## 5. 资源策略

### 5.1 LRU 策略

- 维度：`user + workspace + appletId + instanceId`，不是 page key。
- 每个平台维护独立 `AppletLRUCache`，不与 primary page LRU 混合。
- 默认 LRU size：
  - Desktop: 4 个 applet 实例
  - Mobile: 3 个 applet 实例（内存更紧张）
- LRU 淘汰进入 `suspended`，不直接 `destroyed`（给恢复机会）。
- 超过 `suspended` 上限（如 8）再 destroy oldest suspended。

### 5.2 TTL 策略

| 状态 | TTL | 到期动作 |
|------|-----|---------|
| hidden-warm | 30 分钟 | → suspended |
| suspended | 120 分钟 | → destroyed |
| paused (app background) | 15 分钟 | → suspended |

TTL 可按设备等级动态调整：低端设备缩短，高端设备延长。

### 5.3 内存压力策略

| 压力等级 | 来源 | 动作 |
|---------|------|------|
| low | 系统通知 / Applet Kernel 监控 | 无动作 |
| moderate | 系统 trim memory / JS heap 增长 | 淘汰最旧 suspended → destroyed |
| critical | 系统 OOM warning | 所有非 visible → destroyed |

### 5.4 显式回收触发

| 触发 | 动作 |
|------|------|
| 用户主动关闭 | hide → destroy → release session |
| 权限撤销 | destroy (立即) |
| 版本升级（manifest version 变化） | destroy → 下次 launch 用新版本 |
| Applet 被管理员禁用 | destroy (立即) |
| crash 3 次 | 标记 unhealthy，destroy，阻止自动 re-launch |

---

## 6. 分层架构

```text
┌─────────────────────────────────────────────────────────────┐
│                     Applet (Bundle + SDK)                     │
│  onShow/onHide/onPause/onResume/onDestroy/reportReady        │
└──────────────────────────────┬──────────────────────────────┘
                               │ Bridge
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      Applet Kernel                            │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Lifecycle   │  │   Session    │  │    Resource       │  │
│  │ Orchestrator│  │   Manager    │  │    Scheduler      │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬──────────┘  │
│         │                │                    │              │
│  ┌──────┴──────────────────┴────────────────────┴────────┐  │
│  │              Applet Instance Registry                   │  │
│  │  (state, lastVisibleAt, lastHiddenAt, memoryUsage)     │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Platform Adapter Interface                  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│Desktop Adapter│     │Android Adapter│     │ iOS Adapter  │
│              │     │              │     │              │
│ window focus │     │ Activity     │     │ UIScene      │
│ WebView vis  │     │ onTrimMemory │     │ didEnter     │
│ lynx-view    │     │ LynxView mgmt│     │ Background   │
│ show/hide    │     │ memory mon   │     │ LynxView mgmt│
│ memory mon   │     │              │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
```

### 各层职责

| 层 | 职责 | 不负责 |
|----|------|--------|
| Applet SDK | 暴露 lifecycle hooks，接收 Host 事件 | 决定何时 destroy/suspend |
| Lifecycle Orchestrator | 根据事件和策略驱动状态转换 | 管理 surface 创建/销毁细节 |
| Session Manager | 创建/续租/销毁 Gateway session | 业务数据 |
| Resource Scheduler | LRU/TTL/内存压力扫描，触发 suspend/destroy | 具体回收执行 |
| Platform Adapter | 翻译平台事件为标准生命周期事件 | 生命周期策略决策 |
| Host Shell | surface 创建/隐藏/销毁、输入事件、窗口编排 | 生命周期状态管理 |

---

## 7. Desktop：Tauri WebView + Lynx for Web

### 架构

```text
┌─────────────────────────────────────────────────┐
│           Desktop App (Tauri)                    │
│                                                  │
│  ┌────────────────────────────────────────────┐ │
│  │        Applet Kernel (TS, in WebView)       │ │
│  │  lifecycle / session / resource / trace     │ │
│  │  ── bridge ──▶ Rust Capability Gateway      │ │
│  └──────────────────┬─────────────────────────┘ │
│                     │                            │
│  ┌──────────────────┼─────────────────────────┐ │
│  │  Surface Manager (DOM host container)       │ │
│  │                                             │ │
│  │  ┌───────────────────────────────────┐      │ │
│  │  │  <lynx-view> (Lynx for Web)       │      │ │
│  │  │  - JS Context                     │      │ │
│  │  │  - Layout / Render (in WebView)   │      │ │
│  │  │  - NativeModules → Applet Kernel  │      │ │
│  │  └───────────────────────────────────┘      │ │
│  │                                             │ │
│  │  show/hide = display / attach-detach        │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  ┌────────────────────────────────────────────┐ │
│  │  Rust Host (Tauri): Capability Gateway,     │ │
│  │  permission, audit, local storage, network  │ │
│  └────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### 为什么保活成立

保活是 Kernel + Surface Manager 的能力，WebView 不构成障碍：

- **切换不重载**：切走的 applet host 保留 DOM 实例（`display:none` 或 detach），Lynx JS context 与 session 不销毁，切回 instant `show`。
- **timer/rAF 节流**：WebView 后台可能自行节流，Kernel 统一在 `pause` 事件里冻结 applet 侧 timer，不依赖浏览器行为，语义与 Mobile 一致。
- **长期回收**：TTL/LRU/内存压力触发 `suspend`（卸载 host 保留最小状态）→ `destroy`（移除 `<lynx-view>` host，释放 JS context 与 session）。
- **内存监控**：通过 JS heap（`performance.memory` best-effort）+ Rust 侧进程 RSS 估算，喂给 ResourceScheduler。

### 关键假设（必须 spike 验证）

| 假设 | 验证方式 | 判定标准 | 状态 |
|------|---------|---------|------|
| Lynx for Web 可在 Tauri 系统 WebView 中稳定运行 | spike: 在 Tauri WebView 加载 `<lynx-view>` + hello-world bundle | 正确渲染、可交互 | **unproven** |
| Worker / custom protocol / asset URL / CSP 在 WKWebView & WebView2 兼容 | spike: 三平台加载真实 bundle | 无 CSP/Worker/asset 阻塞 | **unproven** |
| host `display:none` / detach 保活后切回不丢状态 | spike: A→B→A 切换 | UI/scroll/input draft 保留 | **unproven** |
| 多个 `<lynx-view>` host 共存互不干扰 | spike: 同时挂载 2+ applet | 独立 JS context，无串扰 | **unproven** |
| Kernel `pause` 能冻结 WebView 后台的 applet timer/rAF | spike: 后台计时行为 | pause 后停止，resume 后继续 | **unproven** |
| NativeModules Bridge → Rust Capability Gateway roundtrip | spike: hello-world invoke storage.get | 完整 roundtrip 成功 | **unproven** |

**Gate**: 以上 6 项通过后正式进入实施。若 Lynx for Web 在某平台 WebView 出现不可接受兼容问题，按 `design.md §9` 的降级决策树处理（Shadow DOM 隔离 + dynamic import，仍不引入 iframe）。

### 远期观察项（不是当前路线）

- **Native FFI 嵌入 Lynx engine**：官方无 Desktop native 集成文档，暂不投入。
- **Lynxtron（Electron X + Lynx）**：Lynx 官方 Desktop 方案，本质是 Electron fork，2026 H1 才逐步开源、非 GA。待其成熟且开源可用后，可评估是否作为 Desktop Shell 的替代宿主——但届时 SDK / 协议 / 生命周期契约不变，只换容器。

---

## 8. Mobile：Native Lynx Container

### 架构

```text
┌─────────────────────────────────────────────────┐
│        Mobile App (Android / iOS)                │
│                                                  │
│  ┌────────────────────────────────────────────┐ │
│  │         Applet Kernel (Kotlin/Swift)        │ │
│  │  lifecycle / session / resource / trace     │ │
│  └──────────────────┬─────────────────────────┘ │
│                     │                            │
│  ┌──────────────────┼─────────────────────────┐ │
│  │  Applet Container (Fragment/ViewController) │ │
│  │                                             │ │
│  │  ┌───────────────────────────────────┐      │ │
│  │  │  LynxView (Native)               │      │ │
│  │  │  - JS Engine                     │      │ │
│  │  │  - Native Render                 │      │ │
│  │  │  - NativeModules → Applet Kernel │      │ │
│  │  └───────────────────────────────────┘      │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  ┌────────────────────────────────────────────┐ │
│  │  App Shell (Navigation / Tabs)             │ │
│  └────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### Mobile 生命周期对齐

| Android 事件 | iOS 事件 | Applet 生命周期 |
|-------------|---------|----------------|
| Fragment.onResume | viewDidAppear | show |
| Fragment.onPause (tab switch) | viewDidDisappear (tab) | hide |
| Activity.onStop (app bg) | sceneDidEnterBackground | pause |
| Activity.onStart (app fg) | sceneWillEnterForeground | resume |
| onTrimMemory(MODERATE) | didReceiveMemoryWarning | suspend 或 destroy |
| Fragment.onDestroy | deinit | destroy |

### Mobile 保活机制

- tab 切换：LynxView 从 view hierarchy 移除但保留实例 → `hidden-warm`
- 或使用 ViewPager/UIPageViewController offscreenPageLimit 保留相邻
- App background：LynxView 暂停动画/timer → `paused`
- 长时间后台：Timer 触发 suspend，释放 GPU texture → `suspended`
- 系统内存压力：destroy oldest suspended，必要时 destroy hidden-warm

### Mobile 验证状态

| 假设 | 验证方式 | 状态 |
|------|---------|------|
| LynxView 可保留实例但从 window 移除不 crash | 测试 detach/reattach | **existing implementation** |
| 多个 LynxView 实例共存 | 启动 3 个 applet | **existing implementation** |
| NativeModule bridge 正常 roundtrip | storage.get/set | **existing implementation** |
| App background 时暂停 JS timer | 验证 timer 行为 | **needs verification** |
| 内存压力时可安全 destroy 非 visible LynxView | onTrimMemory 测试 | **needs verification** |

---

## 9. 端侧渲染 runtime 汇总

生命周期状态机、LRU/TTL/内存压力策略在所有平台一致；差异只在 surface 承载技术：

| 平台 | Surface 承载 | show/hide 机制 | Bridge |
|------|-------------|---------------|--------|
| Desktop | Tauri WebView 内的 `<lynx-view>`（Lynx for Web） | DOM `display` / attach-detach | NativeModules → Rust Capability Gateway |
| Android | 原生 `LynxView` | view hierarchy attach/detach | NativeModule (Kotlin) → BridgeDispatcher |
| iOS | 原生 `LynxView` | superview add/remove | NativeModule (Swift) → BridgeDispatcher |

不引入 iframe 作为 applet 隔离边界；隔离依赖 package integrity、Capability Gateway、CSP、trusted host injection 和可审计 session。

---

## 10. Applet Instance Registry 数据模型

```typescript
interface AppletInstance {
  appletId: string
  instanceId: string
  sessionId: string
  state: AppletLifecycleState
  createdAt: number
  lastVisibleAt: number
  lastHiddenAt: number
  lastTouchedAt: number // 最后一次 invoke/event
  memoryEstimate: number // bytes, best-effort
  crashCount: number
  manifestVersion: string
  platform: 'desktop' | 'android' | 'ios'
}

type AppletLifecycleState =
  | 'cold'
  | 'materializing'
  | 'visible'
  | 'hidden-warm'
  | 'paused'
  | 'suspended'
  | 'destroyed'

interface AppletLifecycleEvent {
  type: 'launch' | 'ready' | 'show' | 'hide' | 'pause' | 'resume'
       | 'suspend' | 'restore' | 'destroy' | 'memory-pressure' | 'error'
  appletId: string
  instanceId: string
  timestamp: number
  reason?: string
}
```

---

## 11. 验收标准

### 切换保活

- A → B → A：不重建 Lynx runtime，不重拉 bundle，不丢 UI state/scroll/input draft
- 事件顺序：`hide(A)` → `show(B)` → `hide(B)` → `show(A)`
- 恢复后 UI 完全一致，无白屏/闪烁

### 长期回收

- 超过 hidden TTL（30min）→ 进入 `suspended`，可观测 timer/animation 暂停
- 超过 suspended TTL（120min）或 LRU 极限 → 进入 `destroyed`
- 再次打开是明确 cold start（新 session、新 surface、重新 reportReady）

### 内存压力

- 系统 memory warning → 最旧 suspended 被 destroy
- 多开超 LRU limit → 最旧 hidden-warm 被 suspend

### 多端一致

- 同一 applet bundle 在 Desktop/Mobile 的生命周期事件语义一致
- SDK `onShow/onHide/onPause/onResume/onDestroy` handler 在所有平台被正确调用

### 资源可控

- 并发 applet 实例数有硬上限
- 每个实例的内存估算可查
- crash 3 次自动阻止 re-launch

---

## 12. 与现有文档关系

| 文档 | 关系 |
|------|------|
| `runtime-architecture.md` | 本文补充其 §10 生命周期状态机，并扩展保活/回收策略 |
| `design.md` | 本文为其 §3 Platform Support Matrix 的 Desktop 长期目标提供验证路径 |
| `sdk-architecture.md` | 本文使用其 §4.2 Lifecycle API 作为 Applet 侧接口 |
| `frontend-component-tree.md` | Applet runtime instance 的 alive category 定义对齐本文 |
| `frontend-component-tree-registry.md` | Applet 行更新为本文定义的 LRU + TTL 策略 |

---

## 13. 实施顺序

详见 [`execution-plans/2026-07-02-applet-runtime-lifecycle-buildout.md`](./execution-plans/2026-07-02-applet-runtime-lifecycle-buildout.md)。

```text
Phase 0: Spike (验证)
  → Desktop: Lynx for Web in Tauri WebView 6 项 spike gate
  → Mobile: LynxView 暂停/内存压力验证
  → 产出 spike report

Phase 1: Contract Lock (协议冻结)
  → 冻结 AppletLifecycleState / AppletLifecycleEvent 协议
  → 冻结 Platform Adapter Interface
  → SDK lifecycle hooks 对齐新状态机

Phase 2: Kernel Implementation
  → 实现跨端 Applet Instance Registry
  → 实现 Lifecycle Orchestrator
  → 实现 Resource Scheduler (LRU + TTL + memory pressure)

Phase 3: Platform Adapter
  → Desktop: Tauri WebView + Lynx for Web surface 管理
  → Android: LynxView lifecycle adapter
  → iOS: LynxView lifecycle adapter

Phase 4: Integration & Hardening
  → 多实例压测
  → 长期后台 soak test
  → crash recovery
  → 版本升级/权限撤销

Phase 5: 收敛旧 applet 页面运行时
  → 统一 applet host 到新 Kernel + Surface Manager
  → 移除临时/重复的保活逻辑
```

---

## 14. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Lynx for Web 在某平台 WebView 兼容问题（Worker/CSP/asset） | Desktop 渲染受阻 | 按 `design.md §9` 降级决策树：Shadow DOM 隔离 + dynamic import，不引入 iframe |
| WebView 后台节流干扰 timer/rAF 语义 | pause/resume 行为不一致 | Kernel 统一发 pause/resume 事件冻结 applet 侧 timer，不依赖浏览器行为 |
| 内存监控不精确 | TTL/压力策略失效 | 用 JS heap（`performance.memory`）+ Rust 进程 RSS 估算 |
| Mobile LynxView detach 后状态丢失 | hidden-warm 不成立 | 验证 offscreen 保留 vs snapshot/restore |
| 跨端事件时序不一致 | SDK handler 行为不一致 | contract test 覆盖事件顺序 |
