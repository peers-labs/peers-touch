#!/usr/bin/env bash
# station-dev.sh — Start or verify Station for current worktree profile
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
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

  mkdir -p "$runtime_conf_dir" "$runtime_oss"
  cp "$STATION_DIR"/conf/*.yml "$runtime_conf_dir/"

  RUNTIME_DB="$runtime_db" \
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

  echo "[INFO] Station mode: local source"
  echo "       URL     : $STATION_URL"
  echo "       Config  : $runtime_conf_dir/peers-sqlite.yml"
  echo "       Database: $runtime_db"
  echo "       Log     : $STATION_LOG_FILE"

  (
    cd "$STATION_DIR"
    PEERS_AUTH_SECRET="$(cat "$auth_secret_file")" \
    PEERS_NODE_LABEL="${PT_STATION_NAME:-local}" \
    PEERS_NODE_SERVER_SUBSERVER_OSS_STORE_PATH="$runtime_oss" \
    nohup go run . --config="$runtime_conf_dir/peers-sqlite.yml" \
      >"$STATION_LOG_FILE" 2>&1 &
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

  if ! deploy_env_file="$("$DEPLOY_SCRIPT" resolve "$deploy_env")"; then
    echo "[ERROR] Reviewed deploy env is unavailable for PT_STATION_DEPLOY_ENV=$deploy_env."
    echo "        Referenced by PT_STATION_DEPLOY_ENV=$deploy_env in the active profile."
    exit 1
  fi

  # Host consistency guard: the deploy env's target host must match the
  # profile's PT_STATION_URL host.  Without this check, a stale or
  # cross-profile deploy env silently deploys to the wrong machine.
  deploy_host="$(sed -n 's/^PT_DEPLOY_HOST=//p' "$deploy_env_file" | tail -n 1)"
  profile_host="$(echo "$STATION_URL" | sed -E 's|https?://([^:/]+).*|\1|')"
  if [[ -n "$deploy_host" && -n "$profile_host" && "$deploy_host" != "$profile_host" ]]; then
    echo "[ERROR] Deploy env host mismatch!"
    echo ""
    echo "  Profile PT_STATION_URL host : $profile_host"
    echo "  Deploy env PT_DEPLOY_HOST   : $deploy_host  ($deploy_env_file)"
    echo ""
    echo "  The active profile expects Station at $profile_host,"
    echo "  but deploy env '$deploy_env' would deploy to $deploy_host."
    echo ""
    echo "  Likely causes:"
    echo "    - PT_STATION_DEPLOY_ENV=$deploy_env points to a deploy env owned by another profile"
    echo "    - The deploy env file was overwritten by another worktree or profile activation"
    echo ""
    echo "  Fix: set PT_STATION_DEPLOY_ENV to a deploy env that targets $profile_host,"
    echo "  or update $deploy_env_file to point to $profile_host."
    exit 1
  fi

  branch="${PT_STATION_DEPLOY_BRANCH:-$(git -C "$PROJECT_ROOT" branch --show-current 2>/dev/null || echo main)}"
  echo "[INFO] Station mode: remote ready closure"
  echo "       URL        : $STATION_URL"
  echo "       Deploy env : $deploy_env"
  echo "       Deploy host: $deploy_host"
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
    echo "[OK] Station ready: $STATION_URL"
    exit 0
  fi
  sleep 0.5
done

echo "[ERROR] Station failed to become ready"
echo "[INFO] Log: $STATION_LOG_FILE"
tail -n 20 "$STATION_LOG_FILE" 2>/dev/null || true
exit 1
