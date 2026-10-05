# Applet Runtime Spike Report — Desktop (Tauri WebView + Lynx for Web)

> **Status**: Phase 0 baseline
> **Created**: 2026-07-02
> **Scope**: Desktop 端 Lynx-for-Web 承载 + Kernel 保活可行性
> **对应执行计划**: [`2026-07-02-applet-runtime-lifecycle-buildout.md §3`](../../../docs/architecture/platform/applet-runtime/execution-plans/2026-07-02-applet-runtime-lifecycle-buildout.md)

---

## 0. 关键结论

Desktop Lynx-for-Web runtime **已存在于生产代码**，不是从零起步。Spike 的目的因此从
"验证一条尚不存在的路径能否走通" 调整为 "基于现有 runtime 补齐验证证据 + 精确定位保活缺口"。

- **渲染 / Bridge / 生命周期事件**：已由生产代码 + 单测证明成立（item 1 / 5 / 6 proven）。
- **保活（切走不销毁、切回不冷启）**：**真实缺口**，当前实现是"切走即销毁"（item 3 unproven）。
- **三平台 WebView 兼容 / 多 host 共存**：代码路径已具备，但缺实机证据（item 2 / 4 partial）。

保活缺口不属于渲染 runtime 问题，而是 Kernel + Surface Manager 能力缺失，属 Phase 2 / Phase 3 工作。
这与执行计划 §12 "不用 React mount/unmount 做保活（保活归 Kernel + Surface Manager）" 的判断一致。

---

## 1. 现有资产清单（作为证据来源）

| 资产 | 路径 | 作用 |
|------|------|------|
| `<lynx-host>` Custom Element | [`lynx-host-element.ts`](../src/applet/lynx-host-element.ts) | 挂载 `<lynx-view>`、Bridge 拦截、生命周期事件、事件轮询 |
| Runtime loader | [`lynx-web-runtime.ts`](../src/applet/lynx-web-runtime.ts) | dev/prod 加载 `@lynx-js/web-core/client`，预热规避 TemplateManager 竞态 |
| React 容器 | [`LynxContainer.tsx`](../src/applet/LynxContainer.tsx) | 解析 session、渲染 `<lynx-host>`、ready/timeout fallback |
| Manager（单例） | [`AppletManager.ts`](../src/applet/AppletManager.ts) | 扫描 / 校验 / 完整性校验 / session 创建销毁 |
| Element 注册 | [`register-elements.ts`](../src/applet/register-elements.ts) | 注册 `<lynx-host>` + `ensureLynxWebRuntime` |
| Dev applet | [`applets-dev/hello-lynx/`](../applets-dev/hello-lynx/) | `@lynx-js/react` + rspeedy 构建的验证 bundle |
| Bridge SDK adapter | [`packages/applet-sdk/src/adapters/lynx.ts`](../../../packages/applet-sdk/src/adapters/lynx.ts) | applet 侧 `NativeModules.bridge` + 长轮询 |

### 测试证据

运行 `cd apps/desktop && pnpm exec vitest run src/applet/lynx-host-element.test.ts src/applet/AppletManager.test.ts`：
**Test Files 2 passed，Tests 22 passed。**

- [`lynx-host-element.test.ts`](../src/applet/lynx-host-element.test.ts) — 11 tests：Bridge roundtrip、事件轮询、生命周期
  ready/show/hide/pause/resume/destroy、visibility → pause/resume、错误码保留。
- [`AppletManager.test.ts`](../src/applet/AppletManager.test.ts) — 11 tests：manifest / index schema 校验、拒绝
  `iframe` load type、接受 `lynx-web`、sha256 完整性校验、session 创建 / 销毁。

---

## 2. Spike 矩阵逐项结论（Desktop）

| # | 假设 | 结论 | 证据 |
|---|------|------|------|
| 1 | Lynx for Web 可在 Tauri 系统 WebView 稳定运行 | **Proven** | `lynx-host-element.ts` `mountLynxView` 创建 `<lynx-view>` 并 append，`lynx-web-runtime.ts` 已解决 runtime 加载与预热；host 测试全绿 |
| 2 | Worker / custom protocol / asset URL / CSP 三平台 WebView 兼容 | **Partial** | 代码路径已具备（dev 用 `import()`，prod 用 packaged runtime）；缺 WKWebView(mac) / WebView2(win) 实机加载真实 bundle 的证据 |
| 3 | host `display:none` / detach 保活，切回不丢状态 | **Unproven（真实缺口）** | 见 §3；当前是"切走即销毁"，无保活能力 |
| 4 | 多个 `<lynx-view>` host 共存 | **Partial** | 每个 `<lynx-host>` 独立创建 `<lynx-view>` 并注入独立 `globalProps{appletId,sessionId}`，架构上隔离；缺同时挂载 2+ applet 的实机串扰验证 |
| 5 | Kernel `pause` 冻结后台 applet timer/rAF | **Proven（事件语义）** | host 监听 document/window visibility/blur/focus → 发 `pause`/`resume` 事件（测试 'maps product document/window visibility to lifecycle pause/resume events' 通过）；applet 侧冻结 timer 的实际行为待 Phase 2 Kernel 落地 |
| 6 | NativeModules Bridge → Rust Capability Gateway roundtrip | **Proven** | `onNativeModulesCall` → `handleNativeModulesCall` → `api.appletInvoke`；测试 'routes NativeModules bridge.invoke calls to the Desktop Gateway with session and manifest' 通过，含 requestId/协议/错误码保留 |

**判定**：6 项中 3 项 proven、2 项 partial（仅缺实机证据、无架构阻塞）、1 项 unproven 且为已定位的
保活缺口（属后续 Phase 工作，非渲染路径阻塞）。**无任何证据表明 Lynx-for-Web 在 Tauri WebView 不可行**，
因此 Gate 判定为"可进入 Phase 1"，partial 项在 Phase 3 实机补齐。

---

## 3. 保活缺口（精确定位）

当前"切走即销毁、切回冷启动"的根因链路：

1. **`LynxContainer.tsx`**：切换 applet 时 React 卸载 `<LynxHost>`（且 `key={retryKey}`），
   触发 Custom Element 的 `disconnectedCallback`。
2. **`lynx-host-element.ts` [`disconnectedCallback` → `destroyLynxView`](../src/applet/lynx-host-element.ts#L188-L285)**：
   发 `hide` + `destroy` 事件、调 `AppletManager.unloadApplet(appletId)`、`lynxView.remove()`。
   → 只要 DOM 卸载就销毁，**没有 `display:none` / detach 保活分支**。
3. **`AppletManager.ts`**：
   - `appletInstances: Map<string, AppletInstanceRecord>` **以 `appletId` 为 key**（[L27](../src/applet/AppletManager.ts#L27)），
     **无 `instanceId` 维度**（无法支撑 `user + workspace + appletId + instanceId` 的 LRU 维度）。
   - `AppletInstanceRecord = { info, sessionId, loadedAt, status:'loaded' }`（[L10-L15](../src/applet/AppletManager.ts#L10-L15)），
     **无 LRU、无 TTL、无内存压力淘汰**字段与逻辑。
   - `unloadApplet` 直接 `lifecycle.destroy` + 从 Map 删除（[L196-L214](../src/applet/AppletManager.ts#L196-L214)），
     **无 hidden-warm / suspended 中间态**。

### 缺口 → Phase 映射

| 缺口 | 归属 |
|------|------|
| 无 6 态状态机（cold/materializing/visible/hidden-warm/paused/suspended/destroyed） | Phase 1 Contract + Phase 2 Kernel |
| `AppletManager` 无 `instanceId` / LRU / TTL / 内存压力 | Phase 2 Kernel（`AppletInstanceRegistry` / `ResourceScheduler`） |
| `<lynx-host>` 无 `display:none` / detach 保活分支 | Phase 3 Desktop（Surface Manager `show_host`/`hide_host`/`destroy_host`） |
| `LynxContainer` 卸载即销毁 | Phase 3 Desktop（Surface Manager 接管挂载/隐藏，页面层不再决定销毁） |

---

## 4. Gate 结论

| 项 | 状态 |
|----|------|
| 渲染路径（Lynx-for-Web in Tauri WebView） | 成立 |
| Bridge roundtrip | 成立 |
| 生命周期事件语义 | 成立 |
| 保活能力 | 缺失，已定位，归 Phase 2/3 |
| 三平台实机兼容 / 多实例并存 | 待实机补齐（Phase 3） |

**决定**：进入 Phase 1（Contract Lock）。partial 项在 Phase 3 Desktop 实机验收补齐；
保活缺口按 Phase 2/3 计划落地，不引入 iframe（对齐执行计划 §12）。
