# Desktop 性能优化 Phase 1 — 整合执行计划

## Context

P0c-3 已关闭（PR #47/#48 merged），修复了 120ms setTimeout 根因，P95 全达标。但系统在极端场景下仍有结构性性能债务：消息列表无虚拟滚动、首屏加载 13MB+ JS 无 code split、内核调度器未接入生产路径。本计划整合 Phase 1 kernel 调度 + 新确认的资源加载问题，分 4 个可独立合并的 Phase 交付。

**已排除（经验证不存在）：**
- SSE 指数退避 — Rust 侧已实现（500ms init, 2x, max 30s）
- RuntimeProjection 超时 — boot.ts 已实现 5s timeout + degraded
- Applet freeze — SurfaceManager.ts 已实现
- 请求 dedup — socialChat.ts 等已有

---

## 交付概览

| Phase | 内容 | 用户影响 | 预估 |
|---|---|---|---|
| **A** | 消息列表虚拟滚动 + 图片 lazy | 长对话卡顿消除 | 4 天 |
| **B** | 页面 code split + Markdown 真 lazy | 首屏 TTI 降 800ms+ | 3 天 |
| **C** | Kernel 调度生产接入 (1a/1b/1c/1d) | click-frame 合规 + hidden 重渲染消除 | 5 天 |
| **D** | Red-line CI Gate | 防回归 | 2 天 |

执行顺序：A 和 B 并行 → C → D

---

## Phase A — 虚拟滚动 + 图片 lazy load

### A1: 消息列表虚拟滚动 (L)

添加 `@tanstack/react-virtual` (~8KB)，改造：
- `src/components/chat/message/ChatMessageTimeline.tsx` — `.map()` 改为虚拟行
- `src/components/chat/ChatMessageArea.tsx` — scrollContainerRef 接入 virtualizer

关键设计：
- `measureElement` ref 回调处理动态行高（附件/回复/markdown）
- startIndex 接近 0 时触发 `loadOlderMessages`
- `scrollToMessageUlid` 通过 `virtualizer.scrollToIndex` 实现
- DateSeparator 作为虚拟列表 item，非独立 Fragment

### A2: 图片 lazy load (S)

- `src/components/chat/AttachmentItem.tsx` — `<img>` 添加 `loading="lazy"`
- Chromium (WKWebView) 原生支持，无需 polyfill

### 验证
- 500 条消息 mount < 50ms（只渲染 ~20 条 DOM）
- scroll FPS P95 >= 55
- 视口外图片不发起请求

---

## Phase B — 代码分割 + Markdown 真 lazy

### B1: 页面级 code split (M)

- `src/components/PageRouter.tsx` — 3 个 static import 改 `React.lazy()`
- `src/kernel/PageHost.tsx` — renderFactory 包裹 `<Suspense>`
- 各 PageDescriptor factory 改为 dynamic import

### B2: Markdown 真 lazy (M)

- `src/components/LazyMarkdown.tsx` — 改为真正的 React.lazy:
  ```typescript
  const MarkdownImpl = lazy(() =>
    import('@lobehub/ui').then(m => ({ default: m.Markdown }))
  );
  ```
- vite.config.ts manualChunks 保留（chunk 已分好，lazy 触发即可）

### 验证
- pnpm run build 主 chunk 减少 >= 10MB
- 非 Markdown 页面不加载 viz-markdown/syntax-markdown chunk
- 页面切换无白屏（Suspense fallback < 200ms）

---

## Phase C — Kernel 调度生产接入

### C1: Scheduler lane 接入 (M)

- `src/runtimes/*.ts` — runtime bootstrap 后台工作走 `scheduler.background`
- `src/services/*.ts` — 非关键初始化走 `scheduler.afterFirstPaint`
- `src/kernel/boot.ts` — 移除 legacy `scheduleIdle` bridge

### C2: InvokeThrottler 真实 deferral (M)

- `src/kernel/invokeThrottler.ts` 第 84-88 行 — warn-only 改为:
  ```typescript
  scheduler.afterFirstPaint(() => executeFn().then(resolve, reject));
  return { deferred: true, promise: deferred };
  ```

### C3: PageHost hidden render guard (S)

- 确保所有 chat 组件使用 `useActiveSocialChatStore`（已有 usePageActiveStoreSelector）
- 拆分 ChatMessageArea 的巨型 selector 为 3-4 个细粒度 selector
- 验证 hidden page 不触发 react.commit

### C4: StoreFanoutGuard warn 激活 (M)

- `src/store/createDesktopStore.ts` — `recordStoreUpdate` 后加 fanout > 3 warn
- 保持 warn-only 收集基线，Phase D CI gate 做回归检测

### 架构决策接受
D-07, D-08, D-10, D-11, D-12, D-14 从 proposed → accepted

### 验证
- invokeThrottler.test.ts 新增 deferral 断言
- hidden page store dispatch 不触发 react.commit
- interaction 期间非 allowlist invoke 事件 `deferred: true`

---

## Phase D — Red-line CI Gate

- `.github/workflows/pr-check.yml` — 新增 `perf-gate` job
- `tooling/scripts/desktop-performance-gate.sh` — 封装 E2E sampler + P95 判定
- 触发条件：PR 变更 `apps/desktop/src/`
- 运行 browser-gateway 模式 E2E stress tests, N>=30 post-warmup
- P95 不满足 INV-1~INV-6 则 block merge

### 验证
- 故意引入阻塞的测试 PR 被 gate 拦截
- 正常 PR 无 false positive
- Gate 执行 < 3 分钟

---

## 关键文件清单

- `apps/desktop/src/components/chat/message/ChatMessageTimeline.tsx`
- `apps/desktop/src/components/chat/ChatMessageArea.tsx`
- `apps/desktop/src/components/chat/AttachmentItem.tsx`
- `apps/desktop/src/components/LazyMarkdown.tsx`
- `apps/desktop/src/components/PageRouter.tsx`
- `apps/desktop/src/kernel/PageHost.tsx`
- `apps/desktop/src/kernel/invokeThrottler.ts`
- `apps/desktop/src/kernel/scheduler.ts`
- `apps/desktop/src/kernel/boot.ts`
- `apps/desktop/src/store/createDesktopStore.ts`
- `apps/desktop/vite.config.ts`
- `apps/desktop/package.json`
- `docs/architecture/frontend-runtime/decisions.md`
