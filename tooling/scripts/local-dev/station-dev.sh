#!/usr/bin/env bash
# station-dev.sh — Start or verify Station for current worktree profile
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

STATION_DIR="$PROJECT_ROOT/apps/station/app"
STATION_PID_FILE="$PT_DEV_PIDS/station.pid"
STATION_LOG_FILE="$PT_DEV_LOGS/station.log"
STATION_URL="${PT_STATION_URL:-http://127.0.0.1:18080}"
STATION_PORT="${PT_STATION_PORT:-18080}"
STATION_MODE="${PT_STATION_MODE:-local}"
STATION_CHECK_URL="$STATION_URL/api/oauth/providers"
DEPLOY_SCRIPT="$PROJECT_ROOT/tooling/scripts/deploy/deploy.sh"
COMPOSE_FILE="$PROJECT_ROOT/tooling/docker/compose.yml"
COMPOSE_ENV_FILE="${PT_STATION_COMPOSE_ENV_FILE:-$PROJECT_ROOT/tooling/docker/.env}"
COMPOSE_PROJECT_NAME_VALUE="${PT_STATION_COMPOSE_PROJECT:-pt-${PT_DEV_PROFILE}}"

station_is_ready() {
  curl -fsS -m 2 "$STATION_CHECK_URL" >/dev/null 2>&1
}

compose_env() {
  COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME_VALUE" \
  STATION_PORT="$STATION_PORT" \
  POSTGRES_DB="${PT_STATION_DB_NAME:-peers_touch}" \
  PEERS_NODE_LABEL="${PT_STATION_NAME:-local}" \
  "$@"
}

start_compose_station() {
  if [[ ! -f "$COMPOSE_ENV_FILE" ]]; then
    echo "[ERROR] Compose env file not found: $COMPOSE_ENV_FILE"
    echo "        Run: make config"
    exit 1
  fi

  local build_flag=""
  local image_name="${COMPOSE_PROJECT_NAME_VALUE}-station"
  if ! docker image inspect "$image_name" >/dev/null 2>&1; then
    build_flag="--build"
  fi

  echo "[INFO] Station mode: compose-managed local closure"
  echo "       URL        : $STATION_URL"
  echo "       Project    : $COMPOSE_PROJECT_NAME_VALUE"
  echo "       Compose    : $COMPOSE_FILE"
  echo "       Env        : $COMPOSE_ENV_FILE"
  echo "       Postgres DB: ${PT_STATION_DB_NAME:-peers_touch}"
  if [[ -n "$build_flag" ]]; then
    echo "       Build      : yes (image not cached)"
  else
    echo "       Build      : no (image cached, use 'make docker-station' to rebuild)"
  fi
  compose_env docker compose \
    -f "$COMPOSE_FILE" \
    --env-file "$COMPOSE_ENV_FILE" \
    --profile infra \
    --profile station \
    up -d $build_flag postgres station
}

start_source_station() {
  local runtime_conf_dir="$PT_DEV_DATA/station-conf"
  local runtime_db="$PT_DEV_DATA/station.db"
  local runtime_identity="./data/${PT_DEV_PROFILE}-libp2p.key"
  local runtime_oss="$PT_DEV_DATA/oss"
  local auth_secret_file="$PT_DEV_DATA/auth-secret"
  local storage_root="$PT_DEV_DATA/station-runtime"
  local runtime_binary="$PT_DEV_DATA/station"
  local runtime_config="$runtime_conf_dir/peers-sqlite.yml"
  local native_runtime_db="$runtime_db"
  local native_runtime_config="$runtime_config"
  local native_storage_root="$storage_root"
  local windows_native=0
  local build_commit
  local build_time

  build_commit="$(git -C "$PROJECT_ROOT" rev-parse HEAD)"
  build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  mkdir -p "$runtime_conf_dir" "$runtime_oss" "$STATION_DIR/data" \
    "$storage_root/config" "$storage_root/data" "$storage_root/cache" \
    "$storage_root/logs" "$storage_root/run" "$storage_root/temp"
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      windows_native=1
      runtime_binary="${runtime_binary}.exe"
      native_runtime_db="$(cygpath -m "$runtime_db")"
      native_runtime_config="$(cygpath -w "$runtime_config")"
      native_storage_root="$(cygpath -m "$storage_root")"
      ;;
  esac
  cp "$STATION_DIR"/conf/*.yml "$runtime_conf_dir/"

  RUNTIME_DB="$native_runtime_db" \
  RUNTIME_IDENTITY="$runtime_identity" \
  RUNTIME_PORT="$STATION_PORT" \
  RUNTIME_BASE_URL="$STATION_URL" \
  perl -pi -e '
    s#/tmp/peers-touch-local\.db#$ENV{RUNTIME_DB}#g;
    s#\./data/libp2p\.key#$ENV{RUNTIME_IDENTITY}#g;
    s#address: :18080#address: :$ENV{RUNTIME_PORT}#g;
    s#http://127\.0\.0\.1:18080#$ENV{RUNTIME_BASE_URL}#g;
  ' "$runtime_conf_dir"/*.yml

  if [[ ! -s "$auth_secret_file" ]]; then
    umask 077
    openssl rand -hex 32 > "$auth_secret_file"
  fi

  (
    cd "$STATION_DIR"
    go build -o "$runtime_binary" .
  )

  echo "[INFO] Station mode: local source"
  echo "       URL     : $STATION_URL"
  echo "       Config  : $runtime_config"
  echo "       Database: $runtime_db"
  echo "       Log     : $STATION_LOG_FILE"

  (
    cd "$STATION_DIR"
    export PEERS_AUTH_SECRET="$(cat "$auth_secret_file")"
    export PEERS_PROFILE="$PT_DEV_PROFILE"
    export PEERS_CONFIG_DIR="$native_storage_root/config"
    export PEERS_DATA_DIR="$native_storage_root/data"
    export PEERS_CACHE_DIR="$native_storage_root/cache"
    export PEERS_LOGS_DIR="$native_storage_root/logs"
    export PEERS_RUNTIME_DIR="$native_storage_root/run"
    export PEERS_TEMP_DIR="$native_storage_root/temp"
    export PEERS_TOUCH_BUILD_COMMIT="$build_commit"
    export PEERS_TOUCH_BUILD_LABEL="local-${PT_DEV_PROFILE}"
    export PEERS_TOUCH_BUILD_TIME="$build_time"
    export PEERS_NODE_LABEL="${PT_STATION_NAME:-local}"
    export PEERS_NODE_SERVER_SUBSERVER_OSS_STORE_PATH="$runtime_oss"
    if [[ "$windows_native" -eq 1 ]]; then
      "$runtime_binary" --config="$native_runtime_config" \
        >"$STATION_LOG_FILE" 2>&1 &
    else
      nohup "$runtime_binary" --config="$native_runtime_config" \
        >"$STATION_LOG_FILE" 2>&1 &
    fi
    echo $! > "$STATION_PID_FILE"
  )
}

if [[ "$STATION_MODE" == "remote" ]]; then
  skip_deploy="${PT_STATION_SKIP_DEPLOY:-false}"

  if [[ "$skip_deploy" == "true" ]]; then
    if station_is_ready; then
      echo "[OK] Remote Station already ready (deploy skipped): $STATION_URL"
      exit 0
    fi
    echo "[WARN] PT_STATION_SKIP_DEPLOY=true but Station not reachable: $STATION_URL"
  fi

  deploy_env="${PT_STATION_DEPLOY_ENV:-}"
  if [[ -z "$deploy_env" ]]; then
    echo "[ERROR] Station mode is remote, but PT_STATION_DEPLOY_ENV is not set."
    echo "        make station now means: deploy/restart/check remote Station."
    echo "        Set it in the active profile, for example:"
    echo "          PT_STATION_DEPLOY_ENV=station-1"
    echo ""
    echo "        If you only want a health probe, run:"
    echo "          make station-check"
    exit 1
  fi

  branch="${PT_STATION_DEPLOY_BRANCH:-$(git -C "$PROJECT_ROOT" branch --show-current 2>/dev/null || echo main)}"
  echo "[INFO] Station mode: remote ready closure"
  echo "       URL        : $STATION_URL"
  echo "       Deploy env : $deploy_env"
  echo "       Branch     : $branch"
  echo ""

  BRANCH="$branch" /bin/bash "$DEPLOY_SCRIPT" "$deploy_env"
  /bin/bash "$SCRIPT_DIR/station-check.sh"
  echo "[OK] Remote Station ready: $STATION_URL"
  exit 0
fi

if station_is_ready; then
  echo "[INFO] Station already running: $STATION_URL"
  exit 0
fi

if [[ ! -d "$STATION_DIR" ]]; then
  echo "[ERROR] Station dir not found: $STATION_DIR"
  exit 1
fi

# Kill stale PID
if [[ -f "$STATION_PID_FILE" ]]; then
  old_pid="$(cat "$STATION_PID_FILE" 2>/dev/null || true)"
  if [[ -n "${old_pid:-}" ]] && ps -p "$old_pid" >/dev/null 2>&1; then
    echo "[INFO] Station process exists but not ready: $old_pid"
  else
    rm -f "$STATION_PID_FILE"
  fi
fi

case "$STATION_MODE" in
  local)
    start_source_station
    ;;
  compose)
    start_compose_station
    ;;
  *)
    echo "[ERROR] Unsupported PT_STATION_MODE: $STATION_MODE"
    echo "        Expected one of: local, compose, remote"
    exit 1
    ;;
esac

# Wait
for _ in {1..120}; do
  if station_is_ready; then
    case "$(uname -s)" in
      MINGW*|MSYS*|CYGWIN*)
        powershell="/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
        native_pid="$(
          "$powershell" -NoProfile -Command \
            "(Get-NetTCPConnection -State Listen -LocalPort $STATION_PORT).OwningProcess" |
            tr -d '\r' |
            tail -n 1
        )"
        if [[ ! "$native_pid" =~ ^[0-9]+$ ]]; then
          echo "[ERROR] Could not resolve native Station PID on port $STATION_PORT"
          exit 1
        fi
        echo "$native_pid" > "$STATION_PID_FILE"
        ;;
    esac
    echo "[OK] Station ready: $STATION_URL"
    exit 0
  fi
  sleep 0.5
done

echo "[ERROR] Station failed to become ready"
echo "[INFO] Log: $STATION_LOG_FILE"
tail -n 20 "$STATION_LOG_FILE" 2>/dev/null || true
exit 1
