#!/usr/bin/env bash
# config.sh — Show current profile configuration
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LOCAL_DEV_DIR="$PROJECT_ROOT/.local/dev"

WORKTREE_ID="$(basename "$PROJECT_ROOT")"
ACTIVE_DIR="$LOCAL_DEV_DIR/active"
PROFILE_FILE="$ACTIVE_DIR/$WORKTREE_ID.env"

if [[ ! -f "$PROFILE_FILE" ]]; then
  echo "[ERROR] No active profile for worktree '$WORKTREE_ID'."
  echo "        Run: make profiles"
  echo "        Then: make profile <name>"
  exit 1
fi

echo ""
echo "Active Profile"
echo "=============="
echo "  Worktree: $WORKTREE_ID"
if [[ -L "$PROFILE_FILE" ]]; then
  target="$(readlink "$PROFILE_FILE")"
  echo "  File: $LOCAL_DEV_DIR/$target"
else
  echo "  File: $PROFILE_FILE"
fi
echo ""
echo "Configuration:"
grep -v '^#' "$PROFILE_FILE" | grep -v '^$' | sed 's/^/  /'
echo ""
