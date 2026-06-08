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
| `apps/mobile/scripts/check-social-wire-contract.sh` | 可用 | 校验 Mobile 社交实时协议契约 | 禁止回退到手写 protobuf wire decoder |
| `apps/desktop/scripts/check-social-wire-contract.sh` | 可用 | 校验 Desktop 社交实时协议契约 | 禁止回退到手写 protobuf wire decoder |
| `review/run.sh` | 推荐 | 运行 Code Review Framework 门禁 | 统一调用变更路由、硬规则、知识库匹配、Review Skill 保鲜检查；也可通过 `make review` 使用 |
| `review/route-change.sh` | 推荐 | 将 git diff 映射到 Review profiles | 输出每类变更需要关注的规则和验证命令 |
| `review/hard-rules.sh` | 推荐 | 自动拦截 Review 铁律违规 | 检查 debug 语句、泄密、生成物手改、mock API、硬编码 UI 文案、静默吞错 |
| `review/knowledge-match.sh` | 推荐 | 匹配 `docs/knowledge/` 的 `owns:` | 输出 PR 必读 invariant / pitfall / playbook，并支持 strict 新鲜度校验 |
| `review/skill-check.sh` | 推荐 | 校验 Review Skill 完整性与新鲜度 | 检查 skill 结构、上游文档 hash、golden fixtures 和危险指令 |
| `acceptance-plan.py` | 推荐 | 根据 git diff 和 `tooling/acceptance/registry.yaml` 规划应跑的产品验收 gate | 通过 `make acceptance-plan` 调用 |
| `acceptance-run.py` | 推荐 | 执行 `acceptance-plan.py` 选出的 gate 并记录日志 | 通过 `make acceptance-run` 调用 |
| `acceptance-report.py` | 推荐 | 汇总最新验收计划和执行结果 | 通过 `make acceptance-report` 调用 |
| `acceptance-validate.py` | 推荐 | 校验 capability graph、domain profile、registry、gate、latest run result、report 闭环 | 通过 `make acceptance-validate` 或 `make acceptance-validate DOMAIN=<name>` 调用 |
| `acceptance-coverage-report.py` | 推荐 | 汇总项目产品域接入状态、active domain 验证状态和 capability 清单 | 通过 `make acceptance-coverage-report` 调用 |
| `acceptance-capability-report.py` | 推荐 | 汇总 feature contract、capability graph、mutual validation 与 gate 结果，产出产品能力验收报告 | 通过 `make acceptance-federation-report` 调用 |
| `tooling/acceptance/gates/federation/surface_smoke.py` | 可用 | agent 主动验收 Federation app surface：Station 健康、Dashboard Federation bundle、Desktop gateway Station 绑定 | 通过 `make federation-surface-smoke` 调用 |
| `tooling/acceptance/gates/dashboard/federation_visible_surface.py` | 可用 | Headless Chrome 可见面验收 Dashboard；自动读取本地 `.localenv` 的 admin 环境变量，缺凭据时验收 login gate | 通过 `make federation-dashboard-visible-surface` 调用 |
| `tooling/acceptance/gates/dashboard/federation_operational_drilldown.py` | 可用 | 验证 Dashboard Federation operations API 与 sync/recovery/discovery drilldown 可见面 | 通过 `make federation-dashboard-operational-drilldown` 调用 |
| `tooling/acceptance/gates/desktop/gateway_smoke.py` | 可用 | 通过 Desktop gateway 校验 active Station，并保存 render diagnostic | 通过 `make federation-desktop-gateway-smoke` 调用 |
| `tooling/acceptance/gates/federation/mutual_validation.py` | 可用（alias） | Federation domain validation 的兼容 wrapper；核心逻辑在 `acceptance-validate.py` | 通过 `make acceptance-federation-mutual-validation` 调用 |
| `check-go-style.sh` | 可用（按参数） | Go 风格检查与 lint | 默认目录仍偏旧，建议传入明确目录 |
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
