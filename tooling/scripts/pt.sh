#!/usr/bin/env bash
set -euo pipefail

TASK="${1:-}"
DOMAIN="${2:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

assert_tool() {
  local name="$1"
  command -v "$name" >/dev/null 2>&1 || { echo "$name 未安装或不在 PATH 中"; exit 1; }
}

run_in_dir() {
  local path="$1"
  local cmd="$2"
  (cd "$path" && eval "$cmd")
}

run_station_task() {
  local task_name="$1"
  local path="$ROOT_DIR/station/app"
  case "$task_name" in
    lint) run_in_dir "$path" "go vet ./..." ;;
    test) run_in_dir "$path" "go test ./..." ;;
    build) run_in_dir "$path" "go build ./..." ;;
    gen) echo "station 无独立代码生成任务" ;;
    *) echo "station 不支持任务: $task_name"; exit 1 ;;
  esac
}

run_desktop_task() {
  local task_name="$1"
  local path="$ROOT_DIR/desktop"
  case "$task_name" in
    lint) run_in_dir "$path" "npm run typecheck" ;;
    test) run_in_dir "$path" "npm run test" ;;
    build) run_in_dir "$path" "npm run build" ;;
    gen) echo "desktop 无独立代码生成任务" ;;
    *) echo "desktop 不支持任务: $task_name"; exit 1 ;;
  esac
}

run_mobile_task() {
  local task_name="$1"
  local path="$ROOT_DIR/client/mobile"
  case "$task_name" in
    lint) run_in_dir "$path" "flutter analyze" ;;
    test) run_in_dir "$path" "flutter test" ;;
    build) run_in_dir "$path" "flutter build apk --debug" ;;
    gen) echo "mobile 无独立代码生成任务" ;;
    *) echo "mobile 不支持任务: $task_name"; exit 1 ;;
  esac
}

case "$TASK" in
  list)
    echo "可用任务: list, doctor, lint, test, build, gen"
    echo "可用领域: station, desktop, mobile"
    exit 0
    ;;
  doctor)
    assert_tool go
    assert_tool npm
    assert_tool cargo
    assert_tool flutter
    echo "工具链检查通过"
    exit 0
    ;;
esac

if [[ -z "$DOMAIN" ]]; then
  echo "请提供领域名称: station | desktop | mobile"
  exit 1
fi

case "$DOMAIN" in
  station) run_station_task "$TASK" ;;
  desktop) run_desktop_task "$TASK" ;;
  mobile) run_mobile_task "$TASK" ;;
  *) echo "未知领域: $DOMAIN"; exit 1 ;;
esac
