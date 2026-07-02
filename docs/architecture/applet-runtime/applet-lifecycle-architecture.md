# Applet Lifecycle Architecture — 小程序生命周期与保活架构

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-07-02 | **Updated**: 2026-07-02
> **Owner**: Architecture Team
> **Module**: Applet Kernel (cross-platform), Desktop Shell, Mobile Shell, `packages/applet-sdk/`

---

## 1. 升级目标

**问题**：当前小程序保活依赖 Desktop PageHost `display:none` + React mount/unmount + LRU page count，缺少：
- 跨端统一的生命周期状态机
- 小程序维度（非页面维度）的保活/回收策略
- Host 到 Lynx 的 `show/hide/pause/resume/suspend/destroy` 完整事件链
- 长期不用时基于 TTL/内存压力的分级回收
- 与 Native Lynx Runtime 对齐的生命周期模型

**目标**：定义跨 Desktop、Android、iOS 的小程序运行时生命周期管理架构，不依赖 WebView DOM 语义。

**非目标**：
- 不定义具体 Applet 的业务状态持久化策略
- 不定义 Applet Store、审核、分发、计费
- 不替代 `sdk-architecture.md` 中的 SDK 接口定义

---

## 2. 核心原则

1. **Applet Kernel 管生命周期，Shell 管 surface**
   - Applet Kernel 是跨端内核，负责 session、permission、lifecycle orchestration、resource scheduling。
   - Host Shell（Desktop/Mobile）只负责 window/surface 编排和系统事件翻译，不做生命周期决策。

2. **Native Lynx Runtime first**
   - 长期目标：Desktop 和 Mobile 都使用 Native Lynx surface，不依赖 WebView DOM。
   - WebView Lynx for Web 作为过渡 adapter，不是长期主线。

3. **切换不重载，长期回收**
   - 短期切换（tab 切换、页面导航）保留 Lynx surface、JS context、session。
   - 长期不用（超过 TTL/LRU/内存压力）分级回收，最终销毁。

4. **验证先行**
   - 任何架构层假设必须通过 spike gate 验证后才能正式确认。
   - 未验证的路径标记为 `unproven`，不得作为下游实施依据。

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

### Desktop (长期: Native Lynx)

| 平台事件 | 生命周期事件 | 说明 |
|---------|------------|------|
| 用户点击打开小程序 | launch | cold start |
| Lynx surface ready + SDK reportReady | ready → show | 首次可见 |
| 用户切到其他 tab/page | hide | 保留 surface |
| 用户切回 | show | instant 恢复 |
| 窗口 minimize/失焦 | pause | 暂停 timer |
| 窗口 restore/获焦 | resume | 恢复 |
| 闲置超过 suspend TTL | suspend | 释放 GPU，保留状态 |
| 用户切回 suspended applet | restore → show | 恢复 surface |
| 用户点关闭 / LRU 淘汰 / 内存压力 / 版本升级 | destroy | 完全回收 |

### Desktop (过渡: WebView + Lynx for Web)

| 平台事件 | 生命周期事件 | 说明 |
|---------|------------|------|
| PageHost active → applet page | launch/show | PageHost display:block |
| PageHost active → other page | hide | PageHost display:none |
| window blur / document hidden | pause | WebView 可能节流 |
| window focus / document visible | resume | |
| LRU evict / explicit close | destroy | 卸载 `<lynx-host>` |

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
│ surface mgmt │     │ onTrimMemory │     │ didEnter     │
│ display/hide │     │ LynxView mgmt│     │ Background   │
│ memory mon   │     │ memory mon   │     │ LynxView mgmt│
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

## 7. Desktop 长期目标：Rust Shell + Native Lynx

### 架构

```text
┌─────────────────────────────────────────────────┐
│           Desktop Rust Host Process              │
│                                                  │
│  ┌────────────────────────────────────────────┐ │
│  │           Applet Kernel (Rust)              │ │
│  │  lifecycle / session / resource / trace     │ │
│  └──────────────────┬─────────────────────────┘ │
│                     │                            │
│  ┌──────────────────┼─────────────────────────┐ │
│  │  Native Window / Surface Manager            │ │
│  │                                             │ │
│  │  ┌───────────────────────────────────┐      │ │
│  │  │  Lynx Native Engine (embedded)    │      │ │
│  │  │  - JS Context                     │      │ │
│  │  │  - Layout / Render                │      │ │
│  │  │  - NativeModules → Applet Kernel  │      │ │
│  │  └───────────────────────────────────┘      │ │
│  │                                             │ │
│  │  ┌───────────────────────────────────┐      │ │
│  │  │  Input / IME / Accessibility      │      │ │
│  │  └───────────────────────────────────┘      │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  ┌────────────────────────────────────────────┐ │
│  │  Admin Shell (Tauri WebView, optional)     │ │
│  │  settings / dev tools / permission UI      │ │
│  └────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### 优势

- 不依赖 WebView `display:none` 语义做保活
- 不受浏览器 timer throttle、rAF pause 影响
- Lynx engine 生命周期直接由 Rust Host 控制
- surface 隐藏/显示是 native window 操作，不是 DOM 操作
- 内存可精确监控（Lynx engine heap + native allocation）
- crash 不影响其他 applet 或 Host UI

### 关键假设（必须 spike 验证）

| 假设 | 验证方式 | 判定标准 | 状态 |
|------|---------|---------|------|
| Lynx engine 可作为 native library 嵌入 Rust 进程 | spike: Rust FFI 调用 Lynx C/C++ API 创建 engine 实例 | 能创建、加载 bundle、接收 bridge 调用 | **unproven** |
| Native Lynx surface 可在 macOS/Windows/Linux native window 中渲染 | spike: 创建 native window，attach Lynx render surface | 正确渲染 hello-world Lynx bundle | **unproven** |
| 多个 Lynx engine 实例可在同进程共存 | spike: 同时运行 2+ applet engine | 互不干扰，独立 JS context | **unproven** |
| Lynx engine 可暂停/恢复 JS execution | spike: 调用 pause/resume API 或等效机制 | timer/rAF 暂停，恢复后继续 | **unproven** |
| 输入事件（键盘/鼠标/IME）可正确路由到 Lynx surface | spike: 在 native window 中交互 Lynx UI | 正确响应输入、弹出 IME | **unproven** |
| Bridge NativeModule 可从 Lynx JS 调用回 Rust Host | spike: hello-world applet invoke storage.get | 完整 roundtrip 成功 | **unproven** |

**Gate**: 以上 6 项全部验证通过后，Desktop Native Lynx 路线正式确认；否则保留 WebView adapter 作为 production 路径，并评估阻塞项的解决成本。

---

## 8. Mobile 长期目标：Native Lynx Container

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

## 9. WebView 过渡 Adapter（当前状态）

当前 Desktop 仍运行在 `Tauri WebView + Lynx for Web` 模式。在 Native Lynx spike 验证通过前，这是 production 路径。

### 当前保活机制

```text
PageHost (React)
  → mounted pages Map
  → active page: display:block
  → hidden pages: display:none (保留 DOM tree)
  → LRU: recentRef 记录访问顺序，超过上限卸载

appletsRuntime
  → acquirePage: loadApplet (创建 session + mount <lynx-host>)
  → releasePage: unloadApplet (destroy session + unmount)

LynxHostElement
  → connectedCallback: mount <lynx-view>
  → disconnectedCallback: destroyLynxView
  → 不感知 PageHost display:none
```

### 当前缺口（过渡期也需修复）

| 问题 | 影响 | 修复优先级 |
|------|------|-----------|
| 页面切走不发 `hide/show` | 小程序无法暂停轮询/动画 | P0 |
| LRU 混合 applet 和 primary page | 可能误删 forever page | P1 |
| 显式关闭不从 mounted 删除 | 旧 LynxHost 残留 DOM | P1 |
| 无 TTL/内存压力策略 | 长期不用不回收 | P2 |
| hidden-warm 无 GPU 释放 | WebView 无法精确控制 | 受限于 WebView |

### 过渡期修复计划

即使 Native Lynx 是长期目标，过渡期也要让 WebView adapter 达到基本可用：

1. `LynxHostElement` 新增 `visible` property → 发 `show/hide`
2. `PageHost` active 变化时通知对应 `LynxHostElement.visible`
3. `AppletLRUCache` 独立于 primary page LRU
4. `PageHost.closePage()` 显式删除 mounted entry
5. 添加基础 TTL（hidden 30min → unload）

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

```text
Phase 0: Spike (验证)
  → Desktop Native Lynx 6 项 spike gate
  → Mobile LynxView 暂停/内存压力验证
  → 产出 spike report，决定是否确认长期路线

Phase 1: Contract Lock (协议冻结)
  → 冻结 AppletLifecycleState / AppletLifecycleEvent 协议
  → 冻结 Platform Adapter Interface
  → SDK lifecycle hooks 对齐新状态机

Phase 2: Kernel Implementation
  → 实现跨端 Applet Instance Registry
  → 实现 Lifecycle Orchestrator
  → 实现 Resource Scheduler (LRU + TTL + memory pressure)

Phase 3: Platform Adapter
  → Desktop: Native Lynx adapter (如 spike 通过) 或 WebView adapter 升级
  → Android: LynxView lifecycle adapter
  → iOS: LynxView lifecycle adapter

Phase 4: Integration & Hardening
  → 多实例压测
  → 长期后台 soak test
  → crash recovery
  → 版本升级/权限撤销

Phase 5: WebView Sunset (如 Native Lynx 确认)
  → Desktop WebView adapter 降为 dev-only
  → 移除 PageHost display:none 保活依赖
  → 正式切换 production 路径
```

---

## 14. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Lynx Desktop native embedding 不可行 | 长期路线受阻 | 保留 WebView adapter 为 fallback production 路径 |
| Lynx engine 不支持多实例 | 无法同时保活多个 applet | 评估进程隔离或时分复用 |
| 内存监控不精确 | TTL/压力策略失效 | 用 JS heap snapshot + native RSS 估算 |
| Mobile LynxView detach 后状态丢失 | hidden-warm 不成立 | 验证 offscreen 保留 vs snapshot/restore |
| 跨端事件时序不一致 | SDK handler 行为不一致 | contract test 覆盖事件顺序 |
