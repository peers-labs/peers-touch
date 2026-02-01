#!/bin/bash
# =============================================================================
# dev-clean.sh - 清理所有开发进程
# =============================================================================
# 用法: ./scripts/dev-clean.sh
# 终止所有 Peers Touch 相关的开发进程
# =============================================================================

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_info "=========================================="
log_info "    Peers Touch 开发进程清理"
log_info "=========================================="

# 清理 PID 文件
PID_FILES=(
    "/tmp/peers-touch-station.pid"
    "/tmp/peers-touch-desktop.pid"
    "/tmp/peers-touch-desktop-1.pid"
    "/tmp/peers-touch-desktop-2.pid"
    "/tmp/peers-touch-mobile.pid"
)

for PID_FILE in "${PID_FILES[@]}"; do
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE")
        if ps -p "$OLD_PID" > /dev/null 2>&1; then
            log_warn "终止进程 (PID: $OLD_PID)"
            kill "$OLD_PID" 2>/dev/null || true
        fi
        rm -f "$PID_FILE"
    fi
done

# 终止相关进程
log_info "清理 Station 进程..."
pkill -f "peers-touch-station" 2>/dev/null || true

log_info "清理 Desktop 进程..."
pkill -f "peers_touch_desktop" 2>/dev/null || true

log_info "清理 Mobile 进程..."
pkill -f "peers_touch_mobile" 2>/dev/null || true

log_info "清理 Flutter 相关进程..."
pkill -f "flutter_tools" 2>/dev/null || true

log_info "=========================================="
log_info "清理完成"
log_info "=========================================="
