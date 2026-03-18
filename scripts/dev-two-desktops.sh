#!/bin/bash
# 启动两个 Desktop 客户端的脚本
# 用于多客户端交互调试
#
# 原理：
#   每个实例通过 PEERS_INSTANCE_ID 使用独立的数据目录，
#   两个实例的存储完全隔离，不会串号。
#
# 用法:
#   ./dev-two-desktops.sh           # 默认模式
#   ./dev-two-desktops.sh --build   # 纯构建模式：两个静态实例
#   ./dev-two-desktops.sh --hot     # 热重载模式：一个 hot reload, 一个静态
#
# 环境变量:
#   PEERS_USER_A=xxx   # 实例 A 标识 (默认: a)
#   PEERS_USER_B=xxx   # 实例 B 标识 (默认: b)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DESKTOP_DIR="$PROJECT_ROOT/client/desktop"

# 默认实例标识（用于数据隔离）
USER_A="${PEERS_USER_A:-a}"
USER_B="${PEERS_USER_B:-b}"

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

# 构建应用
build_app() {
    cd "$DESKTOP_DIR"
    log_info "构建 Desktop 应用..."
    flutter build macos --debug
}

# 启动带实例隔离的实例
launch_with_instance() {
    local instance_id=$1
    local binary_path=$2
    
    log_info "启动 Desktop (实例: $instance_id)..."
    PEERS_INSTANCE_ID="$instance_id" "$binary_path" &
}

# 纯构建模式 - 两个静态实例，使用独立数据目录
build_mode() {
    log_info "=========================================="
    log_info "   构建模式：两个静态实例"
    log_info "   实例 A: PEERS_INSTANCE_ID=$USER_A"
    log_info "   实例 B: PEERS_INSTANCE_ID=$USER_B"
    log_info "=========================================="

    cd "$DESKTOP_DIR"
    
    flutter pub get
    build_app

    APP_PATH="$DESKTOP_DIR/build/macos/Build/Products/Debug/peers_touch_desktop.app"
    BINARY_PATH="$APP_PATH/Contents/MacOS/peers_touch_desktop"
    
    if [ ! -f "$BINARY_PATH" ]; then
        log_error "构建失败: 找不到二进制文件"
        exit 1
    fi

    # 每个实例使用独立的数据目录（通过 PEERS_INSTANCE_ID 隔离）
    log_info "启动第一个 Desktop (实例: $USER_A)..."
    PEERS_INSTANCE_ID="$USER_A" "$BINARY_PATH" &
    PID_A=$!
    sleep 3

    log_info "启动第二个 Desktop (实例: $USER_B)..."
    PEERS_INSTANCE_ID="$USER_B" "$BINARY_PATH" &
    PID_B=$!
    
    log_blue "=========================================="
    log_blue "两个 Desktop 实例已启动（数据隔离）"
    log_blue "实例 A ($USER_A) - PID: $PID_A"
    log_blue "实例 B ($USER_B) - PID: $PID_B"
    log_blue ""
    log_blue "每个实例使用独立的数据目录，不会串号。"
    log_blue "首次启动需要手动登录不同账号。"
    log_blue "Ctrl+C 停止所有实例"
    log_blue "=========================================="
    
    # 等待进程结束
    wait
}

# 热重载模式
hot_reload_mode() {
    log_info "=========================================="
    log_info "   热重载模式"
    log_info "   实例1: flutter run (支持热重载, 实例: $USER_A)"
    log_info "   实例2: 静态构建 (实例: $USER_B)"
    log_info "=========================================="

    cd "$DESKTOP_DIR"
    
    log_info "检查依赖..."
    flutter pub get

    # 先构建一次，用于第二个实例
    build_app
    
    APP_PATH="$DESKTOP_DIR/build/macos/Build/Products/Debug/peers_touch_desktop.app"
    BINARY_PATH="$APP_PATH/Contents/MacOS/peers_touch_desktop"
    
    if [ -f "$BINARY_PATH" ]; then
        log_info "启动第二个 Desktop (实例: $USER_B, 静态)..."
        PEERS_INSTANCE_ID="$USER_B" "$BINARY_PATH" &
        sleep 3
    fi

    log_blue "=========================================="
    log_blue "启动第一个 Desktop (实例: $USER_A, 支持热重载)..."
    log_blue "=========================================="
    log_info "热重载快捷键："
    log_info "  r  - Hot reload (仅热重载第一个实例)"
    log_info "  R  - Hot restart"
    log_info "  q  - 退出"
    log_blue "=========================================="
    
    # 启动 flutter run，数据目录通过 PEERS_INSTANCE_ID 隔离
    PEERS_INSTANCE_ID="$USER_A" flutter run -d macos
}

# 默认模式 - 两个静态实例，自动登录
default_mode() {
    build_mode
}

# 捕获退出信号
cleanup() {
    log_info "正在停止所有 Desktop..."
    kill_existing_desktops
    exit 0
}

trap cleanup SIGINT SIGTERM

# 打印帮助
print_help() {
    echo "用法: $0 [选项]"
    echo ""
    echo "说明:"
    echo "  启动两个独立的 Desktop 实例，每个实例使用独立的数据目录。"
    echo "  两个实例的存储完全隔离，可以登录不同账号，不会串号。"
    echo ""
    echo "选项:"
    echo "  (无)       默认模式：两个静态实例"
    echo "  --build    同默认模式"
    echo "  --hot      热重载模式：一个支持 hot reload, 另一个静态"
    echo "  --help     显示帮助"
    echo ""
    echo "环境变量:"
    echo "  PEERS_USER_A=xxx   实例 A 标识 (默认: a)"
    echo "  PEERS_USER_B=xxx   实例 B 标识 (默认: b)"
    echo ""
    echo "测试账号 (来自 station/app/conf/actor.yml):"
    echo "  a@p.t / 1"
    echo "  b@p.t / 1"
    echo "  c@p.t / 1"
}

# 主函数
main() {
    kill_existing_desktops
    
    case "$1" in
        --build)
            build_mode
            ;;
        --hot)
            hot_reload_mode
            ;;
        --help|-h)
            print_help
            ;;
        *)
            default_mode
            ;;
    esac
}

main "$@"
