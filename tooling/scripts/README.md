# 脚本现状与推荐入口

本目录历史脚本较多，部分已不适配当前仓库结构。下面是已盘点结果与推荐入口。

## 推荐入口（当前可用）

| 脚本 | 用途 | 说明 |
|---|---|---|
| `preview-web.sh` | 启动 Desktop Web 预览 | 默认 `http://localhost:3000`，会检查/拉起 station |
| `preview-desktop.sh` | 启动 Desktop(Tauri) 预览 | 会先停止 `preview-web.sh`，并检查/拉起 station |
| `dev-clean.sh` | 清理常见开发进程 | 兼容旧 PID 文件 |

### 使用方式

```bash
# Web 预览（默认 3000）
./tooling/scripts/preview-web.sh

# Web 预览（指定端口）
./tooling/scripts/preview-web.sh 3001

# Desktop(Tauri) 预览
./tooling/scripts/preview-desktop.sh
```

可选环境变量：

```bash
# 指定 station 代理目标（默认 http://127.0.0.1:18080）
export VITE_STATION_PROXY_TARGET=http://127.0.0.1:18080

# 指定 station 就绪检查接口（默认 $VITE_STATION_PROXY_TARGET/api/oauth/providers）
export STATION_HEALTHCHECK_URL=http://127.0.0.1:18080/api/oauth/providers
```

## 盘点结论（迁移前遗留）

| 脚本 | 状态 | 主要问题 |
|---|---|---|
| `dev-station.sh` | legacy | `PROJECT_ROOT` 计算错误（仅上溯一层） |
| `dev-full-stack.sh` | legacy | 目录推导错误，且流程假设旧启动方式 |
| `dev-two-desktops.sh` | legacy | 仍以 Flutter Desktop 构建为主，不符合当前 Tauri 主路径 |
| `dev-desktop-mobile.sh` | legacy | 混合旧 Flutter/Tauri 假设，目录推导错误 |
| `run_all_tests.sh` | legacy | 根目录推导错误，测试范围与现仓库不一致 |
| `pt.sh` / `pt.ps1` | legacy | 仍引用旧目录（`station/app`、`desktop`、`client/mobile`） |
| `check-go-style.sh` | partial | 默认目录仍为旧结构，需参数化后使用 |
| `format-go.sh` | partial | 仅在目标 Go 子模块目录执行才安全 |
| `update-external-repos.sh` | unknown | 与当前 OAuth/desktop 预览链路无直接关系 |

## 约定

- 配置可使用 YAML（例如 OAuth provider 配置）。
- 运行状态与业务状态不再依赖 SQLite 本地真相源，统一走原生架构。
