# Desktop Page 生命周期 ↔ Runtime acquire/release 执行计划

> 关联契约真源：`docs/client/desktop/runtime-projections.md §6`（Runtime / Page / Boot 三契约）。
> 本计划是对 §6 契约的**扩展**，不重定义边界，只补齐"页面在位/离位如何驱动 owner runtime 释放"这一缺失环节。

## 1. 目标

- 建立 PageHost 层的 **page lifecycle ↔ runtime resource lease 通用内核契约**：页面进入活跃态、显式请求关闭、被 LRU 淘汰、被卸载时，内核按 `descriptor.runtimes` 通知 owner runtime 获取 / 释放会话级资源，而不是让每个动态页各自散写 load / unload。
- 让所有"动态运行页"（不止 applet，未来的嵌入式 runtime、会话详情页等）复用同一套生命周期，天然获得正确的获取与释放语义。
- 把 applet 会话的加载 / 卸载 / materialize / 刷新收口到 **applets runtime 作为唯一 owner**，页面与容器只表达意图（route active / close = release），不再直接触碰 `AppletManager`。

## 2. 当前问题

### 2.1 会话生命周期分散在三处

applet 会话的 load / unload 逻辑目前分散在：

- 页面：`apps/desktop/src/pages/AppletRuntimePage.tsx` 的自动 prepare `useEffect`（依据 `appletStatus` 自动 `loadApplet`）。
- 容器：`apps/desktop/src/applet/LynxContainer.tsx` 的 cleanup 直接 `AppletManager.unloadApplet(appletId)`。
- store：`apps/desktop/src/store/applets.ts` 的 `loadApplet` / `unloadApplet`。

这违反 §6.2 "页面是纯渲染方" 契约——页面 mount-time effect 承担了首次业务加载。

### 2.2 LRU 淘汰是纯 UI 卸载，不通知 owner runtime

`apps/desktop/src/kernel/PageHost.tsx` 的 LRU 淘汰逻辑（当前 L115-L143）只从 `mounted` 集合删除最旧页，是纯 DOM 卸载。内核**没有**"页面被 evict → 通知 owner runtime release"的钩子，导致被淘汰的 applet 页运行态投影短暂陈旧。

### 2.3 隐藏 keep-alive 页凭 status 自动重启

关闭 applet 后 `unloadApplet` 使 status 回到 `installed`；但 `keepAlive: { lru: 4 }` 的隐藏页仍在 `mounted` 中，其自动 prepare `useEffect` 依据 `installed` 又触发 `loadApplet`，产生"关不掉"的重载循环（P1-1）。

根因是同一份 status 既表示"目录可用性"又被页面当成"该不该加载"的信号，而没有一个中心 owner 表达"这个会话现在是否应当存活"。

## 3. 依赖顺序

### 3.1 内核 lifecycle 钩子（PageHost + kernel/runtime.ts）

- 在 `RuntimeDescriptor`（`kernel/runtime.ts`）上扩展**可选**的页面资源租约能力，例如：
  - `acquirePage?(pageId: string, reason: 'activate' | 'prewarm'): void`（页面需要运行时资源时调用）
  - `releasePage?(pageId: string, reason: 'explicit-close' | 'evict' | 'unmount'): void`（页面资源应释放时调用）
- PageHost 在以下时机按 `descriptor.runtimes` 派发：
  - 页面成为 active 且首次进入 → `acquirePage(pageId, 'activate')`；
  - `preload:'idle'` 的页面被预热且确需 runtime resource → `acquirePage(pageId, 'prewarm')`；
  - 页面从 `mounted` 被 LRU 淘汰 → `releasePage(pageId, 'evict')`；
  - `keepAlive:'none'` 页面离位卸载 → `releasePage(pageId, 'unmount')`。
- 普通 tab/page 切换不等同于 release。`keepAlive:{lru}` 的语义是“隐藏但缓存”，只有 LRU 淘汰或显式关闭才释放运行资源，避免把性能缓存退化成每次离位都销毁。
- 显式关闭（例如 applet runtime 页的 close）通过内核级 release intent 表达，例如 `requestPageRuntimeRelease(pageId, 'explicit-close')`，由 kernel 转发到 owner runtime；页面仍不直接调用 `AppletManager` 或 store unload。
- 钩子必须**幂等**且对未实现 `acquire/release` 的 runtime 是 no-op（保持向后兼容，静态页无感）。
- `acquirePage/releasePage` 只表达意图，不做重活；重活仍在 runtime 内异步收口（沿用 registry 的 sequence / in-flight 去重风格）。

### 3.2 applets runtime 成为 applet 会话唯一 owner

- 在 `apps/desktop/src/runtimes/appletsRuntime.ts` 实现 `acquire/release`：
  - `acquirePage(pageId, reason)`：解析 `applet:<id>`，收口调用 store 的 `loadApplet`（含 materialize station bundle、in-flight 去重、markAppletActive）。
  - `releasePage(pageId, reason)`：解析 `applet:<id>`，收口调用 store 的 `unloadApplet`（卸载 + 刷新投影）。
- runtime 内部维护 pageId → session 的引用，作为"该会话是否应当存活"的**单一真源**，替代页面凭 status 自行判断。

### 3.3 页面 / 容器改造为纯意图表达

- `AppletRuntimePage.tsx`：删除自动 prepare `useEffect` 的首次加载职责；页面只渲染 preparing / error 视图，加载由内核 `acquirePage` 驱动。`handleClose` 只表达显式 close intent + 导航，不直接 unload；真正释放由内核转发给 applets runtime 执行。
- `LynxContainer.tsx`：cleanup 不再直接 `AppletManager.unloadApplet`；容器只负责渲染 host element，会话生命周期归 runtime。
- `store/applets.ts`：`loadApplet` / `unloadApplet` 保留为 runtime 的执行体，不再被页面 / 容器直接调用。

## 4. 交付物

- `RuntimeDescriptor` 扩展的可选 `acquirePage/releasePage` 契约（附 reason、幂等 / no-op 语义说明）。
- PageHost 中"页面需要资源 → acquirePage、显式关闭 / 淘汰 / 卸载 → releasePage"的通用派发逻辑。
- applets runtime 作为 applet 会话唯一 owner 的实现（引用计数 + store 收口）。
- 页面 / 容器去除散写 load/unload 后的纯渲染实现。
- `runtime-projections.md §6` 同步补充新钩子的契约描述（§6 扩展，非重定义）。

## 5. 验收标准

- 关闭 applet 后不再被隐藏 keep-alive 页自动重载（P1-1 消除）。
- applet 页被 LRU 淘汰时其会话被 owner runtime 主动释放，运行态投影不再短暂陈旧（P1-2 消除）。
- 页面与容器不再直接调用 `AppletManager` / store 的 load/unload；会话生命周期只由 applets runtime 表达。
- 新增其它动态运行页时，只需声明 `runtimes` 并让 owner runtime 实现 `acquirePage/releasePage`，无需在页面 effect 里散写加载逻辑。
- `cd apps/desktop && pnpm run check` 通过。

## 6. 落地状态

- 2026-07-01：已落地 `RuntimeDescriptor.acquirePage/releasePage` 可选契约与 registry 派发函数。
- 2026-07-01：已落地 `PageHost` 的 `activate` / `prewarm` / `evict` / `unmount` 派发，以及显式 `explicit-close` release intent。
- 2026-07-01：已迁移 `appletsRuntime` 为 applet session 唯一 owner；`AppletRuntimePage` 与 `LynxContainer` 不再直接 load/unload applet。
- 2026-07-01：已同步 `runtime-projections.md §6/§7` 与 `frontend-component-tree-registry.md §5` 证据。
- 2026-07-01：已加固 applet 切换 / 关闭回主页的点击帧体验：launcher 在已有数据时 refresh 不再整页 Spin；`explicit-close` 释放延迟到导航帧之后执行，避免回主页唤醒被 unload/reconcile 抢占。
