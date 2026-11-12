# TW-D6 阶段验收说明（临时文档）

> 阶段：TW-D6 BrowserSession —— 真实 Chrome(CDP) worker / observe-act / 人工接管租约 / 过期引用 / 截图 / 诚实生命周期
> 计划：TW-20261102-1102，journeyId tw-j06-browser-takeover
> 本文件为阶段临时验收指引；正式结论以 `tw-d6-journey.json` 与提交记录为准。

## 本阶段交付内容

1. **资源合同（proto-first）**
   - `model/domain/agent/browser_session.proto`：BrowserSessionStatus(ACTIVE/CLOSED/UNKNOWN)、BrowserControlLease(AGENT/HUMAN)、BrowserTab(generation/url/title)，以及 Create/Update/List/Reconcile/Remove。
   - Station 只存会话元数据（状态、租约、tabs、engine）；页面内容、凭据与浏览数据永不出设备。
2. **设备持有的 Rust worker（src-tauri）**
   - chromiumoxide 0.9 驱动设备上真实 Google Chrome（CDP），非内嵌 webview、非 HTML artifact reader。
   - registry/host_info/create_session/open_tab/close_tab/list_tabs/navigate/history/snapshot/click/fill/submit/screenshot/takeover/release/inspect/remove。
   - snapshot 注入 `data-pt-bref`，元素引用为 `g<generation>-e<idx>`；代际不符返回 `BROWSER_SNAPSHOT_REF_STALE`，agent 必须重新 observe。
   - 租约为 HUMAN 时拒绝一切 agent 动作（`BROWSER_HUMAN_TAKEOVER_HELD`）；release 后 agent 才能重新 observe。
   - ElementInfo 携带 x/y/width/height；SnapshotResult 携带 viewport(screenX/Y、outer/inner) 供物理坐标换算。Rust 单测覆盖引用解析与动作 JS 不插值页面内容。
3. **Station 持久化（Go）**
   - `agent_browser_sessions` 表（tabs_json/lease/engine/status）；Create 以 worker 生成的 `brows-<ULID>` 为全局资源 id，幂等落库（重试不重建、不杀进程）。
   - Reconcile：该设备 worker 不能证明存活的行降级 UNKNOWN；Remove 物理删除。
4. **Desktop UI**
   - BrowserDock + 面板：启动会话、observe、fill/click/submit、screenshot、takeover/release、close tab、end session；元素行携带坐标，viewport 写 `data-viewport`。
   - Store 以真实设备 host 探测为开关（host 不可用即 fail-closed），merge 以 worker/Station 事实为准。
   - 全部用户可见文案进 `packages/locales`（en/zh-CN chat namespace，`chat.browser.*` 21 keys）。

## 本阶段修复的关键缺陷（复测闭环发现）

1. **Remove 代理线序不一致**：Station 代理 `agent_browser_session_remove` 误用 worker 的 camelCase `BrowserSessionInput`，而 TS 侧发送 snake_case `{session_id}`，serde 反序列化后 id 为空，Station 永远删不到行（journey 末尾 `count=1`）。修复：为 Station 代理新增专用 snake_case 入参 `AgentBrowserSessionInput`，与本地 worker 命令的 camelCase 合同彻底分离。
2. **验收证据路径依赖调用 cwd**：spec 用 `path.resolve('tooling/...')`，在 `apps/desktop` 下执行时证据误写到 `apps/desktop/tooling/...`。修复：以 ESM `import.meta.url` 锚定 spec 目录，恒定写入仓库根 `tooling/acceptance/reports/task-workbench/`。
3. **Dock 开关在同一 app 进程跨重跑残留**：面板 open 是全局 store 状态，上一轮结束时仍打开，下一轮盲目点 toggle 反而把面板关闭，start-form 不出现。修复：spec 改为按 `[data-pt-browser-panel]` 是否存在幂等开面板，并在开头清空该 journey 独占 DB 的残留行。

## 如何验收

### A. 全自动 Native Journey（最终判据）

```bash
cd apps/desktop
PT_PLAYWRIGHT_SOCKET=/tmp/tw-d1.sock \
PT_STATION_URL=http://127.0.0.1:18092 \
PT_EVIDENCE_COMMIT=$(git rev-parse HEAD) \
pnpm exec playwright test --config e2e/playwright.config.ts \
  e2e/tests/tw-d6-journeys.spec.ts --project=performance --reporter=line
```

journey 覆盖：cell 内起真实本地站点（搜索表单 → 结果页 state 控件）→ agent observe/fill/submit 读到真实页面文本 →
human takeover（agent observe 按钮被禁用）→ xdotool 在真实可见窗口物理输入勾选并 save → release →
旧引用过期，agent 重新 observe 得到 `saved:human-<marker>:checked` → PNG 截图字节校验 →
Postgres 事实（status=active、lease=agent、engine 非空、tabs_json 非空、绑定真实 conversation）→
end session 后 Chrome 进程与 Station 行同时归零。
通过后证据写入：`tooling/acceptance/reports/task-workbench/tw-d6-journey.json`（绑定当次 HEAD）。

### B. 聚焦静态/单测检查

```bash
# Station
cd apps/station && go test ./app/subserver/agent/...

# Rust worker（构建容器内）
cargo test browser

# Desktop
cd apps/desktop && pnpm run check
```

## Non-claims

- 浏览器是设备侧持有的独立真实 CDP host，不与 artifact/网页读取通道复用；host 二进制不可用时能力关闭。
- 不实现跨 app/系统重启存活的持久浏览器 daemon；worker 换代后无证明的会话显示 unknown，可清理或重启。
- Station 不保存页面正文、截图字节与浏览数据；正文仅在设备侧快照与渲染进程内使用。
- 过期引用拒绝的服务端合同由 Rust 单测保证；journey 内对 stale-ref 的直测走 UI-only 兜底（eval world 中 `window.__TAURI__` 不可用），不据此声称端到端验证了模型侧引用失效。
