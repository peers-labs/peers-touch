#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# deploy.sh — Remote deployment via pull model
#
# Source modes (PT_DEPLOY_SOURCE):
#   direct  — Push to the target's external source repository via SSH
#   central — Push to central bare repo, remote fetches from it (recommended)
#   local   — Remote fetches from local git daemon via SSH reverse tunnel
#   github  — Remote fetches from GitHub origin
#
# Usage:
#   deploy.sh <env-name> [BRANCH=main]
#   deploy.sh status <env-name>
#   deploy.sh logs <env-name>
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENVS_DIR="$PROJECT_ROOT/.local/deploy/envs"
SOURCE_SYNC_SCRIPT="$SCRIPT_DIR/source-sync.sh"

cmd="${1:-}"
env_name="${2:-$cmd}"

if [[ "$cmd" == "status" || "$cmd" == "logs" ]]; then
  env_name="${2:-}"
  if [[ -z "$env_name" ]]; then
    echo "[ERROR] Usage: deploy.sh $cmd <env-name>"
    exit 1
  fi
else
  env_name="$cmd"
fi

if [[ -z "$env_name" ]]; then
  echo "[ERROR] Usage: deploy.sh <env-name> [BRANCH=main]"
  echo ""
  echo "Available envs:"
  if ls "$ENVS_DIR"/*.env >/dev/null 2>&1; then
    for f in "$ENVS_DIR"/*.env; do
      echo "  $(basename "$f" .env)"
    done
  else
    echo "  (none)"
  fi
  exit 1
fi

ENV_FILE="$ENVS_DIR/$env_name.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ERROR] Env file not found: $ENV_FILE"
  exit 1
fi

if [[ "$cmd" != "status" && "$cmd" != "logs" && "${PT_PROFILE_LEASE_HELD:-0}" != "1" ]]; then
  cd "$PROJECT_ROOT"
  exec env PT_PROFILE_LEASE_HELD=1 \
    python3 -c 'from tooling.acceptance.core.lease import main; raise SystemExit(main())' \
      --resource "$env_name" \
      --owner "deploy:$env_name:${BRANCH:-default}" \
      -- /bin/bash "$SCRIPT_DIR/deploy.sh" "$@"
fi

# Load deploy env
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${PT_DEPLOY_HOST:?PT_DEPLOY_HOST not set in $ENV_FILE}"
: "${PT_DEPLOY_USER:?PT_DEPLOY_USER not set in $ENV_FILE}"
: "${PT_DEPLOY_PATH:?PT_DEPLOY_PATH not set in $ENV_FILE}"
: "${PT_DEPLOY_ROLE:?PT_DEPLOY_ROLE not set in $ENV_FILE}"

BRANCH="${BRANCH:-${PT_DEPLOY_BRANCH:-main}}"
SSH_TARGET="${PT_DEPLOY_USER}@${PT_DEPLOY_HOST}"
SSH_OPTS=(
  -o BatchMode=yes
  -o ConnectTimeout=10
  -o ConnectionAttempts=1
  -o StrictHostKeyChecking=yes
  -p "${PT_DEPLOY_SSH_PORT:-22}"
)
if [[ -n "${PT_DEPLOY_KNOWN_HOSTS_FILE:-}" ]]; then
  SSH_OPTS+=(-o "UserKnownHostsFile=$PT_DEPLOY_KNOWN_HOSTS_FILE")
fi

ssh_run() {
  # shellcheck disable=SC2029 # Callers intentionally provide the remote command.
  ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@"
}

case "$cmd" in
  status)
    echo "[$env_name] Checking status on $SSH_TARGET ..."
    ssh_run "cd \$HOME/$PT_DEPLOY_PATH && git log --oneline -1 2>/dev/null || echo 'no git repo'"
    if [[ -n "${PT_DEPLOY_HEALTH_URL:-}" ]]; then
      if curl -fsS -m 3 "$PT_DEPLOY_HEALTH_URL" >/dev/null 2>&1; then
        echo "[OK] Health: $PT_DEPLOY_HEALTH_URL"
      else
        echo "[WARN] Health check failed: $PT_DEPLOY_HEALTH_URL"
      fi
    fi
    ;;

  logs)
    echo "[$env_name] Fetching logs from $SSH_TARGET ..."
    ssh_run "cd \$HOME/$PT_DEPLOY_PATH && tail -n 50 .local/dev/logs/${PT_DEPLOY_ROLE}.log 2>/dev/null || docker compose -p pt-${PT_DEPLOY_ROLE}-c logs --tail=50 ${PT_DEPLOY_ROLE} 2>/dev/null || echo 'No logs found'"
    ;;

  *)
    # ═══ Deploy ═══

    if [[ "${PT_SOURCE_LEASE_HELD:-0}" != "1" ]]; then
      echo "[0/4] Synchronizing exact Git source ..."
      exec /bin/bash "$SOURCE_SYNC_SCRIPT" \
        "$env_name" \
        --branch "$BRANCH" \
        -- \
        /bin/bash "$SCRIPT_DIR/deploy.sh" "$@"
    fi

    echo ""
    echo "═══════════════════════════════════════════════"
    echo "  Deploying: $env_name"
    echo "  Host:      $SSH_TARGET"
    echo "  Path:      \$HOME/$PT_DEPLOY_PATH"
    echo "  Branch:    $BRANCH"
    echo "  Role:      $PT_DEPLOY_ROLE"
    echo "  Source:    exact Git commit via source-sync"
    echo "═══════════════════════════════════════════════"
    echo ""

    echo "[1/4] Verifying synchronized source ..."
    ssh_run "git -C \$HOME/$PT_DEPLOY_PATH log --oneline -1"

    echo "[2/4] Building ..."
    if [[ -n "${PT_DEPLOY_BUILD_CMD:-}" ]]; then
      ssh_run "cd \$HOME/$PT_DEPLOY_PATH && PEERS_TOUCH_BUILD_COMMIT=\$(git rev-parse --short=12 HEAD) PEERS_TOUCH_BUILD_LABEL=$BRANCH PEERS_TOUCH_BUILD_TIME=\$(date -u +%Y-%m-%dT%H:%M:%SZ) $PT_DEPLOY_BUILD_CMD"
    else
      case "$PT_DEPLOY_ROLE" in
        station)
          ssh_run "CACHE_ROOT=\$HOME/.cache/peers-touch/build/$env_name && mkdir -p \$CACHE_ROOT/go/mod \$CACHE_ROOT/go/build \$HOME/$PT_DEPLOY_PATH/apps/station/app/bin && cd \$HOME/$PT_DEPLOY_PATH/apps/station/app && GOMODCACHE=\$CACHE_ROOT/go/mod GOCACHE=\$CACHE_ROOT/go/build go build -o bin/station ."
          ;;
        relay)
          ssh_run "CACHE_ROOT=\$HOME/.cache/peers-touch/build/$env_name && mkdir -p \$CACHE_ROOT/go/mod \$CACHE_ROOT/go/build && cd \$HOME/$PT_DEPLOY_PATH && GOMODCACHE=\$CACHE_ROOT/go/mod GOCACHE=\$CACHE_ROOT/go/build make build-relay"
          ;;
        *)
          ssh_run "cd \$HOME/$PT_DEPLOY_PATH && make build"
          ;;
      esac
    fi

    echo "[3/4] Restarting $PT_DEPLOY_ROLE ..."
    if [[ -n "${PT_DEPLOY_RESTART_CMD:-}" ]]; then
      ssh_run "cd \$HOME/$PT_DEPLOY_PATH && $PT_DEPLOY_RESTART_CMD"
    else
      ssh_run "cd \$HOME/$PT_DEPLOY_PATH && systemctl --user restart peers-${PT_DEPLOY_ROLE}"
    fi

    echo "[4/4] Health check ..."
    sleep 2
    if [[ -n "${PT_DEPLOY_HEALTH_URL:-}" ]]; then
      if ssh_run "for i in \$(seq 1 30); do curl -fsS -m 3 $PT_DEPLOY_HEALTH_URL >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1"; then
        echo ""
        echo "[OK] Deploy complete: $env_name ($PT_DEPLOY_ROLE @ $PT_DEPLOY_HOST)"
      else
        echo ""
        echo "[ERROR] Deploy done but health check failed: $PT_DEPLOY_HEALTH_URL"
        exit 1
      fi
    else
      echo "[WARN] No PT_DEPLOY_HEALTH_URL configured — skipping health check"
      echo "[OK] Deploy complete: $env_name (unverified)"
    fi
    ;;
esac
