#!/bin/bash
# =============================================================================
# dev-full-stack.sh - 启动完整开发环境 (Station + Desktop)
# =============================================================================
# 用法: ./scripts/dev-full-stack.sh [options]
# 选项:
#   --two-desktops    启动两个 Desktop
#   --with-mobile     同时启动 Mobile
#   --station-only    只启动 Station
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_section() {
    echo ""
    echo -e "${BLUE}=========================================="
    echo -e " $1"
    echo -e "==========================================${NC}"
    echo ""
}

# 解析参数
TWO_DESKTOPS=false
WITH_MOBILE=false
STATION_ONLY=false

for arg in "$@"; do
    case $arg in
        --two-desktops)
            TWO_DESKTOPS=true
            ;;
        --with-mobile)
            WITH_MOBILE=true
            ;;
        --station-only)
            STATION_ONLY=true
            ;;
        --help|-h)
            echo "用法: $0 [options]"
            echo ""
            echo "选项:"
            echo "  --two-desktops    启动两个 Desktop (用于调试多客户端)"
            echo "  --with-mobile     同时启动 Mobile"
            echo "  --station-only    只启动 Station 服务端"
            echo "  --help, -h        显示帮助信息"
            exit 0
            ;;
    esac
done

# 主函数
main() {
    log_section "Peers Touch 开发环境启动"

    # 启动 Station (在后台)
    log_info "启动 Station 服务端..."
    "$SCRIPT_DIR/dev-station.sh" &
    STATION_PID=$!
    
    # 等待 Station 启动
    sleep 3

    if [ "$STATION_ONLY" = true ]; then
        log_info "Station 模式，等待服务..."
        wait $STATION_PID
        exit 0
    fi

    # 根据参数启动客户端
    if [ "$TWO_DESKTOPS" = true ]; then
        log_info "启动双 Desktop 模式..."
        "$SCRIPT_DIR/dev-two-desktops.sh"
    elif [ "$WITH_MOBILE" = true ]; then
        log_info "启动 Desktop + Mobile 模式..."
        "$SCRIPT_DIR/dev-desktop-mobile.sh"
    else
        log_info "启动单 Desktop 模式..."
        cd "$SCRIPT_DIR/../client/desktop"
        flutter pub get
        flutter run -d macos
    fi
}

# 清理函数
cleanup() {
    log_info "正在停止所有服务..."
    pkill -f "peers-touch-station" 2>/dev/null || true
    pkill -f "peers_touch_desktop" 2>/dev/null || true
    pkill -f "peers_touch_mobile" 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM

main "$@"
