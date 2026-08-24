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
SSH_PORT="${PT_GIT_SERVER_SSH_PORT:-22}"

SSH_TARGET="${PT_GIT_SERVER_USER}@${PT_GIT_SERVER_HOST}"
SSH_OPTS=(
  -o BatchMode=yes
  -o ConnectTimeout=10
  -o ConnectionAttempts=1
  -o StrictHostKeyChecking=yes
  -p "$SSH_PORT"
)
if [[ -n "${PT_GIT_SERVER_KNOWN_HOSTS_FILE:-}" ]]; then
  SSH_OPTS+=(-o "UserKnownHostsFile=$PT_GIT_SERVER_KNOWN_HOSTS_FILE")
fi
if [[ "$PT_GIT_SERVER_BARE_PATH" = /* || "$PT_GIT_SERVER_BARE_PATH" == *".."* ]]; then
  echo "[ERROR] PT_GIT_SERVER_BARE_PATH must be relative to the remote home"
  exit 1
fi
REMOTE_COMMAND="$(printf 'bash -s -- %q %q' "$PT_GIT_SERVER_BARE_PATH" "$DAEMON_PORT")"

echo "═══════════════════════════════════════════════"
echo "  Central Git Server Setup"
echo "  Host:      $SSH_TARGET"
echo "  Bare repo: \$HOME/$PT_GIT_SERVER_BARE_PATH"
echo "  Daemon:    :$DAEMON_PORT"
echo "═══════════════════════════════════════════════"
echo ""

# Step 1: Create bare repo
echo "[1/2] Creating bare repo ..."
# shellcheck disable=SC2029 # REMOTE_COMMAND contains shell-escaped remote arguments.
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$REMOTE_COMMAND" <<'REMOTE_SETUP'
set -euo pipefail

bare_path="$1"
daemon_port="$2"
bare_abs="$HOME/$bare_path"
base_path="$(dirname "$bare_abs")"

if [[ -f "$bare_abs/HEAD" ]]; then
    echo "       Bare repo already exists: $bare_abs"
else
    mkdir -p "$bare_abs"
    git init --bare "$bare_abs"
    echo "       Created: $bare_abs"
fi

echo "[2/2] Ensuring git daemon on :$daemon_port ..."
if ss -tlnp 2>/dev/null | grep -q ":$daemon_port "; then
    echo "       git daemon already listening on :$daemon_port"
else
    nohup git daemon \
      --reuseaddr \
      --listen=0.0.0.0 \
      --port="$daemon_port" \
      --base-path="$base_path" \
      --export-all \
      --enable=upload-pack \
      --detach \
      "$base_path"
    sleep 0.5
    if ss -tlnp 2>/dev/null | grep -q ":$daemon_port "; then
        echo "       git daemon started on :$daemon_port"
    else
        echo "       [ERROR] git daemon failed to start"
        exit 1
    fi
fi
REMOTE_SETUP

echo ""
echo "[OK] Central git server ready."
echo ""
echo "  Push URL (from local):"
echo "    ${PT_GIT_SERVER_USER}@${PT_GIT_SERVER_HOST}:${PT_GIT_SERVER_BARE_PATH}"
echo ""
echo "  Fetch URL (for $PT_GIT_SERVER_HOST itself):"
echo "    \$HOME/$PT_GIT_SERVER_BARE_PATH"
echo ""
echo "  Fetch URL (for other hosts via LAN):"
echo "    git://$PT_GIT_SERVER_HOST:$DAEMON_PORT/$(basename "$PT_GIT_SERVER_BARE_PATH")"
echo ""
echo "  Verify from another host:"
echo "    git ls-remote git://$PT_GIT_SERVER_HOST:$DAEMON_PORT/$(basename "$PT_GIT_SERVER_BARE_PATH")"
