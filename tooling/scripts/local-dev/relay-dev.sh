#!/usr/bin/env bash
# relay-dev.sh — Prepare Relay for current profile.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

RELAY_MODE="${PT_RELAY_MODE:-remote}"
RELAY_URL="${PT_RELAY_URL:-}"
DEPLOY_SCRIPT="$PROJECT_ROOT/tooling/scripts/deploy/deploy.sh"

if [[ "$RELAY_MODE" == "remote" ]]; then
  deploy_env="${PT_RELAY_DEPLOY_ENV:-}"
  if [[ -z "$deploy_env" ]]; then
    echo "[ERROR] Relay mode is remote, but PT_RELAY_DEPLOY_ENV is not set."
    echo "        make relay now means: deploy/restart/check remote Relay."
    echo "        Set it in the active profile, for example:"
    echo "          PT_RELAY_DEPLOY_ENV=relay-1"
    echo ""
    echo "        If you only want a health probe, run:"
    echo "          make relay-check"
    exit 1
  fi

  branch="${PT_RELAY_DEPLOY_BRANCH:-$(git -C "$PROJECT_ROOT" branch --show-current 2>/dev/null || echo main)}"
  echo "[INFO] Relay mode: remote ready closure"
  echo "       URL        : ${RELAY_URL:-<not set>}"
  echo "       Deploy env : $deploy_env"
  echo "       Branch     : $branch"
  echo ""

  BRANCH="$branch" /bin/bash "$DEPLOY_SCRIPT" "$deploy_env"
  /bin/bash "$SCRIPT_DIR/relay-check.sh"
  echo "[OK] Remote Relay ready: $RELAY_URL"
  exit 0
fi

echo "[ERROR] PT_RELAY_MODE=local is not implemented yet."
echo "        Use PT_RELAY_MODE=remote with PT_RELAY_DEPLOY_ENV, or add a local relay runner."
exit 1
