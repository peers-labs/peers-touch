#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# deploy.sh — Remote deployment via pull model
#
# Two source modes:
#   local  — Remote fetches from local git daemon (LAN, no push needed)
#   github — Remote fetches from GitHub origin (classic)
#
# Source is configured per env via PT_DEPLOY_SOURCE (default: local).
# If local git daemon is not reachable, falls back to github automatically.
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

cmd="${1:-}"
env_name="${2:-$cmd}"

# If first arg is status/logs, shift
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
    echo ""
    echo "  Create one at: $ENVS_DIR/<name>.env"
    echo "  Required vars: PT_DEPLOY_HOST, PT_DEPLOY_USER, PT_DEPLOY_PATH, PT_DEPLOY_ROLE"
    echo "  Optional:      PT_DEPLOY_SOURCE (local|github, default: local)"
  fi
  exit 1
fi

ENV_FILE="$ENVS_DIR/$env_name.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ERROR] Env file not found: $ENV_FILE"
  exit 1
fi

# Load env
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${PT_DEPLOY_HOST:?PT_DEPLOY_HOST not set in $ENV_FILE}"
: "${PT_DEPLOY_USER:?PT_DEPLOY_USER not set in $ENV_FILE}"
: "${PT_DEPLOY_PATH:?PT_DEPLOY_PATH not set in $ENV_FILE}"
: "${PT_DEPLOY_ROLE:?PT_DEPLOY_ROLE not set in $ENV_FILE}"

BRANCH="${BRANCH:-${PT_DEPLOY_BRANCH:-main}}"
SOURCE="${PT_DEPLOY_SOURCE:-local}"
GIT_PORT="${PT_GIT_SERVE_PORT:-9418}"
SSH_TARGET="${PT_DEPLOY_USER}@${PT_DEPLOY_HOST}"
SSH_OPTS="-o ConnectTimeout=10 -o StrictHostKeyChecking=no"

ssh_run() {
  # shellcheck disable=SC2086
  ssh $SSH_OPTS "$SSH_TARGET" "$@"
}

# Detect local IP
local_ip() {
  ipconfig getifaddr en0 2>/dev/null || \
  ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || \
  echo "127.0.0.1"
}

# Ensure local git daemon is running
ensure_git_serve() {
  /bin/bash "$SCRIPT_DIR/git-serve.sh" start
}

# Resolve the git fetch URL for the remote to use
resolve_fetch_url() {
  if [[ "$SOURCE" == "github" ]]; then
    echo "origin"
    return
  fi

  # Local mode: ensure git daemon + check reachability
  ensure_git_serve

  LOCAL_IP="$(local_ip)"
  LOCAL_GIT_URL="git://${LOCAL_IP}:${GIT_PORT}/$(basename "$PROJECT_ROOT")"

  # Quick check: can the remote reach local git daemon?
  if ssh_run "git ls-remote $LOCAL_GIT_URL HEAD" >/dev/null 2>&1; then
    echo "$LOCAL_GIT_URL"
  else
    echo "[WARN] Remote cannot reach local git daemon at $LOCAL_GIT_URL" >&2
    echo "[WARN] Falling back to GitHub (origin)" >&2
    echo "origin"
  fi
}

case "$cmd" in
  status)
    echo "[$env_name] Checking status on $SSH_TARGET ..."
    ssh_run "cd $PT_DEPLOY_PATH && git log --oneline -1 && make status 2>/dev/null || echo 'make status not available'"
    ;;

  logs)
    echo "[$env_name] Fetching logs from $SSH_TARGET ..."
    ssh_run "cd $PT_DEPLOY_PATH && tail -n 50 .local/dev/logs/${PT_DEPLOY_ROLE}.log 2>/dev/null || journalctl -u peers-${PT_DEPLOY_ROLE} --no-pager -n 50 2>/dev/null || echo 'No logs found'"
    ;;

  *)
    # Deploy
    FETCH_URL="$(resolve_fetch_url)"

    echo ""
    echo "═══════════════════════════════════════════════"
    echo "  Deploying: $env_name"
    echo "  Host:      $SSH_TARGET"
    echo "  Path:      $PT_DEPLOY_PATH"
    echo "  Branch:    $BRANCH"
    echo "  Role:      $PT_DEPLOY_ROLE"
    echo "  Source:    $FETCH_URL"
    echo "═══════════════════════════════════════════════"
    echo ""

    echo "[1/4] Fetching code ..."
    if [[ "$FETCH_URL" == "origin" ]]; then
      ssh_run "cd $PT_DEPLOY_PATH && git fetch origin && git checkout $BRANCH && git pull origin $BRANCH"
    else
      # Fetch from local git daemon into a temporary remote ref, then checkout
      ssh_run "cd $PT_DEPLOY_PATH && git fetch $FETCH_URL $BRANCH:refs/remotes/local-dev/$BRANCH && git checkout $BRANCH && git reset --hard refs/remotes/local-dev/$BRANCH"
    fi

    echo "[2/4] Building ..."
    case "$PT_DEPLOY_ROLE" in
      station)
        ssh_run "cd $PT_DEPLOY_PATH/apps/station/app && go build -o bin/station ."
        ;;
      relay)
        ssh_run "cd $PT_DEPLOY_PATH && make build-relay 2>/dev/null || echo 'build-relay not available, skipping'"
        ;;
      *)
        ssh_run "cd $PT_DEPLOY_PATH && make build 2>/dev/null || echo 'No build target, skipping'"
        ;;
    esac

    echo "[3/4] Restarting $PT_DEPLOY_ROLE ..."
    ssh_run "cd $PT_DEPLOY_PATH && make ${PT_DEPLOY_ROLE}-restart 2>/dev/null || systemctl --user restart peers-${PT_DEPLOY_ROLE} 2>/dev/null || echo 'Manual restart needed'"

    echo "[4/4] Health check ..."
    sleep 2
    if ssh_run "cd $PT_DEPLOY_PATH && make status 2>/dev/null"; then
      echo ""
      echo "[OK] Deploy complete: $env_name"
    else
      echo ""
      echo "[WARN] Deploy done but health check unclear. Check: make deploy-status ENV=$env_name"
    fi
    ;;
esac
