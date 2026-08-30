# tooling/scripts 使用说明（2026-03）

本目录是仓库统一脚本入口。运行程序时，优先使用这里的脚本，而不是手工在各子目录执行命令。

## 1. 启动程序（推荐）

### Desktop（Tauri）

```bash
./tooling/scripts/preview-desktop.sh
```

行为说明：
- 自动检查并拉起 station（依赖 `_ensure-station.sh`）。
- 自动清理旧的 desktop/web 预览 PID，避免 Vite 端口冲突。
- 若检测到 Vite 端口（默认 3000）被占用，会先干掉监听进程再启动。
- 在 `apps/desktop` 下启动 `tauri:dev -- --no-watch`。

可选环境变量：

```bash
export PEERS_STATION_URL=http://127.0.0.1:18080
export STATION_HEALTHCHECK_URL=http://127.0.0.1:18080/api/oauth/providers
export VITE_PORT=3000
```

### 停止开发进程

```bash
./tooling/scripts/dev-clean.sh
```

说明：
- 清理常见 PID 文件与历史开发进程。
- 会尝试终止 station / desktop / mobile 相关旧进程。

## 2. 脚本现状总览

| 脚本 | 当前状态 | 主要用途 | 备注 |
|---|---|---|---|
| `preview-desktop.sh` | 推荐 | 本地启动 Desktop(Tauri) | 当前最稳定入口 |
| `_ensure-station.sh` | 内部依赖 | 检查/启动 station 并做健康探测 | 由 preview 脚本调用 |
| `dev-clean.sh` | 推荐 | 清理开发进程 | 建议重启开发环境前执行 |
| `dev-testnet-desktops.sh` | 可用 | 启动 testnet Desktop 多实例 | 支持 macOS 默认 Bash；通常通过 `make testnet-desktop NODES="a b"` 调用 |
| `generate-mobile-brand-assets.py` | 可用 | 生成 Mobile 品牌资源 | 生成 App 内透明 wordmark；系统图标从 Desktop `icon-source.png` 裁掉外圈并保留源图主体占比，再同步生成 Tauri icon、iOS AppIcon 与 Android launcher icons |
| `proto-gen-mobile.sh` | 可用 | 生成 Mobile proto 产物 | 支持 `kotlin` / `swift` / `web` / `all`；`web` 输出到 `apps/mobile/src/gen/proto` |
| `check-social-runtime-boundaries.sh` | 可用 | 校验双端社交 Runtime 边界 | 禁止页面/组件直接拥有社交实时流、reconcile、长期 freshness |
| `check-frontend-runtime-registry.sh` | 可用 | 校验 Frontend Runtime registry 门禁 | 检查 registry 必填字段、alive/status 枚举、evidence、`needs audit` owner/revisit wording，并支持 review diff-range warning |
| `apps/mobile/scripts/check-social-wire-contract.sh` | 可用 | 校验 Mobile 社交实时协议契约 | 禁止回退到手写 protobuf wire decoder |
| `apps/desktop/scripts/check-social-wire-contract.sh` | 可用 | 校验 Desktop 社交实时协议契约 | 禁止回退到手写 protobuf wire decoder |
| `review/run.sh` | 推荐 | 运行 Code Review Framework 门禁 | 统一调用变更路由、硬规则、知识库匹配、Review Skill 保鲜检查；也可通过 `make review` 使用 |
| `review/route-change.sh` | 推荐 | 将 git diff 映射到 Review profiles | 输出每类变更需要关注的规则和验证命令 |
| `review/hard-rules.sh` | 推荐 | 自动拦截 Review 铁律违规 | 检查 debug 语句、泄密、生成物手改、mock API、硬编码 UI 文案、静默吞错 |
| `review/knowledge-match.sh` | 推荐 | 匹配 `docs/knowledge/` 的 `owns:` | 输出 PR 必读 invariant / pitfall / playbook，并支持 strict 新鲜度校验 |
| `review/skill-check.sh` | 推荐 | 校验 Review Skill 完整性与新鲜度 | 检查 skill 结构、上游文档 hash、golden fixtures 和危险指令 |
| `review/submit-pipeline.sh` | 推荐 | 用户请求提交 MR/PR 时的提交前质量流水线 | 通过 `make review-submit REVIEW_BASE=<base>` 调用；生成 quality evidence 并运行 review/acceptance gates |
| `quality-evidence.py` | 推荐 | 聚合 review route、knowledge、acceptance plan、gate tier 和 proven/unproven scope | 通过 `make quality-evidence REVIEW_RANGE=<range>` 调用；产出 JSON/Markdown evidence |
| `acceptance-plan.py` | 推荐 | 根据 git diff 和 `tooling/acceptance/registry.yaml` 规划应跑的产品验收 gate | 通过 `make acceptance-plan` 调用 |
| `acceptance-run.py` | 推荐 | 执行 `acceptance-plan.py` 选出的 gate 并记录日志，支持 `--tier` 分层过滤 | 通过 `make acceptance-run` / `make acceptance-run-ci` 调用 |
| `acceptance-cell.py` | 推荐 | 管理 Native Desktop runtime cell 的 ready/status/logs/stop 生命周期 | 通过 `make acceptance-cell-{ready,status,logs,stop} CELL=<cell-id>` 调用；host 等敏感配置只从本地 profile 解析 |
| `acceptance-report.py` | 推荐 | 汇总最新验收计划和执行结果 | 通过 `make acceptance-report` 调用 |
| `acceptance-validate.py` | 推荐 | 按责任范围校验 capability graph、feature/gate、Provisioning contract、registry、run result 与 report；Infra 模式只消费 `acceptance_core_self_validation` | 通过 `make acceptance-infra-validate`、`make acceptance-validate` 或 `make acceptance-validate DOMAIN=<name>` 调用 |
| `acceptance-infra-boundary-test.py` | 推荐 | 校验 Acceptance Infra / 业务注入责任防火墙、Agent 开发手册路由和 Quality Evidence direction 隔离 | 由 `acceptance-runtime-provisioning-self` Gate 调用 |
| `acceptance-coverage-report.py` | 推荐 | 从当前 workspace 的 durable latest manifests 汇总项目产品域接入状态；校验 proof/redaction/artifact identity，跨平台 Gate 只接受完整 runtime-cell matrix | 通过 `make acceptance-coverage-report` 调用；回归测试为 `acceptance-coverage-report-test.py` |
| `acceptance-capability-report.py` | 推荐 | 汇总 feature contract、capability graph、mutual validation 与 gate 结果，产出产品能力验收报告 | 通过 `make acceptance-federation-report` 调用 |
| `agent-lobehub-parity-evidence-chain-gate.py` | 可用 | 校验 Agent LobeHub parity 账本、原型 pending-review 状态和 PLAN-P5 fail-closed 入口控制 | 通过 `python3 tooling/scripts/agent-lobehub-parity-evidence-chain-gate.py` 调用；只证明 evidence-chain 自洽，不确认原型、不创建 EVID-012、不证明 GATE-008 |
| `agent-lobehub-parity-evidence-chain-gate-test.py` | 可用 | 回归验证 Agent LobeHub parity evidence-chain gate 的 fail-closed 判定 | 通过 `python3 tooling/scripts/agent-lobehub-parity-evidence-chain-gate-test.py` 调用 |
| `agent-lobehub-owner-review-readiness-gate.py` | 可用 | 校验 Agent LobeHub parity Owner review preparation 包是否完整：OR-001..OR-012、决策结果、输入材料、drafting/revision-required 或 pending-review fail-closed 状态，以及 PLAN-P5 blocked 边界 | 通过 `python3 tooling/scripts/agent-lobehub-owner-review-readiness-gate.py` 调用；只证明 Owner review preparation 一致性，不确认原型、不创建 EVID-012、不证明 GATE-008 |
| `agent-lobehub-owner-review-readiness-gate-test.py` | 可用 | 回归验证 Agent LobeHub Owner review preparation gate 的缺场景、真实确认行、EVID-012 前置失败判定 | 通过 `python3 tooling/scripts/agent-lobehub-owner-review-readiness-gate-test.py` 调用 |
| `tooling/acceptance/gates/federation/surface_smoke.py` | 可用 | agent 主动验收 Federation app surface：Station 健康、Dashboard Federation bundle、Desktop gateway Station 绑定 | 通过 `make federation-surface-smoke` 调用 |
| `tooling/acceptance/gates/dashboard/federation_visible_surface.py` | 可用 | Headless Chrome 可见面验收 Dashboard；自动读取本地 `.localenv` 的 admin 环境变量，缺凭据时验收 login gate | 通过 `make federation-dashboard-visible-surface` 调用 |
| `tooling/acceptance/gates/dashboard/federation_operational_drilldown.py` | 可用 | 验证 Dashboard Federation operations API 与 sync/recovery/discovery drilldown 可见面 | 通过 `make federation-dashboard-operational-drilldown` 调用 |
| `tooling/acceptance/gates/desktop/gateway_smoke.py` | 可用 | 通过 Desktop gateway 校验 active Station，并保存 render diagnostic | 通过 `make federation-desktop-gateway-smoke` 调用 |
| `tooling/acceptance/gates/federation/mutual_validation.py` | 可用（alias） | Federation domain validation 的兼容 wrapper；核心逻辑在 `acceptance-validate.py` | 通过 `make acceptance-federation-mutual-validation` 调用 |
| `check-go-style.sh` | 可用（按参数） | Go 风格检查与 lint | 默认目录仍偏旧，建议传入明确目录 |
| `create-generic-complex-applet.mjs` | 可用 | 生成 conforming complex applet fixture | 默认生成 `generic-complex-applet`；fixture 的 readiness flow 通过 SDK 发起 service/path network、upload/download、skills、AI/agent，以及 `skills.invoke` 的 Gateway-governed network/agent executor 和 `taskType: "network"` / `taskType: "agent"` 的 Gateway-governed task executor；可用 `--id` / `--name` / `--package-name` / `--description` / `--author` / `--targets desktop,web,android,ios,harmony` 生成不同 manifest identity / platform target 的 certification fixture，避免 readiness gates 只证明固定 applet id |
| `create-official-applet.mjs` | 可用 | 生成官方 applet 产品单元骨架 | 契约驱动生成 `apps/applets/<service>/` 的 manifest、frontend、service、contracts、docs、tests；支持 `--dry-run`、`--force`、`--with-proto`，默认不覆盖已有非空文件 |
| `applet-official-contract-gate.mjs` | 可用 | 校验官方 applet 产品单元契约 | 检查目录、manifest service binding、Station-bundled/standalone 声明、frontend 禁止依赖 Desktop/Mobile/Station 与 raw backend URL |
| `applet-official-skill-discovery-gate.mjs` | 可用 | 校验官方 applet skill 可发现性 | 检查 `pt-official-applet-development` skill 存在、`AGENTS.md` 已注册、applet-runtime 文档有反向链接并覆盖 scaffold/service-binding 触发语义 |
| `applet-note-frontend-sdk-gate.mjs` | 可用 | 校验 Note 官方 applet 前端 SDK 约束 | 检查 Note frontend 只通过 `@peers-touch/applet-sdk` 与 `sdk.network.request({ service: "note" })` 访问服务，无 raw URL、Tauri/Desktop/Station/Mobile 私有依赖，并写出 frontend evidence |
| `applet-note-desktop-injection-gate.mjs` | 可用 | 校验 Note 官方 applet Desktop 注入包 | 运行 `applets:build` 后检查 `apps/desktop/applets-dist/peers.note`、Desktop index、manifest integrity、`station-resolved` Note service binding，并配合 Desktop applet 单测证明 `AppletManager` 能加载 `peers.note` |
| `applet-note-desktop-live-smoke.mjs` | 可用 | 校验 Note 官方 applet Desktop live Host | 启动 Vite + headless Chrome，使用真实 `AppletManager` 和 `<lynx-host>` 加载 `peers.note` bundle，验证 Note applet 经 Host bridge 调用 `lifecycle.reportReady`、`telemetry.track` 和 `network.request({ service: "note" })`；完整 harness/diagnostics 写入 `.artifacts/applet-readiness/official-applet/note-desktop-live-smoke/`，Git 只保留脱敏摘要 |
| `applet-note-real-product-gate.mjs` | 可用 | 校验 Note 官方 applet 真实产品路径 | 启动真实 Go Note Station fixture（JWT + `stationadapter` + SQLite/GORM），再运行 Desktop Rust Gateway 测试，验证 `sdk.network.request({ service: "note", path: "/v1/..." })` 经 Host Gateway 重写到 `/applets/note/v1/...` |
| `applet-note-reload-persistence-gate.mjs` | 可用 | 校验 Note 官方 applet reload 持久化闭环 | 启动真实 Go Note Station fixture（JWT + `stationadapter` + SQLite/GORM），通过公开 `/applets/note/v1` HTTP mapping 验证 create→reload、edit→reload、delete→reload、search、restore→reload，并写出 P1 reload persistence evidence |
| `applet-store-cli.mjs` | 可用 | Station Store CLI gate wrapper | 提供 `pnpm applet:publish <package-dir> --channel dev`、`pnpm applet:install <applet-id> --channel dev`、`pnpm applet:revoke <applet-id> --version <version>`，通过 Go `StoreService` + SQLite fixture 复用 Station Store 持久化、manifest/policy 校验、install state、revoke 路径，不另建本地 JSON source of truth |
| `applet-station-backed-launch-gate.mjs` | 可用 | 校验 Station-backed applet publish/install/materialization | 运行 `pnpm applets:build` 并引入 repo 外部 `big-a`，分别用 `big-a` 做三方验证、`peers.note` 做内部官方验证；通过 Station Store CLI 发布、安装，并校验 manifest integrity 声明的所有文件进入 Store bundle storage |
| `applet-developer-flow-gate.mjs` | 可用 | 校验 Applet 开发者包与 SDK 使用链路 | 生成 generic complex applet，构建 `main.lynx.bundle`，并验证 canonical manifest、SDK capability API、Host event bridge callback、Gateway network/agent skill executor 输入、network/agent task executor 输入、无 legacy/mock/raw URL 路径 |
| `applet-sdk-adapter-test.mjs` | 可用 | 校验 SDK BridgeAdapter 行为 | 使用 fake adapter 验证 app/lifecycle/system/config/storage/network/device/clipboard/file/navigation/UI/events/skills/tasks/agent/AI/telemetry method mapping、typed declarations、canonical error 保留、skill/agent stream subscription bracketing、event filtering 与 unsubscribe |
| `applet-desktop-runtime-gate.mjs` | 可用 | 校验真实 Desktop Lynx 前端 runtime | 启动 headless Chrome 加载 built Lynx bundle，要求 `<lynx-view>` 渲染 `part="page"`，小程序 React lifecycle 内 SDK 调用经 NativeModules bridge 发出，包括 `ui.showToast`，并要求 applet-side `sdk.lifecycle.onShow` 与 completed `task.event` 回调到达，同时捕获 Lynx background worker 异常 |
| `applet-desktop-product-host-gate.mjs` | 可用 | 校验 Desktop 产品 Host 前端链路 | 使用真实 `AppletManager` / `<lynx-host>` 加载 built Lynx bundle，验证 session create、SDK 调用经产品 Host 到 `applets_invoke`、Gateway events 与 `events.poll` outbox 回灌到 applet、Host-driven `ready/show/pause/resume/hide/destroy` lifecycle、Gateway 授权 Host UI command 执行、unmount destroy |
| `applet:desktop-product-host-real-gateway-gate` | 可用 | 校验 Desktop 产品 Host 前端到真实 Rust Gateway | 在 product Host gate 上启用 `--real-http-gateway`，启动 Rust HTTP Gateway 测试服务器和 controlled upstream，验证 `<lynx-host>` 的 SDK 调用不经本地 stub 而是打到真实 Gateway，并要求 controlled upstream 收到 `network` / `skills.invoke` network executor / `skills.invoke` agent executor / `taskType: "network"` executor / `taskType: "agent"` executor / `agent` / OpenAI-compatible provider 请求，且 Host lifecycle events、completed `task.event` outbox delivery 与 Gateway 授权的 Host UI command 被执行；Rust test-server 启动等待默认 120s，可用 `PEERS_APPLET_HTTP_GATEWAY_STARTUP_TIMEOUT_MS` 覆盖 |
| `applet:desktop-product-shell-real-gateway-gate` | 可用 | 校验 Desktop 正常产品壳动态 applet 路由 | 从正常 `#/applets` 小程序列表页开始，验证 canonical manifest 投影、安装状态、完整 capability method 权限分组 chip，再点击产品壳打开按钮进入 `ReadyView` + `PageHost` + `applet:*` 动态路由，不走 readiness-probe 专用视图；启动 Rust HTTP Gateway 测试服务器和 controlled upstream，要求 SDK 调用进入真实 Gateway、Host UI/device command 被产品壳执行、Host lifecycle/events 正常回灌，并在 evidence 中写出 `appletListProjection` / `permissionGroups` |
| `applet-desktop-product-window-gate.mjs` | 可用 | 校验 packaged Tauri 产品窗口真实承载小程序 | 未传 package dir 时生成 generic complex package；传入 package dir 时直接认证外部包。脚本会临时 staging 包到 Desktop applet assets，构建 `.app`，启动 packaged executable；仅在 `PEERS_APPLET_PRODUCT_WINDOW_E2E=1` 下由 Rust 绑定 bounded product-window certification session，真实产品窗口通过普通 `App` / `ReadyView` / `PageHost` 进入 `applet:<id>` 路由，不依赖 readiness-probe 专用视图；packaged app 使用隔离 `PEERS_STORAGE_ROOT` + `PT_PROFILE`，避免认证运行读取用户默认 Application Support 状态；controlled upstream 同时提供产品壳启动所需的最小 Station protobuf/JSON/SSE fixture，SDK 经 Lynx Host/Tauri/Rust Gateway 打到 controlled upstream，并通过 `telemetry.track` 在 Gateway 写出 product-shell evidence。默认要求 controlled upstream 收到 `/api/v1/e2e`、`/api/v1/e2e/echo`、`/agent/turn/execute`、`/chat/completions`，可用 `PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS` 覆盖 |
| `applet-external-producer-certification-gate.mjs` | 可用（需外部包） | 认证独立外部 producer applet package | 要求显式传入仓库外 package dir，拒绝 `generic-complex-applet`，串行运行 validate、Desktop runtime、product Host、real Gateway、normal product shell route、packaged product-window、Desktop live E2E 并写出 `.artifacts/applet-readiness/external-producer/certification-output.txt`；`--allow-repo-package` 仅用于本地 dry-run，不能作为独立外部认证证据 |
| `applet-l3-release-audit.mjs` | 可用 | 汇总 L3 candidate/release 证据缺口 | `pnpm applet:l3-candidate-audit` 校验当前 candidate evidence 是否自洽，包括 canonical contract/schema/test、platform check gate 及其当前源码 freshness、package validation、Desktop applet package distribution、frontendDist packaged assets、Tauri bundle freshness、当前 filesystem 上的 packaged assets / Tauri bundle freshness、HTTP Gateway applet command dispatch、开发者 SDK 包构建流、producer independence scan、Host package input smoke、Desktop/Web/Mobile runtime、Android/iOS Lynx runtime E2E、生产 Web Host shell、产品壳、真实 Gateway、controlled upstream、repo-external synthetic certification current package check 与 product executor evidence；`pnpm applet:l3-release-audit` 默认要求 release 级证据并在缺失真实第三方作者 attest、人工正常用户验收时失败；当前 Android/iOS runtime E2E evidence 已可由对应脚本生成。release attest/acceptance 可参考 `tooling/config/applet-release/*.example.json`，audit 会校验第三方 package path、manifest id、certification output、authorship supporting artifacts、canonical UTC ISO timestamp 顺序、非 synthetic manual run 和 supporting artifacts，并拒绝已知 Peers-Touch 生成的 certification fixture package，阻止 synthetic evidence 被误报为终态 L3 |
| `applet-evidence-layout-gate.mjs` | 可用 | 校验 Applet evidence 三根目录 | 拒绝旧 evidence 根的 live 引用、reviewed evidence 非 JSON/Markdown 文件与机器绝对路径，以及 fixture tree 中的 bundle/database/`dist`/`node_modules` |
| `applet-platform-check-gate.mjs` | 可用 | 汇总 Applet L3 相关平台 check | 串行执行 `@peers-touch/applet-sdk` check、Desktop check、Desktop Rust `cargo check`、`pnpm mobile:check`，写出 `.artifacts/applet-readiness/checks/platform-check-output.txt`；`pnpm applet:l3-candidate-audit` 会要求该 evidence，避免 runtime gates 通过但当前平台代码不可检查 |
| `applet-product-capability-service-gate.mjs` | 可用 | 校验产品级 task/skill executor 收口 | 运行 Gateway network/agent skill/task executor 回归测试，确认 live E2E controlled upstream 含 `task-network` / `task-agent` / `skill-network` / `skill-agent` 证据，并证明 `PEERS_APPLET_REQUIRE_PRODUCT_EXECUTORS` / `productExecutorsOnly` 会拒绝无真实 executor 的 skill/task fallback |
| `applet-desktop-http-gateway-gate.mjs` | 可用 | 校验 Desktop HTTP Gateway applet 命令路由 | 运行 Rust 回归测试，证明 dev HTTP Gateway dispatch 能把 `applets_create_session` / `applets_invoke` 路由到真实 Applet Gateway，并拒绝未认证上下文 |
| `applet-desktop-package-gate.mjs` | 可用 | 校验 Desktop applet 分发包 | 构建内置 applet，验证 canonical manifest、integrity，并扫描完整 `src/**` 避免 legacy bridge / legacy invoke 路径回退 |
| `applet-desktop-packaged-assets-gate.mjs` | 可用 | 校验 Desktop Tauri `frontendDist` 内的小程序资源 | 运行 Desktop build 后验证 `dist/applets-dist/index.json`、Desktop Lynx bundle、manifest 与 SHA-256 integrity 已进入 packaged frontend assets |
| `applet-desktop-tauri-bundle-gate.mjs` | 可用 | 校验 Tauri `.app`/`.dmg` 与当前小程序资源同步 | 运行当前 applets build + Tauri build 后，验证 `.app` / `.dmg` 存在、`frontendDist` applet 资源完整且 `.app` executable 晚于最新 packaged applet asset，防止旧 app shell 被误当成当前证据 |
| `applet-web-host-runtime-gate.mjs` | 可用 | 校验浏览器 Web Host runtime | 默认生成 `web-host-certification-applet`，在 headless Chrome 中安装 manifest-validated Web Host bridge，创建 session，注入 `__PEERS_TOUCH_APPLET_HOST__`，通过 SDK 执行开发者 readiness flow，验证 permission/session/raw-URL enforcement、service/path BFF proxy、audit、telemetry，以及 controlled upstream `network` / `agent` / provider 请求 |
| `applet-production-web-host-gate.mjs` | 可用 | 校验生产化 Web Host 产品壳链路 | 默认生成 `production-web-host-certification-applet`，启动 headless Chrome + Vite 产品壳，验证 catalog/sidebar、`applet:<id>` route、`data-web-host-session`、`data-applet-root`、manifest validation、`WebHostBridgeAdapter`、Host-injected `__PEERS_TOUCH_APPLET_HOST__`、developer `runAppletReadinessFlow()`、canonical permission denial、audit/telemetry，以及 controlled upstream 的 `network` / `agent` / provider / `task-network` / `task-agent` / `skill-network` / `skill-agent` 请求证据 |
| `format-go.sh` | 可用（谨慎） | Go 格式化 | 仅在目标 Go 模块目录执行 |
| `run_all_tests.sh` | 有风险 | 历史测试聚合脚本 | 根目录推导有偏差，使用前先检查路径 |
| `pt.sh` / `pt.ps1` | legacy | 历史任务分发 | 仍包含旧目录假设，不建议作为主入口 |
| `update-external-repos.sh` | 可用（需参数） | 更新 external 仓库 | 默认 external 路径请先确认 |

## 3. 推荐工作流

1. 启动：`./tooling/scripts/preview-desktop.sh`
2. 如果端口或僵尸进程冲突：`./tooling/scripts/dev-clean.sh`
3. Go 代码检查（按目录显式执行）：

```bash
./tooling/scripts/check-go-style.sh apps/station/app
```

4. Go 格式化（在目标模块目录执行）：

```bash
cd apps/station/app
../../../tooling/scripts/format-go.sh
```

## 4. 已移除/不存在说明

- 仓库当前没有 `preview-web.sh`，请不要再按旧文档使用该命令。
