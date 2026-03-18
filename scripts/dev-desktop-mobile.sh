#!/bin/bash
# =============================================================================
# dev-desktop-mobile.sh - 启动一个 Desktop 和一个 Mobile 客户端
# =============================================================================
# 用法: ./scripts/dev-desktop-mobile.sh
# 用于调试桌面端与移动端的交互场景
# 重复执行会自动终止旧进程并重启
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/client/desktop"
MOBILE_DIR="$PROJECT_ROOT/client/mobile"
PID_FILE_DESKTOP="/tmp/peers-touch-desktop.pid"
PID_FILE_MOBILE="/tmp/peers-touch-mobile.pid"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_blue() {
    echo -e "${BLUE}[DESKTOP]${NC} $1"
}

log_purple() {
    echo -e "${PURPLE}[MOBILE]${NC} $1"
}

# 检查可用的模拟器/设备
list_devices() {
    log_info "可用设备列表:"
    flutter devices
}

# 终止已存在的进程
kill_existing() {
    for PID_FILE in "$PID_FILE_DESKTOP" "$PID_FILE_MOBILE"; do
        if [ -f "$PID_FILE" ]; then
            OLD_PID=$(cat "$PID_FILE")
            if ps -p "$OLD_PID" > /dev/null 2>&1; then
                log_warn "终止已存在的进程 (PID: $OLD_PID)"
                kill "$OLD_PID" 2>/dev/null || true
            fi
            rm -f "$PID_FILE"
        fi
    done

    # 查找并终止相关进程
    pkill -f "peers_touch_desktop" 2>/dev/null || true
    pkill -f "peers_touch_mobile" 2>/dev/null || true
    sleep 1
}

# 启动 iOS 模拟器 (如果没有运行)
start_ios_simulator() {
    log_info "检查 iOS 模拟器..."
    
    # 检查是否有模拟器在运行
    if ! xcrun simctl list devices | grep -q "Booted"; then
        log_info "启动 iOS 模拟器..."
        # 启动默认的 iPhone 模拟器
        open -a Simulator
        sleep 5
    else
        log_info "iOS 模拟器已在运行"
    fi
}

# 主函数
main() {
    log_info "=========================================="
    log_info "  Peers Touch Desktop + Mobile 启动脚本"
    log_info "=========================================="

    kill_existing

    # 列出可用设备
    list_devices

    # 获取设备
    MACOS_DEVICE=$(flutter devices | grep -i "macos" | head -1 | awk '{print $1}' || echo "macos")
    IOS_DEVICE=$(flutter devices | grep -i "iphone\|ios\|simulator" | head -1 | awk '{print $1}' || echo "")

    if [ -z "$IOS_DEVICE" ]; then
        log_warn "未检测到 iOS 设备/模拟器，尝试启动模拟器..."
        start_ios_simulator
        sleep 3
        IOS_DEVICE=$(flutter devices | grep -i "iphone\|ios\|simulator" | head -1 | awk '{print $1}' || echo "")
    fi

    if [ -z "$IOS_DEVICE" ]; then
        log_warn "仍未检测到 iOS 设备，将只启动 Desktop"
    fi

    # 启动 Desktop
    log_blue "启动 Desktop..."
    cd "$DESKTOP_DIR"
    flutter pub get
    flutter run -d macos &
    DESKTOP_PID=$!
    echo $DESKTOP_PID > "$PID_FILE_DESKTOP"
    log_blue "Desktop 已启动 (PID: $DESKTOP_PID)"

    # 等待 Desktop 初始化
    sleep 3

    # 启动 Mobile (如果有设备)
    if [ -n "$IOS_DEVICE" ]; then
        log_purple "启动 Mobile (iOS)..."
        cd "$MOBILE_DIR"
        flutter pub get
        flutter run -d "$IOS_DEVICE" &
        MOBILE_PID=$!
        echo $MOBILE_PID > "$PID_FILE_MOBILE"
        log_purple "Mobile 已启动 (PID: $MOBILE_PID, Device: $IOS_DEVICE)"
    fi

    log_info "=========================================="
    log_info "客户端已启动"
    log_blue "Desktop PID: $DESKTOP_PID"
    if [ -n "$MOBILE_PID" ]; then
        log_purple "Mobile PID: $MOBILE_PID"
    fi
    log_info "=========================================="
    log_info "按 Ctrl+C 停止所有客户端"

    # 等待任一进程结束
    wait
}

# 捕获退出信号
cleanup() {
    log_info "正在停止所有客户端..."
    kill_existing
    exit 0
}

trap cleanup SIGINT SIGTERM

main "$@"
