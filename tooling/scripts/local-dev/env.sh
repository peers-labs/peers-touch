#!/usr/bin/env bash
# env.sh — Load current worktree's active dev profile
# Sourced (not executed) by other local-dev scripts.
#
# Pids/logs/data are scoped by profile name so multiple profiles
# can coexist when .local/ is shared across worktrees.
# Active profile pointer is per-worktree (identified by directory basename).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LOCAL_DEV_DIR="$PROJECT_ROOT/.local/dev"

# Worktree ID: basename of the worktree root (unique per worktree)
WORKTREE_ID="$(basename "$PROJECT_ROOT")"
export WORKTREE_ID

ACTIVE_DIR="$LOCAL_DEV_DIR/active"
PROFILE_FILE="$ACTIVE_DIR/$WORKTREE_ID.env"

if [[ ! -f "$PROFILE_FILE" ]]; then
  echo "[ERROR] No active profile for worktree '$WORKTREE_ID'."
  echo "        Run: make profile PROFILE=<name>"
  echo "        Available profiles: make profiles"
  exit 1
fi

# shellcheck disable=SC1090
source "$PROFILE_FILE"

: "${PT_DEV_PROFILE:?PT_DEV_PROFILE not set in profile}"

# Profile-scoped runtime paths (allows shared .local/ across worktrees)
export PROJECT_ROOT
export LOCAL_DEV_DIR
export PT_DEV_PIDS="$LOCAL_DEV_DIR/pids/$PT_DEV_PROFILE"
export PT_DEV_LOGS="$LOCAL_DEV_DIR/logs/$PT_DEV_PROFILE"
export PT_DEV_DATA="$LOCAL_DEV_DIR/data/$PT_DEV_PROFILE"

mkdir -p "$PT_DEV_PIDS" "$PT_DEV_LOGS" "$PT_DEV_DATA"
