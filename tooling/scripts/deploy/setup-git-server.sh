#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# setup-git-server.sh — One-time setup for central git server
#
# Creates a bare repo and starts git daemon on the central git server.
# Run once, then all deploys can use PT_DEPLOY_SOURCE=central.
#
# Usage:
#   setup-git-server.sh
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GIT_SERVER_ENV="$PROJECT_ROOT/.local/deploy/git-server.env"

if [[ ! -f "$GIT_SERVER_ENV" ]]; then
  echo "[ERROR] Git server config not found: $GIT_SERVER_ENV"
  echo "        Create it with PT_GIT_SERVER_HOST, PT_GIT_SERVER_USER, PT_GIT_SERVER_BARE_PATH"
  exit 1
fi

# shellcheck disable=SC1090
source "$GIT_SERVER_ENV"

: "${PT_GIT_SERVER_HOST:?not set}"
: "${PT_GIT_SERVER_USER:?not set}"
: "${PT_GIT_SERVER_BARE_PATH:?not set}"
DAEMON_PORT="${PT_GIT_SERVER_DAEMON_PORT:-9418}"

SSH_TARGET="${PT_GIT_SERVER_USER}@${PT_GIT_SERVER_HOST}"
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no"
BARE_ABS="/home/${PT_GIT_SERVER_USER}/${PT_GIT_SERVER_BARE_PATH}"
BASE_PATH="$(dirname "$BARE_ABS")"

echo "═══════════════════════════════════════════════"
echo "  Central Git Server Setup"
echo "  Host:      $SSH_TARGET"
echo "  Bare repo: $BARE_ABS"
echo "  Daemon:    :$DAEMON_PORT"
echo "═══════════════════════════════════════════════"
echo ""

# Step 1: Create bare repo
echo "[1/3] Creating bare repo ..."
# shellcheck disable=SC2086
ssh $SSH_OPTS "$SSH_TARGET" "
  set -e
  if [ -d '$BARE_ABS/HEAD' ] || [ -f '$BARE_ABS/HEAD' ]; then
    echo '       Bare repo already exists: $BARE_ABS'
  else
    mkdir -p '$BARE_ABS'
    git init --bare '$BARE_ABS'
    echo '       Created: $BARE_ABS'
  fi
"

# Step 2: Push initial content
echo "[2/3] Pushing current HEAD to bare repo ..."
GIT_SERVER_SSH_URL="ssh://${PT_GIT_SERVER_USER}@${PT_GIT_SERVER_HOST}${BARE_ABS}"
BRANCH="$(git -C "$PROJECT_ROOT" branch --show-current 2>/dev/null || echo main)"
git -C "$PROJECT_ROOT" push --force "$GIT_SERVER_SSH_URL" "HEAD:refs/heads/$BRANCH" 2>&1 | sed 's/^/       /'

# Step 3: Start git daemon (if not already running)
echo "[3/3] Ensuring git daemon on :$DAEMON_PORT ..."
# shellcheck disable=SC2086
ssh $SSH_OPTS "$SSH_TARGET" "
  set -e
  if ss -tlnp 2>/dev/null | grep -q ':$DAEMON_PORT '; then
    echo '       git daemon already listening on :$DAEMON_PORT'
  else
    nohup git daemon \\
      --reuseaddr \\
      --listen=0.0.0.0 \\
      --port=$DAEMON_PORT \\
      --base-path='$BASE_PATH' \\
      --export-all \\
      --enable=upload-pack \\
      --detach \\
      '$BASE_PATH'
    sleep 0.5
    if ss -tlnp 2>/dev/null | grep -q ':$DAEMON_PORT '; then
      echo '       git daemon started on :$DAEMON_PORT'
    else
      echo '       [ERROR] git daemon failed to start'
      exit 1
    fi
  fi
"

echo ""
echo "[OK] Central git server ready."
echo ""
echo "  Push URL (from local):"
echo "    $GIT_SERVER_SSH_URL"
echo ""
echo "  Fetch URL (for $PT_GIT_SERVER_HOST itself):"
echo "    $BARE_ABS"
echo ""
echo "  Fetch URL (for other hosts via LAN):"
echo "    git://$PT_GIT_SERVER_HOST:$DAEMON_PORT/$(basename "$PT_GIT_SERVER_BARE_PATH")"
echo ""
echo "  Verify from another host:"
echo "    git ls-remote git://$PT_GIT_SERVER_HOST:$DAEMON_PORT/$(basename "$PT_GIT_SERVER_BARE_PATH")"
