#!/bin/bash
# =============================================================================
# dev-station.sh - 启动 Station 服务端
# =============================================================================
# 用法: ./scripts/dev-station.sh
# 重复执行会自动终止旧进程并重启
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STATION_DIR="$PROJECT_ROOT/station/app"
PID_FILE="/tmp/peers-touch-station.pid"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 终止已存在的进程
kill_existing() {
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE")
        if ps -p "$OLD_PID" > /dev/null 2>&1; then
            log_warn "终止已存在的 Station 进程 (PID: $OLD_PID)"
            kill "$OLD_PID" 2>/dev/null || true
            sleep 1
            # 强制终止
            if ps -p "$OLD_PID" > /dev/null 2>&1; then
                kill -9 "$OLD_PID" 2>/dev/null || true
            fi
        fi
        rm -f "$PID_FILE"
    fi

    # 查找并终止其他可能的 station 进程
    pkill -f "peers-touch-station" 2>/dev/null || true
}

# 主函数
main() {
    log_info "=========================================="
    log_info "     Peers Touch Station 启动脚本"
    log_info "=========================================="

    kill_existing

    cd "$STATION_DIR"

    log_info "编译 Station..."
    go build -o peers-touch-station .

    log_info "启动 Station 服务..."
    ./peers-touch-station &
    echo $! > "$PID_FILE"

    log_info "Station 已启动 (PID: $(cat $PID_FILE))"
    log_info "日志输出在当前终端"
    log_info "按 Ctrl+C 停止服务"

    # 等待进程
    wait
}

# 捕获退出信号
trap 'log_info "正在停止 Station..."; kill_existing; exit 0' SIGINT SIGTERM

main "$@"
