# Desktop Global Lag Diagnosis

> **Status**: diagnostic evidence
> **Date**: 2026-07-06
> **Scope**: Desktop Shell / PageHost / section tabs / overlay / store projection / Tauri bridge
> **Environment**: `<repo-root>`, `profile=one`, Vite browser baseline at `http://localhost:3211/`

---

## 1. Question

Desktop 出现全局卡顿：

- 一级菜单切换卡。
- 二级功能 tab 切换卡。
- 只要是 tab 都卡。
- 右键选项卡/菜单延迟显示。

本报告先诊断，不做补丁式修复。

---

## 2. Evidence Summary

结论分级：

| 结论 | 证据等级 | 说明 |
|---|---|---|
| 不是只能归因给 Tauri | proven | Vite browser 基线也捕获到 `>50ms` long task、hidden render 和页面/section 切换 fanout。 |
| 当前主要共因在 Web 前端运行时 | proven | PageHost/SectionHost 保活隐藏树、ReadyView context、宽 store 订阅、render 阶段派生投影在同一 UI 主线程竞争。 |
| Tauri WebView / Rust bridge 会放大部分启动与登录态切换成本 | partially proven | 真实 `make desktop` / `profile=one` app 日志显示 WebView 前端 runtime bootstrap 期间多个 Tauri command 耗时 `600-760ms`，session revoked 后登录态回退链路也出现 `300-500ms` 批量命令。 |
| Tauri 交互点击链路仍未完全隔离 | incomplete | macOS 当前执行上下文没有 Assistive Access，`osascript` 无法点击真实窗口；`screencapture` 也无法创建 display 图像。一级导航/二级 tab/右键的 Tauri WebView 点击 trace 仍需补专用自动化入口。 |
| 右键菜单不是原生 Tauri 菜单 | proven | 会话列表右键来自 React `Dropdown trigger={['contextMenu']}`。 |
| Production build 本身存在启动/分包风险 | proven | `pnpm --filter @peers-touch/app-desktop build` 成功，但生成多个 MB 级 chunk，并报告多个动态 import 因静态 import 无法拆包；`vite preview` 首屏在 `lobehub-ui` chunk 184ms 抛错，当前不能作为 prod E2E 基线。 |
| React commit / store fanout 仍缺运行时 profiler | proven gap | 当前 profiler 覆盖 longtask、route visible、surface render、hidden render；代码中没有 React Profiler / commit sampler，裸 Zustand store 订阅分布广。 |
| 无 gateway / 断连模式不能进入轻 shell | proven | Vite dev + fake gateway `:3999` 在 `initI18n` 阶段 `Failed to fetch`，直接进入 boot failed screen，无法采 ready-shell tab 矩阵。 |

### 2.1 Claim Boundary

| Question | Allowed claim | Forbidden claim | Why |
|---|---|---|---|
| 这是 Tauri 的问题吗？ | 不是纯 Tauri 问题；browser/gateway ready-shell 已复现 hidden render、longtask 和 primary tab 超红线；Tauri app startup/runtime command burst 会放大卡顿窗口。 | “已经排除 Tauri”或“所有卡顿都不是 Tauri”。 | Tauri true-click trace 仍被 macOS Assistive Access/screenshot 权限阻塞，缺 click-frame invoke correlation。 |
| 为什么一级菜单、二级 tab、右键会同时卡？ | 三类交互共享 renderer 主线程；Shell context broadcast、PageHost/SectionHost hidden tree、Zustand projection derive、React/AntD overlay 都会竞争同一帧预算。 | “某一个页面/组件慢导致全部现象”。 | 证据覆盖 shell、page lifetime、section lifetime、chat overlay、store projection，多处是框架级策略。 |
| 右键菜单是不是 Tauri 原生菜单慢？ | 不是；当前右键菜单来自 React/AntD Dropdown，browser DOM 样本轻数据下 `16.7ms` 可见。 | “右键菜单慢就是 macOS/Tauri native menu 慢”。 | `main.tsx` 禁用 native context menu，`ChatSessionList` 使用 `Dropdown trigger={['contextMenu']}`。 |
| 打点报告应该去哪里？ | Station 必须成为 telemetry ingestion、入库、聚合、查询和追踪的主路径；`tooling/acceptance/reports` 只能是开发/CI 镜像。 | “用户/生产分析依赖源码目录里的 tooling 报告”。 | 真实用户没有源码；跨模块追踪、上报分析和历史查询必须由 Station 管理。 |
| 当前是否可以开始修复？ | 可以进入执行计划确认；确认后先做 Phase 0 Evidence Gate，再做框架修复。 | “直接优化 PageHost/ChatSessionList/Dropdown”。 | React commit、store fanout、overlay visible、invoke interaction correlation 未实现，直接修会退回补丁式治理。 |

---

## 3. Runtime Samples

### 3.1 Login / ready shell

使用 `window.__PT_ACCEPTANCE__.loginWithPassword({ account: 'b@p.t', password: '1' })` 登录。

采样结果：

- 登录耗时：约 `2480ms`。
- ready 后立即发生 `pages:prewarm`，持续约 `237ms`。
- `chat`、`agent`、`settings`、`applets`、`moments` 被预热。
- 多个 hidden surface render 出现：`chat`、`agent`、`settings`、`applets`、`moments`。
- 捕获 long task：`100ms`、`59ms` 等。

关键事件摘录：

```text
pages:prewarm start
surface.hidden.render chat
surface.hidden.render agent
surface.hidden.render settings
surface.hidden.render applets
pages:prewarm end durationMs=237
longtask.detected durationMs=59
```

### 3.2 一级导航

在 Vite browser 中切换主导航：

| 场景 | route.visible | 伴随现象 |
|---|---:|---|
| `#/chat` | `6.1ms` | `search` hidden render、`chat` render 多次 |
| `#/agent` | `0.8ms` | `chat` hidden render、`agent` render 多次 |
| `#/notes` | `26.2ms` | legacy fallback mount |
| `#/memory` | `37ms` | 捕获 `55ms` long task |

route visible 本身不总是慢，但同一点击窗口里出现 hidden render、legacy mount 和 long task，解释了体感“粘滞”：页面可见标记快，不代表主线程已空闲。

### 3.3 二级 Settings tab

Settings group tab 切换采样：

| 场景 | route.visible | 伴随现象 |
|---|---:|---|
| General -> AI | `5.4ms` | `providers` section render，`account` section hidden render |
| AI -> Channels | `22.1ms` | `providers` section hidden render，`channels` section render |
| Channels -> Applets | `1.8ms` | `channels` section hidden render，`applets` section render |

二级 tab 同样存在“新 section render + 旧 section hidden render”的共因。

### 3.4 右键菜单

在 chat 会话行触发 `contextmenu`：

- 当前轻数据下菜单可显示。
- 菜单内容：`Pin to top / Mute / Hide conversation / Delete`。
- DOM 中出现 Ant Dropdown。
- 未捕获 long task，但实现依赖 React 主线程；当主线程被一级/二级切换、store fanout 或投影派生占用时，右键菜单自然延迟。

### 3.5 Tauri WebView startup / bridge 对照

启动命令：

```bash
VITE_ACCEPTANCE_HARNESS=1 RESTART=1 make desktop
```

实际 profile：

- `PT_DEV_PROFILE=one`
- app 端使用 `profile=one-app`
- Vite: `:3210`
- Rust gateway: `:3030`
- Station: `http://10.37.246.80:18080`

真实 Tauri app 日志给出的 WebView 前端事件：

| 事件 | 耗时 |
|---|---:|
| `preferences_get` | `680ms` |
| `mcp_list_servers` | `684ms` |
| `skills_list` | `761ms` fail / `NOT_FOUND` |
| `tools_list` | `761ms` |
| `agent-capability:bootstrap` | `762ms` |
| `group_chat_unread_count` | `760ms` |
| `applets_product_window_launch_context` | `631-643ms` |
| `presence_notify` | `643ms` |
| `context_action_dispatch` | `642-653ms` |

随后又出现 session revoked / kicked，WebView 回到登录态并触发启动链路：

| 事件 | 耗时 |
|---|---:|
| `notification_unread_counts` unauthorized | `106ms` |
| `account_list_restorable` cold | `211ms` / `495ms` |
| `context_action_dispatch` cold | `459ms` |
| `oauth2_list_providers` cold | `470ms` |
| `oauth2_list_connections` cold | `490ms` |
| 多个 `avatar_resolve_local` | `332-334ms` |
| `station_list` | `322-332ms` |
| 同链路热态 `context_action_dispatch` | `3ms` |
| 同链路热态 `oauth2_list_providers` | `3ms` |
| 同链路热态 `account_list_restorable` | `35ms` |

HTTP gateway 直连对照：

| Command | `curl` total |
|---|---:|
| `auth_restore_session` | `106ms` |
| `notification_unread_counts` | `104ms` |
| `federation_health` | `102ms` |
| `auth_login b@p.t` | `413ms` |

解释：

- 直连 gateway 的耗时低于 WebView 前端日志中的部分 cold command，说明 Tauri/WebView/Rust/Station 组合链路存在额外冷启动、并发排队或前端调度成本。
- 这不推翻 Web 前端运行时共因；它说明真实 app 中 bridge/runtime 命令会进一步放大启动、登录态切换、后台 runtime bootstrap 的卡顿窗口。
- 当前没有真实窗口点击 trace，不能证明一级导航/二级 tab/右键的每一次卡顿都包含 Tauri invoke。

### 3.6 Tauri 交互自动化缺口

尝试路径：

- `osascript` 读取 `peers-touch-desktop` 窗口：失败，当前执行上下文没有 Assistive Access。
- `osascript` 点击 UI 元素：失败，同上。
- `screencapture -x`: 失败，无法从当前 display 创建图像。

结论：

- 真实 Tauri WebView 自动点击采样当前受宿主权限限制。
- 不能用项目里的 Chrome + gateway bridge DOM gate 冒充 Tauri WebView 证据；那些 gate 能证明 Desktop renderer + HTTP gateway，但不证明 macOS WebView 交互链路。

### 3.6.1 Current Tauri app preflight rerun

为避免 Desktop app dev path 触发 `predev -> build:applets` 卡住，本轮使用无文件修改的诊断启动方式：

1. 手动启动 Vite：

   ```bash
   VITE_ACCEPTANCE_HARNESS=1 VITE_GATEWAY_PORT=3030 \
     pnpm --dir apps/desktop exec vite --host 127.0.0.1 --port 3210
   ```

2. 使用 Tauri CLI runtime config 覆盖 `beforeDevCommand`，避免再次触发 `pnpm dev -> predev -> build:applets`：

   ```bash
   pnpm --dir apps/desktop exec tauri dev \
     --config '{"build":{"devUrl":"http://127.0.0.1:3210","beforeDevCommand":"true"}}'
   ```

Preflight result:

| Step | Result | Evidence |
|---|---|---|
| Vite `3210` | PASS | `VITE v7.3.1 ready in 131ms`, `127.0.0.1:3210` listening |
| Tauri app process | PASS | `peers-touch-desktop` appears in foreground process list |
| Gateway `3030` | PASS | `peers-touch-desktop` listening on `127.0.0.1:3030` |
| `auth_restore_session` direct gateway | PASS | `HTTP 200`, restored `b@p.t`, total `0.096291s` |
| System Events process list | PASS | process list includes `peers-touch-desktop` |
| System Events window/control access | BLOCKED | `osascript is not allowed assistive access. (-25211)` |
| Screenshot | BLOCKED | `screencapture -x` failed with `could not create image from display` |

Tauri app startup command burst in this run:

| Command | Duration |
|---|---:|
| `avatar_resolve_local` | `2888ms` |
| `notification_unread_counts` | `1189ms` |
| `applets_product_window_launch_context` | `1183ms` |
| `group_chat_list_groups` | `1101ms` |
| `group_chat_get_settings` | `1074ms` |
| `friend_chat_list_sessions` | `1012ms` |
| `crypto_ratchet_telemetry_snapshot` | `988ms` |
| `group_chat_list_messages` | `978ms` |
| `context_action_dispatch` | `939ms` |
| `account_list` | `939ms` |
| `profile_get` | `935ms` |
| `settings_get` | `928-899ms` |
| `agents_list` | `927ms` |
| `chat_screenshot_shortcut_register` | `900ms` |

Interpretation:

- Tauri WebView/native app startup path is now proven runnable in this host when `beforeDevCommand` is overridden at runtime for diagnosis.
- True WebView click trace is still blocked by macOS Assistive Access/screenshot restrictions, not by app startup.
- Tauri app startup shows the same class of runtime/API burst as browser gateway startup, with even larger top durations (`2888ms` avatar local resolve).
- These are startup/runtime amplification signals; without `interactionId` they cannot be assigned to primary tab / secondary tab / context-menu click frames.

### 3.7 Production build / preview 对照

构建命令：

```bash
pnpm --filter @peers-touch/app-desktop build
```

结果：

- 构建成功。
- `13987` modules transformed。
- 构建耗时约 `13.44s`。
- Rollup 报告 circular chunk：
  - `antd -> lobehub-ui -> antd`
  - `lobehub-ui -> syntax-markdown -> markdown-core -> lobehub-ui`
- Vite 报告多个模块“动态 import 但也被静态 import”，因此不会被移动到独立 chunk：
  - `desktop_api.ts`
  - `@tauri-apps/api/event.js`
  - `useAppLifecycle.ts`
  - `store/socialChat.ts`

产物体积：

| Asset | decoded size | gzip/encoded |
|---|---:|---:|
| `syntax-markdown-*.js` | `9.56MB` | `1.67MB` |
| `lobehub-ui-*.js` | `2.69MB` | `616KB` |
| `viz-markdown-*.js` | `2.51MB` | `701KB` |
| `markdown-core-*.js` | `1.56MB` | `323KB` |
| `antd-*.js` | `1.43MB` | `442KB` |
| `index-*.js` | `1.34MB` | `371KB` |
| `dist/` total | `79MB` | n/a |

Production preview：

```bash
pnpm --dir apps/desktop preview --host 127.0.0.1 --port 3212
```

首屏结果：

- 页面显示 `Failed to start`。
- Console 在 `184ms` 抛：

```text
Uncaught TypeError: Cannot set properties of undefined (setting 'Activity')
at assets/lobehub-ui-*.js:2
```

资源加载样本：

| Resource | duration | encoded | decoded |
|---|---:|---:|---:|
| `index-*.js` | `47ms` | `371KB` | `1.34MB` |
| `lobehub-ui-*.js` | `76ms` | `616KB` | `2.69MB` |
| `syntax-markdown-*.js` | `167ms` | `1.67MB` | `9.56MB` |

解释：

- 当前 production browser preview 不是可用 E2E 基线；它在进入登录/ready shell 前已经 bundle runtime crash。
- 生产构建风险不是本次“tab 切换卡”的唯一根因，但它证明 Desktop 前端基础框架还有首屏分包/依赖初始化问题。
- 后续 production Tauri 对照必须先解决 preview/build runtime crash，或直接用 Tauri production bundle 采 WebView 日志。

### 3.8 Store / React profiler coverage

静态审计：

```bash
rg -n "use[A-Za-z0-9]+Store\(\)" apps/desktop/src/pages apps/desktop/src/components apps/desktop/src/hooks apps/desktop/src/kernel -S
```

发现裸 store 订阅分布在至少以下高影响组件：

- `ChatPage`
- `SocialChatPage`
- `ChatSessionList`
- `ChatMessageArea`
- `ChatDetailPanel`
- `ChatThreadPanel`
- `AgentSidebar`
- `AgentProfilePage`
- `SettingsPage`
- `SkillsTab`
- `MCPTab`
- `ProviderDetail`

render-time derive / sort 审计发现：

- `ChatSessionList` render 中调用 `getIMConversations()`。
- `ChatMessageArea` / `ChatDetailPanel` / `ChatThreadPanel` / `ChatContactsPanel` 也在 render 路径读取 `getIMConversations()`。
- `socialChat.ts` 中 conversation projection 仍执行 full `sort`。
- 多个页面/组件在 render/useMemo 路径执行 `Object.values` / `Object.entries` / `Array.from` / `sort`。

React commit profiler：

```bash
rg -n "React\.Profiler|<Profiler|__REACT_DEVTOOLS_GLOBAL_HOOK__" apps/desktop/src tooling -S
```

结果：

- 当前没有 React commit sampler。
- `apps/desktop/src/kernel/frontendRuntimeProfiler.ts` 只记录 `boot.phase`、`route.requested`、`route.visible`、`surface.render`、`surface.hidden.render`、runtime events 和 `longtask.detected`。
- 当前没有 React `Profiler` boundary，也没有 `react.commit` event。
- Desktop stores 使用裸 `zustand.create(...)`；未发现统一 store middleware、`subscribeWithSelector` 或 fanout sampler。
- 因此本报告只能证明 long task / hidden render / route visible / static store fanout，不能精确证明每次点击的 commit count、commit duration、store listener fanout。

这不是推翻结论，而是把 Phase 0 的采样手段缺口钉死：下一阶段必须先补 commit/store fanout profiler，否则无法把框架红线做成 gate。

### 3.9 Offline / no-gateway 对照

启动命令：

```bash
VITE_GATEWAY_PORT=3999 VITE_ACCEPTANCE_HARNESS=1 pnpm --dir apps/desktop dev --host 127.0.0.1 --port 3213
```

前提：

- `:3999` 无进程监听。
- 不启动 Rust gateway。
- 不启动 Station。

结果：

- Vite dev server 正常启动。
- 前端 module runtime 正常加载到 `Module runtime OK, loading app…`。
- `main.tsx` 进入 bootstrap 后，在 `initI18n` 阶段触发 gateway fetch。
- 因 `127.0.0.1:3999` refused，bootstrap 失败并显示 boot failed screen。

Console 摘录：

```text
[pt-boot] [200ms] status: Module runtime OK, loading app…
[pt-boot] [2188ms] status: Initializing…
[pt-boot] [2189ms] status: Loading language packs…
net::ERR_CONNECTION_REFUSED http://127.0.0.1:3999/
showBootError: Bootstrap failed: Failed to fetch
```

采样指标：

| Metric | Value |
|---|---:|
| navigation duration | `2272ms` |
| DOMContentLoaded | `2268ms` |
| longtask.detected | `198ms` |
| gateway base | `http://127.0.0.1:3999` |

资源加载侧信号：

- `chunk-I2AFNFQ3.js`: decoded `6.63MB`, duration `718ms`
- `chunk-T3ZJVBTH.js`: decoded `3.73MB`, duration `471ms`
- `desktop_api.ts`: decoded `411KB`, duration `567ms`
- `socialChat.ts`: decoded `303KB`, duration `226ms`
- `SkillsTab.tsx`: decoded `282KB`, duration `237ms`
- `AgentProfilePage.tsx`: decoded `351KB`, duration `690ms`

解释：

- 断连样本不能证明 ready shell 的 tab 切换成本，因为它根本进不了 ready shell。
- 它能证明当前 Desktop boot 对 Rust gateway 是 fail-hard：连 i18n/bootstrap 日志链路都依赖 gateway 成功。
- 如果要建立“断网/离线空壳”性能矩阵，Phase 0 必须先提供可进入 shell 的 offline fixture 或 fake gateway；否则只能测 boot failure，而不能测一级菜单、二级 tab、右键菜单。

### 3.10 Baseline matrix status

| Matrix | Status | Evidence |
|---|---|---|
| Vite browser + remote Station + dev | sampled | 一级导航、二级 Settings tab、右键菜单、longtask、hidden render |
| Tauri WebView + remote Station + dev | partial | 启动/bridge command burst 已采；真实窗口点击 trace 缺 Assistive Access |
| Production build | sampled | 构建成功，chunk graph/size risk 已记录 |
| Production browser preview | blocked by crash | `lobehub-ui` module evaluation crash |
| No gateway / offline dev | sampled failure | boot 在 `initI18n` 阶段 fail-hard，无法进入 ready shell |
| Repeat browser CDP baseline | blocked by gateway absence | `make desktop-web` exposed Vite `:3211` with `__PT_GATEWAY_BASE__=:3031`, but `:3031` had no listener; CDP page stayed on boot failed screen |
| Current browser preflight rerun | sampled diagnostic-only | 2026-07-06 11:35 `make desktop-web` brought up `3031/3211`, login succeeded, primary clicks sampled without Phase 0 correlation |
| Production Tauri | not sampled | 需要先解决 production bundle crash 或直接打包采 WebView 日志 |
| Offline ready shell | not available | 需要 fake gateway/offline fixture |

交互 × 运行时覆盖矩阵：

| Interaction | Vite dev browser + gateway | Tauri dev WebView | Production browser / bundle | Offline / no gateway |
|---|---|---|---|---|
| Cold boot | `sampled` | `partial`: startup/bridge logs only | `blocked`: preview crash before ready shell | `sampled failure`: boot failed at `initI18n` |
| Primary nav | `sampled`: route/longtask/hidden render | `blocked`: no true-window click automation | `blocked`: no ready shell | `blocked`: no ready shell |
| Secondary tab | `sampled`: Settings SectionHost | `blocked`: no true-window click automation | `blocked`: no ready shell | `blocked`: no ready shell |
| Context menu | `sampled`: visible under light data, no precise latency probe | `blocked`: no true-window click automation | `blocked`: no ready shell | `blocked`: no ready shell |
| Store fanout | `static only`: broad subscription/projection code path | `static only` | `static only` | `not applicable`: no ready shell |
| React commit | `missing sampler` | `missing sampler` | `missing sampler` | `not applicable`: no ready shell |

判定：

- 当前矩阵足以支撑“Web runtime 已存在框架级共因”和“不能把问题全归因给 Tauri”。
- 当前矩阵不足以支撑“真实 Tauri 点击链路已完全隔离”或“prod/offline ready-shell tab 性能已验证”。
- Phase 0 必须把这些 cell 变成机器可读状态，而不是人工表格。

---

### 3.11 Repeat browser baseline via Chrome CDP

为绕过 IDE integrated browser timeout，尝试使用系统 Chrome headless + CDP 直接驱动 browser baseline：

```bash
VITE_ACCEPTANCE_HARNESS=1 RESTART=1 make desktop-web
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new \
  --disable-gpu \
  --remote-debugging-port=9223 \
  --user-data-dir=/tmp/pt-desktop-perf-cdp \
  http://localhost:3211/
```

结果：

- Vite `:3211` ready。
- 页面中 `window.__PT_GATEWAY_BASE__ = "http://127.0.0.1:3031"`。
- `window.__PT_ACCEPTANCE__` 已存在。
- 页面停留在 boot failed screen。
- `window.__PT_ACCEPTANCE__.loginWithPassword({ account: 'b@p.t', password: '1' })` 抛 `AuthCommandException: Failed to fetch`。
- 直连 gateway 检查失败：

```bash
curl -H 'Content-Type: application/json' \
  -d '{"cmd":"auth_restore_session","args":{}}' \
  http://127.0.0.1:3031/

# curl: (7) Failed to connect to 127.0.0.1 port 3031
```

解释：

- CDP 自动化链路可用，但本轮 `desktop-web` baseline 的 Rust gateway readiness 不成立。
- 这不是新的 tab 性能样本，不能并入一级/二级/右键耗时统计。
- Phase 0 不能只检测 Vite ready；必须把 gateway readiness、acceptance login readiness、ready shell visibility 作为 baseline preflight。否则 E2E 会把 boot failed / gateway absent 混成前端性能问题。

脚本层归因：

- `tooling/scripts/dev-desktop-web.sh` 声明完整链路是 `station → desktop-rust (profile=desktop-web, gateway=:3031) → browser`。
- `tooling/scripts/_ensure-desktop-rust.sh` 的 `wait_for_gateway()` 在 gateway 未启动时只打印 warning，并 `return 0`：

```bash
echo "[WARN] HTTP Gateway did not start within ${max_wait}s (Rust may still be compiling)"
return 0
```

影响：

- `make desktop-web` 可以在 gateway 未监听时继续对外表现为“启动成功”。
- Browser bridge 已经把 `__PT_GATEWAY_BASE__` 指向 `:3031`，但任何 command 都会 `Failed to fetch`。
- 这会污染性能排查：采样工具可能采到 boot failed / auth failed，而不是 ready shell 的 tab/overlay 行为。
- 这属于 Phase 0 可测性缺陷，不是“一级 tab 卡顿”的根因，但会阻塞稳定复现和回归门禁。

### 3.12 Reusable `profile=one` preflight

当前可复用的 profile 配置来自 `.local/dev/profiles/one.env`：

| Runtime | Value |
|---|---|
| Station | `http://10.37.246.80:18080` |
| Station health | `http://10.37.246.80:18080/sub-oss/healthz` |
| Desktop app gateway | `3030` |
| Desktop app web | `3210` |
| Desktop browser gateway | `3031` |
| Desktop browser web | `3211` |

现有 acceptance 入口：

- `make acceptance-chat-desktop-dom`
  - 默认 `CHAT_DESKTOP_DOM_URL=http://127.0.0.1:3210/#/chat`
  - 默认 `CHAT_DESKTOP_DOM_GATEWAY_URL=http://127.0.0.1:3030`
- `make acceptance-chat-desktop-gateway`
  - 覆盖 gateway message flow，不覆盖 ready-shell 性能矩阵。

Desktop 性能采样前的最小 preflight 必须按顺序证明：

1. Station health 可访问：

   ```bash
   curl -fsS -m 5 http://10.37.246.80:18080/sub-oss/healthz
   ```

2. 目标 gateway 监听，并且 `auth_restore_session` 返回结构化 JSON：

   ```bash
   curl -fsS -H 'Content-Type: application/json' \
     -d '{"cmd":"auth_restore_session","args":{}}' \
     http://127.0.0.1:3031/
   ```

3. Browser/Tauri renderer 中存在 `window.__PT_ACCEPTANCE__`。
4. 使用 `docs/context/test-resources.md` 中账号登录成功：

   ```js
   await window.__PT_ACCEPTANCE__.loginWithPassword({ account: 'b@p.t', password: '1' })
   ```

5. ready shell DOM 可见，例如 PageHost 已暴露目标页锚点：

   ```js
   document.querySelector('[data-page="chat"]')
   ```

判定：

- 任一步失败时，只能记录为 `baseline preflight failure`。
- 不得输出 primary tab、secondary tab、context menu 性能结论。
- `window.__PT_ACCEPTANCE__` 存在不等于 ready-shell 可采样；必须同时满足 login success 和 `[data-page="chat"]` 可见。
- `make desktop-web` 当前因 `wait_for_gateway()` fail-open，不能单独作为 baseline ready 证据。

### 3.13 Current browser preflight rerun

时间：

```text
2026-07-06 11:35:52 +0800
```

启动命令：

```bash
set -a; source .local/dev/profiles/one.env; set +a
VITE_ACCEPTANCE_HARNESS=1 RESTART=1 make desktop-web
```

注意：该命令读取 `profile=one` 后触发了远端 `station-1` deploy/build，再启动本地 desktop-web stack。这说明 `profile=one` 的 browser baseline 不只是本地 Vite/gateway；它还受 Station deploy profile 状态影响。

Preflight 结果：

| Step | Result | Evidence |
|---|---|---|
| Station health | PASS | `HTTP 200`, `total=0.085781s`, `{"status":"ok"}` |
| Gateway `3031` before start | FAIL | `curl: (7) Failed to connect`; `lsof :3031` empty |
| Vite `3211` before start | FAIL | `lsof :3211` empty |
| Gateway `3031` after `make desktop-web` | PASS | `peers-touch-desktop` listening on `127.0.0.1:3031` |
| `auth_restore_session` round-trip | PASS as structured response | `HTTP 200`, `total=0.002707s`, `UNAUTHORIZED pin_required` |
| Vite `3211` after start | PASS with host caveat | `node` listening on `[::1]:3211`; `http://localhost:3211/` returns `HTTP 200`; `http://127.0.0.1:3211/` failed in this run |
| Renderer harness | PASS | `window.__PT_ACCEPTANCE__ === true`, `window.__PT_GATEWAY_BASE__ === "http://127.0.0.1:3031"` |
| Login | PASS | `loginWithPassword({ account: 'b@p.t', password: '1' })` returned `authenticated: true`, `actorId: "339538422404218883"`, duration `4579.5ms` |
| Ready shell | PASS | `[data-page="chat"]` visible after login |

Ready-shell bootstrap events observed in browser renderer:

- Initial account-gate bootstrap captured `longtask.detected` `175ms` and later another `160ms` long task.
- After login, `pages:prewarm` mounted `chat`, `agent`, `settings`, `applets`, `moments` and ended with `durationMs=334.5`.
- Hidden renders were observed for `settings`, `applets`, `moments` during/after prewarm.
- Runtime bootstrap after login included `federation` `175.9ms`, `agent-capability` `206.4ms`, `agent-topic` `11ms`.

Diagnostic primary-click samples:

| Interaction | click-to-visible | Events | Interpretation |
|---|---:|---|---|
| `chat -> agent` | `129.1ms` | `chat` hidden render, `agent` route.visible `1.9ms`, multiple chat/agent surface renders | Exceeds `<100ms` primary red line; route.visible is fast but click window includes extra render work |
| `agent -> settings` | `62.0ms` | `agent` hidden render, `settings` route.visible `1.1ms`, agent/settings surface renders | Under primary red line but still shows hidden render on active switch |
| `settings -> chat` | `64.7ms` | `settings` hidden render, `chat` route.visible `4.1ms`, chat/settings surface renders | Under primary red line but still shows hidden render on active switch |

This run strengthens the framework diagnosis:

- Current browser baseline can now pass Station/Gateway/Renderer/Login/Ready Shell preflight.
- Primary navigation still emits hidden renders on every sampled active switch.
- `chat -> agent` exceeded the `<100ms` primary tab budget even in browser mode.
- The samples remain `diagnostic-only`: no `interactionId`, no React commit sampler, no store fanout sampler, no overlay visible event, and no Tauri WebView true-click trace.

### 3.14 Current secondary-tab and context-menu samples

同一 `profile=one` browser baseline 下继续采样 Settings 二级 tab 和 chat 会话行右键菜单。

Preflight 状态：

- `auth_restore_session`: `HTTP 200`, `ok: true`, `status: restored`, total `0.091434s`。
- Vite: `http://localhost:3211/` `HTTP 200`, total `0.002444s`。
- 页面直接进入已登录 ready shell。

Settings 二级 tab diagnostic-only 样本：

| Interaction | click-to-selected | Events | Interpretation |
|---|---:|---|---|
| `General -> AI` | `38.5ms` | `account` hidden render, `providers` surface render, group/section route visible | Under `<80ms`, but old section still renders hidden |
| `AI -> Channels` | `34.8ms` | `providers` hidden render, `channels` surface render | Under `<80ms`, but old section still renders hidden |
| `Channels -> Applets` | `26.1ms` | `channels` hidden render, `applets` surface render | Under `<80ms`, but old section still renders hidden |
| `Applets -> General` | `29.5ms` | `applets` hidden render, `account` surface render | Under `<80ms`, but old section still renders hidden |

Right-click context-menu diagnostic-only sample:

| Interaction | contextmenu-to-visible | Events | Interpretation |
|---|---:|---|---|
| chat conversation row right click | `16.7ms` | Ant Dropdown menu visible with `Pin to top / Mute / Hide conversation / Delete`; no runtime events emitted | Under `<50ms` in light data, but there is still no built-in `overlay.visible` event or interaction correlation |

Interpretation:

- 二级 tab 不一定每次都超预算，但每次都唤醒旧 section 的 hidden render，强化 `DL-FD-04`：SectionHost 生命周期策略是框架问题。
- 右键菜单本次未超预算，说明“右键菜单慢”不是原生 Tauri 菜单的直接问题；当前实现是 React/AntD Dropdown。
- 右键菜单没有 emit runtime event，必须在 Phase 0 增加 `contextmenu.intent` / `overlay.visible`，否则不能稳定定位用户报告的慢样本发生在哪个主线程队列段。

### 3.15 Health-check-only browser startup API burst

为避免 `make desktop-web` 先触发远端 Station deploy，本轮直接调用 `tooling/scripts/dev-desktop-web.sh` 并显式传入远端 Station health check 参数：

```bash
set -a; source .local/dev/profiles/one.env; set +a
export PEERS_STATION_MODE=remote
export PEERS_STATION_URL="$PT_STATION_URL"
export STATION_HEALTHCHECK_URL="$PT_STATION_HEALTH_URL"
export PT_PROFILE=one-web
export GATEWAY_PORT="$PT_DESKTOP_WEB_GATEWAY_PORT"
export WEB_PORT="$PT_DESKTOP_WEB_WEB_PORT"
VITE_ACCEPTANCE_HARNESS=1 RESTART=1 bash tooling/scripts/dev-desktop-web.sh
```

结果：

- Remote Station 只做 health check：`remote station is ready: http://10.37.246.80:18080/sub-oss/healthz`。
- 未触发 `station-1` deploy。
- Vite `http://localhost:3211/`: `HTTP 200`, total `0.002466s`。
- Gateway direct calls:
  - `auth_restore_session`: `HTTP 200`, restored `b@p.t`, total `0.090429s`。
  - `federation_health`: `HTTP 200`, total `0.084759s`。
  - `station_list`: `HTTP 200`, total `0.000747s`。

同一次 browser startup / ready-shell runtime 日志中，frontend API command burst 出现以下慢命令：

| Command | Duration |
|---|---:|
| `avatar_resolve_local` | `2784ms` |
| `notification_unread_counts` | `1150ms` |
| `applets_product_window_launch_context` | `1143ms` |
| `group_chat_list_groups` | `1063ms` |
| `account_list` | `1058ms` |
| `account_get_active` | `1058ms` |
| `context_action_dispatch` | `1057ms` |
| `group_chat_get_settings` | `1042ms` |
| `group_chat_list_messages` | `1036ms` |
| `friend_chat_list_sessions` | `977ms` |
| `crypto_ratchet_telemetry_snapshot` | `945ms` |
| `realtime_stream_start` | `819ms` |
| `search_sources` | `815ms` |
| `profile_get` | `802ms` |
| `provider_list_available_models` | `779ms` |

Interpretation:

- 这些不是单次 tab click-frame 的直接证据，因为当前缺少 interaction correlation。
- 但它们证明 browser/gateway baseline 的 ready/runtime 阶段存在大量 `800ms+` command burst，足以和 React render、hidden tree、store projection 竞争同一 renderer 主线程调度窗口。
- 直连 gateway 的 `auth_restore_session` / `federation_health` 约 `85-90ms`，而 frontend startup burst 中多条命令达到 `800-1150ms`，说明放大项不只是远端 Station RTT，还包括启动期并发、runtime bootstrap、前端调度和本地 gateway command 队列。
- Phase 0 必须给 invoke/API event 加 `interactionId`，否则无法判断这些 command 是否落入用户点击帧，只能归为 startup/runtime amplification。

## 4. Code Findings

### 4.0 Framework Defect Register

| ID | Severity | Blocks | Defect | Evidence | Impact surface | Why framework-level |
|---|---|---|---|---|---|---|
| `DL-FD-01` | P1 | Phase 1 | Shell context value broadcasts route changes through a fresh object | `ReadyView.tsx:69-93` creates `<PageContextProvider value={{ router, navigation, appletPins }}>` around the whole ready shell | Primary nav, PageHost, AppSideNav, legacy fallback | Route change is a shell event, but the provider value couples router/navigation/pins and can wake every consumer, not one page |
| `DL-FD-02` | P0 | Phase 2 | PageHost keeps hidden pages mounted and records hidden renders | `PageHost.tsx:128-167` idle prewarms pages; `PageHost.tsx:216-240` renders all mounted page frames; `PageHost.tsx:258-260` records hidden surface render | Primary tabs, applets, settings/search/social surfaces | This is the page lifetime policy; any page using PageDescriptor inherits the same hidden-tree behavior |
| `DL-FD-03` | P1 | Phase 2 | Legacy pages use active-only mount semantics beside PageHost keepalive semantics | `PageRouter.tsx:21-28` only renders fallback for non-kernel pages; `PageRouter.tsx:31-72` mounts `notes`, `agent-profile`, `agent-orchestration`, module fallback only when active | Primary nav consistency | User sees all of them as tabs, but runtime mixes keepalive, dynamic, and ephemeral lifetimes |
| `DL-FD-04` | P0 | Phase 2 | SectionHost renders hidden sections and measures render-time section cost | `SectionHost.tsx:25-31` mutates mounted sections on active section change; `SectionHost.tsx:63-72` records hidden/render cost; `SectionHost.tsx:74-84` hides inactive section with CSS | Secondary tabs/settings section host | This is the generic section-host policy, not an individual Settings tab implementation detail |
| `DL-FD-05` | P0 | Phase 3 | Chat session list subscribes broadly and derives full conversation projection during render | `ChatSessionList.tsx:38-57` destructures wide `useSocialChatStore()` state/actions; `ChatSessionList.tsx:68-80` calls `getIMConversations()` from render path | Chat tab, hidden chat tree, context menu | Any social store update can fan out into list projection work even when the user is switching unrelated tabs |
| `DL-FD-06` | P0 | Phase 3 | Conversation projection traverses sessions/groups/messages and sorts every call | `socialChat.ts:2720-2777` loops sessions/groups, filters messages, builds preview, sorts by sticky/activity | Chat list, message area/detail/thread consumers | Projection is store-level shared behavior; every caller pays full derive/sort unless moved to maintained projection state |
| `DL-FD-07` | P0 | Phase 4 | Right-click menu is row-level React Dropdown, not an independent overlay lane | `ChatSessionList.tsx:113-203` builds menu model from row/state; `ChatSessionList.tsx:264-345` wraps each row with `<Dropdown trigger={['contextMenu']}>`; `main.tsx:111-113` disables native context menu | Chat context menu / option tab | Overlay visibility competes on the same React/main-thread lane as list render and store fanout |
| `DL-FD-08` | P1 | Phase 1 | SideNav is not a pure shell switcher | `AppSideNav.tsx:55-68` subscribes agent/chat/applets stores; `AppSideNav.tsx:73-104` may open/create agent chat sessions; `AppSideNav.tsx:250-293` mixes module/app/settings nav actions | Primary nav click frame | Shell navigation owns every primary tab click; broad store subscriptions and side effects violate click-frame isolation |
| `DL-FD-09` | P0 | Phase 0 | Browser baseline can falsely look ready when gateway is absent | `main.tsx:37-52` browser bridge routes all invoke calls to `__PT_GATEWAY_BASE__`; `_ensure-desktop-rust.sh:102-118` lets `wait_for_gateway()` return success after warning | Browser E2E / performance evidence | A performance gate can sample boot/auth failure instead of ready shell behavior unless preflight is fail-closed |
| `DL-FD-10` | P0 | Phase 0 / Phase 5 | Stable startup entrypoints do not yet prove clean runtime state as first-class contracts | Current evidence: `make desktop-web` can trigger remote deploy; Desktop app dev path can block on `predev -> build:applets`; §3.6.1 required ad hoc runtime override; true-click blocked by Assistive Access/screenshot | Dev/prod matrix, Vite vs Tauri evidence, runtime/API attribution | The contract must be owned by `make desktop` / `make desktop-web` / `make station` / performance gate behavior, not by current bash internals; otherwise browser/Tauri/prod/offline cells are easy to mislabel or omit |

### 4.1 ReadyView 每次 render 创建新 context value

File: `apps/desktop/src/views/ReadyView.tsx`

```tsx
<PageContextProvider value={{ router, navigation, appletPins }}>
```

影响：

- `router` / `navigation` / `appletPins` 任一变化都会形成新对象。
- 所有 `usePageContext()` 消费者有被广播唤醒的风险。
- 这是 Shell 级 fanout，不是单页面问题。

### 4.2 PageHost 预热和保活隐藏树

File: `apps/desktop/src/kernel/PageHost.tsx`

关键行为：

- idle 预热：`listIdlePreloadPages()` 逐个 mount。
- 保活：非 active page 使用 `display: none`，但 React tree 仍存在。
- hidden render 可观测：`recordHiddenSurfaceRender(...)`。

影响：

- 登录后和切换后，隐藏页面仍可能 render。
- `display:none` 只阻止绘制，不阻止 React render、store subscription、effect 调度。

### 4.3 Legacy 页面仍走 active mount/unmount

File: `apps/desktop/src/components/PageRouter.tsx`

未迁移页面走 `EphemeralPage`，例如：

- `notes`
- `agent-profile`
- `agent-orchestration`
- module registry fallback page

影响：

- 一级导航在不同页面之间不是同一种 lifetime 语义。
- 用户体感上都是“tab”，但框架下有保活切换、fallback mount、动态 module mount 多种路径。

### 4.4 Settings 二级 tab 使用 SectionHost，但仍有 hidden section render

File: `apps/desktop/src/pages/SettingsPage.tsx`

关键路径：

- group tab：`handleGroupChange`
- section tab：`handleSectionChange`
- content：`SectionHost`

采样中 `settings:section-host:*` 出现 hidden render，说明二级 tab 也在复用同一类 hidden alive tree 问题。

### 4.5 Chat store 宽订阅 + render 阶段全量投影

File: `apps/desktop/src/components/chat/ChatSessionList.tsx`

问题：

- 组件直接 `useSocialChatStore()` 取大量字段和 action。
- render 中 `useMemo(() => getIMConversations(), [...sessions, groups, messages, ...])`。
- 每个会话行都包 `Dropdown trigger={['contextMenu']}`。

File: `apps/desktop/src/store/socialChat.ts`

`getIMConversations()` 遍历：

- `sessions`
- `groups`
- `messages[conversation]`
- `conversationLocalState`
- unread / preview / sticky / sort

影响：

- 消息、preview、local state、unread 任一更新都可能重算整个会话列表。
- 隐藏 chat tree 仍保活时，这类重算可能和其他 tab 切换竞争主线程。
- 右键菜单依赖每行 Dropdown 和 context menu 构造，也受同一主线程阻塞影响。

### 4.6 SideNav 可测性不足

File: `apps/desktop/src/components/AppSideNav.tsx`

主导航 `ActionIcon` 使用 `title`，但浏览器 accessibility snapshot 中主按钮没有稳定 name / test id。

影响：

- E2E 性能采样被迫使用坐标或 DOM 结构。
- 基础框架缺少可回归的性能 gate anchor。

---

## 5. Root Cause Model

当前最合理的系统性根因不是单个页面重，也不是单纯 Tauri 慢，而是：

```text
用户输入
  -> Shell route/context 更新
  -> PageHost / SectionHost active 切换
  -> hidden alive tree 仍被唤醒
  -> 宽 store subscription + render-time projection 重算
  -> React Dropdown / overlay 也排队在同一主线程
  -> 用户感知一级 tab、二级 tab、右键菜单都卡
```

这解释了为什么“只要是 tab 都卡”：tab 在当前框架里不是纯 visibility flip，而是会触发一组隐藏树、store、section、runtime 的联动。

### 5.1 Attribution rules

后续所有样本按下表归因；缺少必需信号时只能降级为 `diagnostic incomplete`，不能补脑归因。

| Layer | Required signal | Attribution rule | Evidence gap behavior |
|---|---|---|---|
| Shell / navigation | click intent, route requested, first feedback, route visible | click frame 中 route/context 更新导致全 shell consumer render 或 SideNav side effect，即归 Shell | 缺 click intent/feedback 时只记录 route latency |
| PageHost / hidden tree | `surface.render`, `surface.hidden.render`, active page owner | active switch 窗口内出现非目标 page hidden render，即归 PageHost lifetime policy | 缺 owner 时标记 hidden render unknown owner |
| SectionHost / secondary tab | section render/hidden render, section id | secondary tab 窗口内出现旧 section hidden render 或多 section render，即归 SectionHost policy | 只采 Settings 时不得外推所有 section |
| Store / projection | `store.update`, listener/fanout count, projection duration | 单次 store update 唤醒 active/hidden 多 owner，或 render path full derive/sort 超预算，即归 store/projection | 缺运行时 fanout 时只能用静态证据 |
| React commit | `react.commit` count/duration by interaction | commit 总时长或次数超预算，且不由单一 IO 等待解释，即归 React render/commit | 缺 Profiler 时不得声称 commit 已验证 |
| Overlay | contextmenu intent, overlay visible, content ready | intent 到 visible 超 `50ms`，且主线程/React queue 被前述层占用，即归 overlay lane 缺失 | 缺 visible event 时 context-menu sample fail |
| Tauri bridge | invoke command/duration/interaction id | click frame 内出现未登记 invoke 或 WebView 比 browser 同动作多出稳定额外耗时，即归 Tauri bridge amplification | 缺 true WebView click trace 时不能说 Tauri 交互已排除 |
| Rust / Station network | gateway curl, command logs, Station health | gateway/Station 耗时解释 command latency，但不能直接解释无 invoke 的 UI click frame | 缺 command correlation 时只归 startup/session lifecycle |
| Production bundle | build graph, chunk size, preview boot result | prod boot crash 或大 chunk blocking 首屏，即归 production bundle readiness | 不能用于解释 dev ready-shell tab 卡，除非同动作 prod trace 存在 |

---

## 6. Tauri Judgment

- **不是只能归因给 Tauri**：Vite browser 中已经复现主线程 long task 和 hidden render。
- **Tauri/Rust bridge 会放大部分卡顿窗口**：真实 Tauri app WebView 日志中存在 `600-760ms` 的 runtime bootstrap command，以及 session revoked 后 `300-500ms` 的登录态回退 command burst。
- **不能宣称 Tauri 是一级/二级 tab/右键卡顿的唯一根因**：browser 基线已证明 Web 前端运行时本身存在 hidden render、long task、store/projection fanout。
- **不能宣称 Tauri 交互链路已完全隔离**：真实窗口点击 trace 仍缺失。

后续需要补：

- 真实 Tauri `.app` 同一账号、同一动作 trace；需要 WebView 可自动化入口或 macOS Assistive Access。
- WebView 与 browser 对比：long task、route.visible、hidden render、IPC 耗时。
- `tauri.invoke` 分布采样，确认 click frame 内是否有同步等待或 IPC 队列阻塞。

---

## 7. Performance Red Lines

建议作为 Desktop 框架红线：

| 指标 | 红线 |
|---|---:|
| click-to-first-feedback | `<50ms` |
| primary tab click-to-visible | `<100ms` |
| secondary tab click-to-visible | `<80ms` |
| context menu open | `<50ms` |
| single JS long task | 禁止 `>50ms` |
| hidden surface render on active route switch | 默认禁止，必须有预算和 owner |
| render-time full projection/sort | 禁止出现在通用 tab click frame |

---

## 8. Follow-up Evidence Required

1. Tauri true-window E2E trace。
2. Store fanout profiler：一次 store update 唤醒哪些组件。
3. React commit profiler：每次 tab click 的 commit 数、commit duration。
4. Overlay latency probe：contextmenu event -> menu DOM visible 的精确耗时。
5. Production Tauri 对照：排除 dev-only profiler 和 sourcemap 噪声。
6. Offline ready-shell fixture：无 gateway/Station 时仍能进入轻 shell，用于隔离 UI runtime 与 network/runtime。

---

## 9. Goal Completion Audit

本节按用户原始 goal 逐项审计。状态语义：

- `DONE`: 当前证据足以支撑该项诊断结论或交付物。
- `PARTIAL`: 已有证据，但覆盖面不足以支撑全量验收。
- `BLOCKED-BY-EVIDENCE-GAP`: 当前缺少必要采样入口或前置 baseline，不能诚实声明完成。

### 9.1 Scope Coverage

| Scope item | Status | Evidence | Gap |
|---|---|---|---|
| Desktop Shell / 一级导航 | `PARTIAL` | Vite browser route visible、hidden render、longtask；ReadyView/PageHost code finding；Tauri app preflight runnable | 真实 Tauri 点击 trace、React commit count 缺失 |
| PageHost / PageFrame / 保活页面 | `DONE` for diagnosis | `pages:prewarm`、`surface.hidden.render`、PageHost hidden policy code finding | 后续修复需 Phase 2 gate |
| 二级 tab / SectionHost | `PARTIAL` | Settings SectionHost route visible 和 hidden section render | 仅覆盖 Settings；缺所有 section host runtime profile |
| Overlay / Dropdown / 右键菜单 | `PARTIAL` | Chat row React Dropdown source、§3.14 browser DOM MutationObserver contextmenu-to-visible sample | 缺内建 overlay visible event、interaction correlation 和 Tauri true-window sample |
| Zustand store subscription / projection derive | `PARTIAL` | 裸 store 订阅静态审计、`getIMConversations()` render path code finding | 缺运行时 store fanout sampler |
| React render / commit / hidden tree render | `PARTIAL` | hidden render 和 longtask 已采；React commit sampler 不存在 | 缺 commit count/duration |
| Tauri invoke / Rust bridge / Station 网络影响 | `PARTIAL` | Tauri WebView command burst、gateway curl 对照、§3.15 health-check-only browser startup API burst、§3.6.1 Tauri app startup/API burst | 缺用户点击 frame 内 invoke trace |
| Dev vs prod | `PARTIAL` | dev browser/Tauri sampled；production build and preview sampled | prod preview crash，不能进入 ready shell |
| Vite browser vs Tauri WebView | `PARTIAL` | browser interaction sampled；Tauri app process/gateway/startup sampled | Tauri WebView true click trace 被 macOS Assistive Access/screenshot 权限阻塞 |
| 联网 vs 断网 | `PARTIAL` | remote Station dev sampled；no-gateway boot failure sampled | 无 offline ready-shell fixture，不能测断网 tab/overlay |

### 9.2 Execution Stage Audit

| Goal stage | Status | Evidence | Gap |
|---|---|---|---|
| 1. 建立卡顿矩阵 | `PARTIAL` | §3.10 baseline matrix status | Tauri true click、prod ready shell、offline ready shell 缺失 |
| 2. 建立采样手段 | `PARTIAL` | Existing runtime events cover longtask/route/hidden render; §3.13 primary and §3.14 secondary/context-menu diagnostic samples add external DOM probes; framework plan now requires Station-managed telemetry ingestion/storage/query | click-to-feedback、内建 overlay.visible、React commit、store fanout、Station telemetry API/DB/query 未实现 |
| 3. 运行基线测试 | `PARTIAL` | Vite dev browser, current browser preflight/login/primary/secondary/context-menu diagnostic run, health-check-only browser gateway/API burst, Tauri dev startup, production build/preview, no-gateway dev | prod/Tauri/offline ready shell baseline 不完整 |
| 4. 分层归因 | `DONE` for current evidence | Root cause model separates Web runtime, Tauri bridge, production bundle, offline boot | Click-frame Tauri attribution remains unproven |
| 5. 输出框架缺陷清单 | `DONE` | §4 code findings and §2 evidence summary | Runtime fanout details need Phase 0 sampler |
| 6. 输出框架级修复计划 | `DONE` | `docs/architecture/frontend-runtime/execution-plans/20260706-desktop-global-lag-framework-plan.md` | Plan still awaits user confirmation before implementation |

### 9.3 Acceptance Audit

| Acceptance item | Status | Evidence | Claim allowed |
|---|---|---|---|
| 能回答“是不是 Tauri 问题”，并有证据 | `DONE` with bounded answer | Browser reproduces Web runtime lag; Tauri bridge amplifies startup/login; Tauri click trace missing | 可以说“不是纯 Tauri；Tauri bridge 会放大；交互链路未完全隔离” |
| 能解释为什么一级菜单、二级 tab、右键菜单会同时卡 | `DONE` for framework model | Shell/context -> PageHost/SectionHost hidden tree -> store/projection -> overlay same main thread | 可以作为当前主根因模型 |
| 给出全局性能红线 | `DONE` | §7 and framework plan §2 | 可执行预算已落盘 |
| 产出可落盘诊断报告 | `DONE` | 当前文件 | 已完成 |
| 产出可落盘执行计划 | `DONE` | framework plan, including Station-managed Phase 0 telemetry contract and `P0-1` to `P0-8` execution checklist | 已完成 |
| 执行计划确认前不做补丁式代码修改 | `DONE` | `git status --short` 仅显示 docs/architecture、docs/context、test-resources 文档类改动；无 `apps/desktop/src` 业务代码修改 | 满足 |

### 9.4 Final Audit Decision

当前 workstream 已满足“诊断报告 + 框架级执行计划”的文档交付目标，但仍不满足“完整基线矩阵与完整采样手段”的强验收：

- Tauri true-window click trace 缺自动化权限/入口。
- Production browser preview 在 boot 阶段 crash，不能进入 ready shell。
- Offline/no-gateway 只能到 boot failed screen，缺 offline ready-shell fixture。
- React commit 和 store fanout 只有静态证据，缺运行时 sampler。

因此本 goal 不应标记为 `complete`。下一步应先让用户确认框架级计划，然后进入 Phase 0 Evidence Gate，而不是继续扩展手工诊断。
