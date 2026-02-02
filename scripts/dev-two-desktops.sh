#!/bin/bash
# 启动两个 Desktop 客户端的脚本
# 用于多客户端交互调试
#
# 用法:
#   ./dev-two-desktops.sh         # 默认模式：hot reload + 静态实例
#   ./dev-two-desktops.sh --build # 纯构建模式：两个静态实例

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DESKTOP_DIR="$PROJECT_ROOT/client/desktop"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_blue() { echo -e "${BLUE}[INFO]${NC} $1"; }

# 停止现有 Desktop 进程
kill_existing_desktops() {
    log_info "检查并停止现有 Desktop 进程..."
    pkill -f "peers_touch_desktop" 2>/dev/null || true
    pkill -f "flutter_tools.*desktop" 2>/dev/null || true
    pkill -f "flutter run.*macos" 2>/dev/null || true
    sleep 1
}

# 纯构建模式
build_mode() {
    log_info "=========================================="
    log_info "   构建模式：两个静态实例"
    log_info "=========================================="

    cd "$DESKTOP_DIR"
    
    log_info "构建 Desktop 应用..."
    flutter build macos --debug

    APP_PATH="$DESKTOP_DIR/build/macos/Build/Products/Debug/peers_touch_desktop.app"
    
    if [ ! -d "$APP_PATH" ]; then
        log_error "构建失败"
        exit 1
    fi

    log_info "启动第一个 Desktop..."
    open -n "$APP_PATH" &
    sleep 2

    log_info "启动第二个 Desktop..."
    open -n "$APP_PATH" &
    
    log_blue "=========================================="
    log_blue "两个 Desktop 实例已启动"
    log_blue "注意：此模式不支持热重载"
    log_blue "重新运行脚本以重新构建"
    log_blue "=========================================="
}

# 热重载模式
hot_reload_mode() {
    log_info "=========================================="
    log_info "   热重载模式"
    log_info "   实例1: flutter run (支持热重载)"
    log_info "   实例2: 静态构建"
    log_info "=========================================="

    cd "$DESKTOP_DIR"
    
    log_info "检查依赖..."
    flutter pub get

    # 先构建一次，用于第二个实例
    log_info "构建 Desktop 应用 (用于第二个实例)..."
    flutter build macos --debug
    
    APP_PATH="$DESKTOP_DIR/build/macos/Build/Products/Debug/peers_touch_desktop.app"
    
    if [ -d "$APP_PATH" ]; then
        log_info "启动第二个 Desktop (静态实例)..."
        open -n "$APP_PATH" &
        sleep 2
    fi

    log_blue "=========================================="
    log_blue "启动第一个 Desktop (支持热重载)..."
    log_blue "=========================================="
    log_info "热重载快捷键："
    log_info "  r  - Hot reload"
    log_info "  R  - Hot restart"
    log_info "  q  - 退出"
    log_blue "=========================================="
    
    # 启动 flutter run，这个支持热重载
    flutter run -d macos
}

# 捕获退出信号
cleanup() {
    log_info "正在停止所有 Desktop..."
    kill_existing_desktops
    exit 0
}

trap cleanup SIGINT SIGTERM

# 主函数
main() {
    kill_existing_desktops
    
    if [ "$1" == "--build" ]; then
        build_mode
    else
        hot_reload_mode
    fi
}

main "$@"
