#!/bin/bash
# =============================================================================
# dev-full-stack.sh - 智能启动完整开发环境 (Station + Desktop)
# =============================================================================
# 特性:
#   - 智能检测是否需要编译
#   - 自动清理旧进程
#   - 等待 Station 启动成功后才启动前端
#   - 使用 Flutter 热重载
#   - 完善的错误处理
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STATION_DIR="$PROJECT_ROOT/apps/station/app"
DESKTOP_DIR="$PROJECT_ROOT/apps/desktop"
PID_FILE_STATION="/tmp/peers-touch-station.pid"
PID_FILE_DESKTOP="/tmp/peers-touch-desktop.pid"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_section() {
    echo ""
    echo -e "${BLUE}=========================================="
    echo -e " $1"
    echo -e "==========================================${NC}"
    echo ""
}

# 检查文件是否需要重新编译 (基于修改时间)
needs_compile() {
    local src_dir="$1"
    local binary="$2"
    
    if [ ! -f "$binary" ]; then
        return 0 # 需要编译
    fi
    
    # 检查 Go 源文件是否比二进制新
    local src_newer=$(find "$src_dir" -name "*.go" -type f -newer "$binary" 2>/dev/null | head -1)
    if [ -n "$src_newer" ]; then
        return 0 # 需要编译
    fi
    
    return 1 # 不需要编译
}

# 终止进程
kill_pid() {
    local pid_file="$1"
    local name="$2"
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file" 2>/dev/null)
        if [ -n "$pid" ] && ps -p "$pid" > /dev/null 2>&1; then
            log_warn "终止已存在的 $name 进程 (PID: $pid)"
            kill "$pid" 2>/dev/null || true
            sleep 1
            if ps -p "$pid" > /dev/null 2>&1; then
                kill -9 "$pid" 2>/dev/null || true
            fi
        fi
        rm -f "$pid_file"
    fi
}

# 清理所有旧进程
cleanup() {
    log_info "正在清理所有服务..."
    kill_pid "$PID_FILE_STATION" "Station"
    kill_pid "$PID_FILE_DESKTOP" "Desktop"
    pkill -f "peers-touch-station" 2>/dev/null || true
    pkill -f "peers_touch_desktop" 2>/dev/null || true
}

# 等待 Station 启动并检查是否成功
wait_for_station() {
    local max_attempts=60
    local attempt=0

    log_info "等待 Station 启动..."

    while [ $attempt -lt $max_attempts ]; do
        # 检查 Station 进程是否还在运行
        if [ -f "$PID_FILE_STATION" ]; then
            local station_pid=$(cat "$PID_FILE_STATION" 2>/dev/null)
            if [ -n "$station_pid" ] && ! ps -p "$station_pid" > /dev/null 2>&1; then
                log_error "Station 进程已退出"
                return 1
            fi
        fi

        # 检查端口 18080 是否在监听
        if lsof -ti :18080 >/dev/null 2>&1; then
            log_info "Station 启动成功! 🚀"
            return 0
        fi

        attempt=$((attempt + 1))
        sleep 1
    done

    log_error "Station 启动超时"
    return 1
}

# 启动 Station
start_station() {
    log_section "启动 Station"
    
    kill_pid "$PID_FILE_STATION" "Station"
    
    cd "$STATION_DIR"
    
    # 检查是否需要编译
    local binary="$STATION_DIR/peers-touch-station"
    if needs_compile "$STATION_DIR" "$binary"; then
        log_info "编译 Station..."
        if ! go build -o peers-touch-station .; then
            log_error "Station 编译失败"
            return 1
        fi
        log_info "Station 编译完成 ✓"
    else
        log_info "使用已编译的 Station (无需重新编译)"
    fi
    
    # 设置开发环境变量
    export PEERS_AUTH_SECRET="${PEERS_AUTH_SECRET:-peers-touch-dev-secret-key-2024}"
    
    log_info "启动 Station 服务..."
    ./peers-touch-station &
    echo $! > "$PID_FILE_STATION"
    log_info "Station PID: $(cat "$PID_FILE_STATION")"
    
    # 等待启动成功
    if ! wait_for_station; then
        return 1
    fi
    
    return 0
}

# 启动 Desktop
start_desktop() {
    log_section "启动 Desktop"
    
    kill_pid "$PID_FILE_DESKTOP" "Desktop"
    
    cd "$DESKTOP_DIR"
    
    if [ -f "$DESKTOP_DIR/package.json" ]; then
        log_info "启动 Desktop (Tauri + TypeScript)..."
        if command -v pnpm >/dev/null 2>&1; then
            pnpm dev &
        else
            npm run dev &
        fi
    else
        if [ ! -d ".dart_tool" ] || [ "$DESKTOP_DIR/pubspec.yaml" -nt "$DESKTOP_DIR/.dart_tool/package_config.json" 2>/dev/null ]; then
            log_info "运行 flutter pub get..."
            flutter pub get
        fi
        log_info "启动 Desktop (Flutter)..."
        flutter run -d macos &
    fi
    echo $! > "$PID_FILE_DESKTOP"
    log_info "Desktop PID: $(cat "$PID_FILE_DESKTOP")"
    
    wait
}

# 主函数
main() {
    log_section "Peers Touch 智能开发环境启动"
    
    # 清理
    cleanup
    
    # 启动 Station
    if ! start_station; then
        cleanup
        exit 1
    fi
    
    # 启动 Desktop
    start_desktop
}

trap cleanup SIGINT SIGTERM

main "$@"
