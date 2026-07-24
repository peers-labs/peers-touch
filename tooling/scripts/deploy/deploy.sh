#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# deploy.sh — Remote deployment via pull model
#
# Source modes (PT_DEPLOY_SOURCE):
#   direct  — Push straight to target station's .bare.git via SSH (simplest)
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
GIT_SERVER_ENV="$PROJECT_ROOT/.local/deploy/git-server.env"

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

# Load deploy env
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${PT_DEPLOY_HOST:?PT_DEPLOY_HOST not set in $ENV_FILE}"
: "${PT_DEPLOY_USER:?PT_DEPLOY_USER not set in $ENV_FILE}"
: "${PT_DEPLOY_PATH:?PT_DEPLOY_PATH not set in $ENV_FILE}"
: "${PT_DEPLOY_ROLE:?PT_DEPLOY_ROLE not set in $ENV_FILE}"

BRANCH="${BRANCH:-${PT_DEPLOY_BRANCH:-main}}"
SOURCE="${PT_DEPLOY_SOURCE:-central}"
SSH_TARGET="${PT_DEPLOY_USER}@${PT_DEPLOY_HOST}"
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=10 -o ConnectionAttempts=1 -o StrictHostKeyChecking=no"
ORIGIN_URL="${PT_DEPLOY_REPO_URL:-$(git -C "$PROJECT_ROOT" remote get-url origin 2>/dev/null || true)}"

# Load central git server config if needed
if [[ "$SOURCE" == "central" ]]; then
  if [[ ! -f "$GIT_SERVER_ENV" ]]; then
    echo "[ERROR] PT_DEPLOY_SOURCE=central but $GIT_SERVER_ENV not found"
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$GIT_SERVER_ENV"
  : "${PT_GIT_SERVER_HOST:?PT_GIT_SERVER_HOST not set}"
  : "${PT_GIT_SERVER_USER:?PT_GIT_SERVER_USER not set}"
  : "${PT_GIT_SERVER_BARE_PATH:?PT_GIT_SERVER_BARE_PATH not set}"
  GIT_SERVER_DAEMON_PORT="${PT_GIT_SERVER_DAEMON_PORT:-9418}"
  GIT_SERVER_SSH_URL="ssh://${PT_GIT_SERVER_USER}@${PT_GIT_SERVER_HOST}/home/${PT_GIT_SERVER_USER}/${PT_GIT_SERVER_BARE_PATH}"
fi

ssh_run() {
  # shellcheck disable=SC2086
  ssh $SSH_OPTS "$SSH_TARGET" "$@"
}

# ─── Central mode: push to bare repo ───
push_to_central() {
  echo "[INFO] Pushing to central bare repo: ${PT_GIT_SERVER_HOST}:${PT_GIT_SERVER_BARE_PATH}"
  git -C "$PROJECT_ROOT" push --force "$GIT_SERVER_SSH_URL" "HEAD:refs/heads/$BRANCH" 2>&1 | sed 's/^/       /'
}

# ─── Direct mode: push straight to target station ───
push_direct() {
  local remote_url="ssh://${PT_DEPLOY_USER}@${PT_DEPLOY_HOST}/~/${PT_DEPLOY_PATH}"
  echo "[INFO] Pushing directly to: ${PT_DEPLOY_HOST}:${PT_DEPLOY_PATH}"
  ssh_run "mkdir -p \$HOME/$PT_DEPLOY_PATH && cd \$HOME/$PT_DEPLOY_PATH && git init --bare .bare.git 2>/dev/null || true"
  git -C "$PROJECT_ROOT" push --force "ssh://${PT_DEPLOY_USER}@${PT_DEPLOY_HOST}/home/${PT_DEPLOY_USER}/${PT_DEPLOY_PATH}/.bare.git" "HEAD:refs/heads/$BRANCH" 2>&1 | sed 's/^/       /'
}

# ─── Resolve fetch URL for the remote ───
resolve_fetch_url() {
  case "$SOURCE" in
    direct)
      echo "\$HOME/$PT_DEPLOY_PATH/.bare.git"
      ;;
    central)
      if [[ "$PT_DEPLOY_HOST" == "$PT_GIT_SERVER_HOST" ]]; then
        # Target IS the git server → local path fetch (fast)
        echo "/home/${PT_GIT_SERVER_USER}/${PT_GIT_SERVER_BARE_PATH}"
      else
        # Target is another host → fetch from git daemon on the git server
        echo "git://${PT_GIT_SERVER_HOST}:${GIT_SERVER_DAEMON_PORT}/$(basename "${PT_GIT_SERVER_BARE_PATH}")"
      fi
      ;;
    github)
      if [[ -z "$ORIGIN_URL" ]]; then
        echo "[ERROR] PT_DEPLOY_SOURCE=github but no origin URL available" >&2
        exit 1
      fi
      echo "$ORIGIN_URL"
      ;;
    local)
      # Legacy: local git daemon + reverse tunnel
      GIT_PORT="${PT_GIT_SERVE_PORT:-9418}"
      TUNNEL_PORT="${PT_DEPLOY_GIT_TUNNEL_PORT:-19418}"
      /bin/bash "$SCRIPT_DIR/git-serve.sh" start >&2
      # Try reverse tunnel
      if /usr/bin/ssh $SSH_OPTS -N -f -R "127.0.0.1:$TUNNEL_PORT:127.0.0.1:$GIT_PORT" "$SSH_TARGET" 2>/dev/null; then
        sleep 0.5
        if ssh_run "git ls-remote git://127.0.0.1:$TUNNEL_PORT/$(basename "$PROJECT_ROOT") HEAD >/dev/null 2>&1"; then
          echo "git://127.0.0.1:$TUNNEL_PORT/$(basename "$PROJECT_ROOT")"
          return
        fi
      fi
      echo "[WARN] Local mode: tunnel failed, falling back to github" >&2
      echo "$ORIGIN_URL"
      ;;
    *)
      echo "[ERROR] Unknown PT_DEPLOY_SOURCE: $SOURCE" >&2
      exit 1
      ;;
  esac
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

    # Step 0: Push code to target
    if [[ "$SOURCE" == "central" ]]; then
      echo "[0/4] Pushing to central git server ..."
      push_to_central
    elif [[ "$SOURCE" == "direct" ]]; then
      echo "[0/4] Pushing directly to target station ..."
      push_direct
    else
      echo "[0/4] Resolving deploy source ..."
    fi

    FETCH_URL="$(resolve_fetch_url)"

    echo ""
    echo "═══════════════════════════════════════════════"
    echo "  Deploying: $env_name"
    echo "  Host:      $SSH_TARGET"
    echo "  Path:      \$HOME/$PT_DEPLOY_PATH"
    echo "  Branch:    $BRANCH"
    echo "  Role:      $PT_DEPLOY_ROLE"
    echo "  Source:    $FETCH_URL"
    echo "═══════════════════════════════════════════════"
    echo ""

    echo "[1/4] Fetching code ..."
    ssh_run "
      set -e
      DEPLOY_PATH=\"\$HOME/$PT_DEPLOY_PATH\"
      if [ ! -d \"\$DEPLOY_PATH/.git\" ]; then
        mkdir -p \"\$DEPLOY_PATH\"
        cd \"\$DEPLOY_PATH\"
        git init
      else
        cd \"\$DEPLOY_PATH\"
      fi
      if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
        git add -A >/dev/null 2>&1 || true
      fi
      git fetch \"$FETCH_URL\" $BRANCH:refs/remotes/deploy/$BRANCH
      git checkout -f -B $BRANCH refs/remotes/deploy/$BRANCH
      git reset --hard refs/remotes/deploy/$BRANCH
      echo '[remote] HEAD:'
      git log --oneline -1
    "

    echo "[2/4] Building ..."
    if [[ -n "${PT_DEPLOY_BUILD_CMD:-}" ]]; then
      ssh_run "cd \$HOME/$PT_DEPLOY_PATH && PEERS_TOUCH_BUILD_COMMIT=\$(git rev-parse --short=12 HEAD) PEERS_TOUCH_BUILD_LABEL=$BRANCH PEERS_TOUCH_BUILD_TIME=\$(date -u +%Y-%m-%dT%H:%M:%SZ) $PT_DEPLOY_BUILD_CMD"
    else
      case "$PT_DEPLOY_ROLE" in
        station)
          ssh_run "cd \$HOME/$PT_DEPLOY_PATH && mkdir -p .cache/go/mod .cache/go/build apps/station/app/bin && cd apps/station/app && GOMODCACHE=\$HOME/$PT_DEPLOY_PATH/.cache/go/mod GOCACHE=\$HOME/$PT_DEPLOY_PATH/.cache/go/build go build -o bin/station ."
          ;;
        relay)
          ssh_run "cd \$HOME/$PT_DEPLOY_PATH && mkdir -p .cache/go/mod .cache/go/build && GOMODCACHE=\$HOME/$PT_DEPLOY_PATH/.cache/go/mod GOCACHE=\$HOME/$PT_DEPLOY_PATH/.cache/go/build make build-relay"
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
