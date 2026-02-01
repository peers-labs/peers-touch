#!/bin/bash
# =============================================================================
# dev-two-desktops.sh - 启动两个 Desktop 客户端
# =============================================================================
# 用法: ./scripts/dev-two-desktops.sh
# 用于调试多客户端交互场景
# 重复执行会自动终止旧进程并重启
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/client/desktop"
PID_FILE_1="/tmp/peers-touch-desktop-1.pid"
PID_FILE_2="/tmp/peers-touch-desktop-2.pid"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_blue() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# 终止已存在的 Desktop 进程
kill_existing_desktops() {
    for PID_FILE in "$PID_FILE_1" "$PID_FILE_2"; do
        if [ -f "$PID_FILE" ]; then
            OLD_PID=$(cat "$PID_FILE")
            if ps -p "$OLD_PID" > /dev/null 2>&1; then
                log_warn "终止已存在的 Desktop 进程 (PID: $OLD_PID)"
                kill "$OLD_PID" 2>/dev/null || true
            fi
            rm -f "$PID_FILE"
        fi
    done

    # 查找并终止 Flutter Desktop 进程
    pkill -f "peers_touch_desktop" 2>/dev/null || true
    sleep 1
}

# 启动单个 Desktop
start_desktop() {
    local INSTANCE_NUM=$1
    local PID_FILE=$2

    log_info "启动 Desktop $INSTANCE_NUM..."

    cd "$DESKTOP_DIR"

    # 使用不同的端口/配置启动
    # Flutter Desktop 默认会使用不同的 VM service 端口
    flutter run -d macos &
    echo $! > "$PID_FILE"

    log_info "Desktop $INSTANCE_NUM 已启动 (PID: $(cat $PID_FILE))"
}

# 主函数
main() {
    log_info "=========================================="
    log_info "   Peers Touch 双 Desktop 启动脚本"
    log_info "=========================================="

    kill_existing_desktops

    cd "$DESKTOP_DIR"

    log_info "检查依赖..."
    flutter pub get

    log_info "启动第一个 Desktop..."
    flutter run -d macos &
    DESKTOP_1_PID=$!
    echo $DESKTOP_1_PID > "$PID_FILE_1"
    log_info "Desktop 1 已启动 (PID: $DESKTOP_1_PID)"

    # 等待第一个完成初始化
    sleep 5

    log_info "启动第二个 Desktop..."
    # 使用不同的 observatory 端口
    flutter run -d macos --observatory-port=8182 &
    DESKTOP_2_PID=$!
    echo $DESKTOP_2_PID > "$PID_FILE_2"
    log_info "Desktop 2 已启动 (PID: $DESKTOP_2_PID)"

    log_blue "=========================================="
    log_blue "两个 Desktop 客户端已启动"
    log_blue "Desktop 1 PID: $DESKTOP_1_PID"
    log_blue "Desktop 2 PID: $DESKTOP_2_PID"
    log_blue "=========================================="
    log_info "按 Ctrl+C 停止所有客户端"

    # 等待任一进程结束
    wait
}

# 捕获退出信号
cleanup() {
    log_info "正在停止所有 Desktop..."
    kill_existing_desktops
    exit 0
}

trap cleanup SIGINT SIGTERM

main "$@"
