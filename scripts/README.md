# 开发脚本说明

本目录包含用于开发调试的便捷脚本。

## 脚本列表

| 脚本 | 说明 |
|------|------|
| `dev-station.sh` | 启动 Station 服务端 |
| `dev-two-desktops.sh` | 启动两个 Desktop 客户端 (用于调试多客户端交互) |
| `dev-desktop-mobile.sh` | 启动一个 Desktop + 一个 Mobile |
| `dev-full-stack.sh` | 完整开发环境启动 (Station + 客户端) |
| `dev-clean.sh` | 清理所有开发进程 |
| `run_all_tests.sh` | 运行所有测试 |

## 使用方法

### 1. 只启动服务端

```bash
./scripts/dev-station.sh
```

### 2. 启动两个桌面客户端 (调试多客户端交互)

```bash
./scripts/dev-two-desktops.sh
```

### 3. 启动桌面 + 移动端

```bash
./scripts/dev-desktop-mobile.sh
```

### 4. 完整开发环境

```bash
# 默认: Station + 单个 Desktop
./scripts/dev-full-stack.sh

# 双 Desktop 模式
./scripts/dev-full-stack.sh --two-desktops

# 包含 Mobile
./scripts/dev-full-stack.sh --with-mobile

# 只启动 Station
./scripts/dev-full-stack.sh --station-only
```

### 5. 清理所有开发进程

```bash
./scripts/dev-clean.sh
```

## 重要说明

- **重复执行**: 所有脚本支持重复执行，会自动终止旧进程并重启
- **进程管理**: 使用 `/tmp/peers-touch-*.pid` 文件跟踪进程
- **退出**: 按 `Ctrl+C` 可优雅地停止所有相关进程
- **iOS 模拟器**: `dev-desktop-mobile.sh` 会自动启动 iOS 模拟器 (如果未运行)

## 依赖

- Go (用于编译 Station)
- Flutter (用于运行客户端)
- Xcode (用于 iOS 模拟器)
