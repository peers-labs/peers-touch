#!/bin/bash
# =============================================================================
# dev-station.sh - 启动 Station 服务端
# =============================================================================
# 用法: ./scripts/dev-station.sh
# 重复执行会自动终止旧进程并重启
# 自动检测并使用合适的 Go 版本
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STATION_DIR="$PROJECT_ROOT/station/app"
PID_FILE="/tmp/peers-touch-station.pid"
REQUIRED_GO_MAJOR=1
REQUIRED_GO_MINOR=23

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

# 检查版本是否满足要求
version_ok() {
    local version=$1
    local major=$(echo "$version" | cut -d. -f1)
    local minor=$(echo "$version" | cut -d. -f2)
    
    if [ "$major" -gt "$REQUIRED_GO_MAJOR" ]; then
        return 0
    elif [ "$major" -eq "$REQUIRED_GO_MAJOR" ] && [ "$minor" -ge "$REQUIRED_GO_MINOR" ]; then
        return 0
    fi
    return 1
}

# 自动选择合适的 Go 版本
setup_go_version() {
    # 检查当前 Go 版本
    local current_version=$(go version 2>/dev/null | grep -oE 'go[0-9]+\.[0-9]+' | sed 's/go//' || echo "0.0")
    
    if version_ok "$current_version"; then
        log_info "当前 Go 版本: $current_version ✓"
        return 0
    fi

    log_warn "当前 Go 版本 $current_version 过低，需要 >= $REQUIRED_GO_MAJOR.$REQUIRED_GO_MINOR"

    # 检查 goenv 目录是否存在
    local GOENV_ROOT="${GOENV_ROOT:-$HOME/.goenv}"
    if [ ! -d "$GOENV_ROOT/versions" ]; then
        log_error "未找到 goenv 版本目录: $GOENV_ROOT/versions"
        log_error "请安装 Go >= $REQUIRED_GO_MAJOR.$REQUIRED_GO_MINOR"
        exit 1
    fi

    # 查找满足要求的最高版本
    local best_version=""
    for dir in "$GOENV_ROOT/versions"/*; do
        if [ -d "$dir" ]; then
            local version=$(basename "$dir")
            # 跳过非版本目录
            if [[ ! "$version" =~ ^[0-9]+\.[0-9]+ ]]; then
                continue
            fi
            if version_ok "$version"; then
                best_version="$version"
            fi
        fi
    done

    if [ -n "$best_version" ]; then
        log_info "切换到 Go $best_version..."
        
        # 直接修改 PATH 指向正确版本
        export GOROOT="$GOENV_ROOT/versions/$best_version"
        export PATH="$GOROOT/bin:$PATH"
        
        # 验证切换成功
        local new_version=$(go version | grep -oE 'go[0-9]+\.[0-9]+' | sed 's/go//')
        if version_ok "$new_version"; then
            log_info "已切换到 Go $new_version ✓"
            return 0
        else
            log_error "版本切换失败"
            exit 1
        fi
    else
        log_error "未找到 >= $REQUIRED_GO_MAJOR.$REQUIRED_GO_MINOR 的 Go 版本"
        log_error "已安装的版本:"
        ls -1 "$GOENV_ROOT/versions" 2>/dev/null || echo "  (无)"
        log_error "请安装: goenv install 1.23.3"
        exit 1
    fi
}

# 终止已存在的进程
kill_existing() {
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE")
        if ps -p "$OLD_PID" > /dev/null 2>&1; then
            log_warn "终止已存在的 Station 进程 (PID: $OLD_PID)"
            kill "$OLD_PID" 2>/dev/null || true
            sleep 1
            if ps -p "$OLD_PID" > /dev/null 2>&1; then
                kill -9 "$OLD_PID" 2>/dev/null || true
            fi
        fi
        rm -f "$PID_FILE"
    fi

    pkill -f "peers-touch-station" 2>/dev/null || true
}

# 主函数
main() {
    log_info "=========================================="
    log_info "     Peers Touch Station 启动脚本"
    log_info "=========================================="

    setup_go_version
    kill_existing

    cd "$STATION_DIR"

    # 设置开发环境变量
    export PEERS_AUTH_SECRET="${PEERS_AUTH_SECRET:-peers-touch-dev-secret-key-2024}"
    log_info "环境变量已设置"

    log_info "编译 Station..."
    if ! go build -o peers-touch-station .; then
        log_error "编译失败"
        exit 1
    fi

    log_info "启动 Station 服务..."
    ./peers-touch-station &
    echo $! > "$PID_FILE"

    log_info "Station 已启动 (PID: $(cat $PID_FILE))"
    log_info "日志输出在当前终端"
    log_info "按 Ctrl+C 停止服务"

    wait
}

trap 'log_info "正在停止 Station..."; kill_existing; exit 0' SIGINT SIGTERM

main "$@"
