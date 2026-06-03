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
| `generate-mobile-brand-assets.py` | 可用 | 生成 Mobile 品牌资源 | 生成 App 内透明 wordmark；系统图标复用 Desktop `icon-source.png`，并同步生成 Tauri icon、iOS AppIcon 与 Android launcher icons |
| `proto-gen-mobile.sh` | 可用 | 生成 Mobile proto 产物 | 支持 `kotlin` / `swift` / `web` / `all`；`web` 输出到 `apps/mobile/src/gen/proto` |
| `check-social-runtime-boundaries.sh` | 可用 | 校验双端社交 Runtime 边界 | 禁止页面/组件直接拥有社交实时流、reconcile、长期 freshness |
| `apps/mobile/scripts/check-social-wire-contract.sh` | 可用 | 校验 Mobile 社交实时协议契约 | 禁止回退到手写 protobuf wire decoder |
| `apps/desktop/scripts/check-social-wire-contract.sh` | 可用 | 校验 Desktop 社交实时协议契约 | 禁止回退到手写 protobuf wire decoder |
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
