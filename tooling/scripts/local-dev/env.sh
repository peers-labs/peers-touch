#!/usr/bin/env bash
# env.sh — Load current worktree's active dev profile
# Sourced (not executed) by other local-dev scripts.
#
# Profile resolution:
#   1. PT_DEV_PROFILE_FILE env var (explicit override)
#   2. Profile name from the worktree-specific active symlink
#   3. Canonical profile from the sibling env repo
#   4. Worktree-active local profile when no canonical env profile exists
#
# Env repo discovery: sibling convention — env repo at $PROJECT_ROOT/../env
#
# Pids/logs/data are scoped by profile name so multiple profiles
# can coexist when .local/ is shared across worktrees.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LOCAL_DEV_DIR="$PROJECT_ROOT/.local/dev"

WORKTREE_ID="$(basename "$PROJECT_ROOT")"
export WORKTREE_ID

PROFILE_FILE="${PT_DEV_PROFILE_FILE:-}"

if [[ -z "$PROFILE_FILE" ]]; then
  ACTIVE_PROFILE="$LOCAL_DEV_DIR/active/$WORKTREE_ID.env"
  if [[ ! -L "$ACTIVE_PROFILE" ]]; then
    echo "[ERROR] No worktree-specific active profile for '$WORKTREE_ID'."
    echo "        Run: make profiles"
    echo "        Then: make profile <name>"
    local_env_repo="$(cd "$PROJECT_ROOT/.." && pwd)/env"
    if [[ -d "$local_env_repo/peers-touch" ]]; then
      echo "        Available (from env repo):"
      ls -d "$local_env_repo/peers-touch"/*/ 2>/dev/null | xargs -I{} basename {} | grep -v '0-tpl' | sed 's/^/          /'
    fi
    exit 1
  fi

  active_target="$(readlink "$ACTIVE_PROFILE")"
  active_filename="$(basename "$active_target")"
  if [[ "$active_filename" != *.env ]]; then
    echo "[ERROR] Active profile target must end in .env: $active_target"
    exit 1
  fi
  PROFILE_NAME="${active_filename%.env}"

  ENV_REPO="$(cd "$PROJECT_ROOT/.." && pwd)/env"

  if [[ -f "$ENV_REPO/peers-touch/${PROFILE_NAME}/profile.env.example" ]]; then
    PROFILE_FILE="$ENV_REPO/peers-touch/${PROFILE_NAME}/profile.env.example"
  elif [[ -f "$ACTIVE_PROFILE" ]]; then
    PROFILE_FILE="$ACTIVE_PROFILE"
  else
    echo "[ERROR] Profile '${PROFILE_NAME}' not found."
    echo "        Checked: $ENV_REPO/peers-touch/${PROFILE_NAME}/profile.env.example"
    echo "        Checked: $ACTIVE_PROFILE"
    if [[ -d "$ENV_REPO/peers-touch" ]]; then
      echo ""
      echo "        Available profiles in env repo:"
      ls -d "$ENV_REPO/peers-touch"/*/ 2>/dev/null | xargs -I{} basename {} | grep -v '0-tpl' | sed 's/^/          /'
    fi
    exit 1
  fi
fi

# shellcheck disable=SC1090
source "$PROFILE_FILE"

: "${PT_DEV_PROFILE:?PT_DEV_PROFILE not set in profile}"

if [[ -n "${PROFILE_NAME:-}" && "$PT_DEV_PROFILE" != "$PROFILE_NAME" ]]; then
  echo "[ERROR] Active profile identity mismatch: selected=$PROFILE_NAME declared=$PT_DEV_PROFILE"
  exit 1
fi

export PROJECT_ROOT
export LOCAL_DEV_DIR
export PT_DEV_PIDS="$LOCAL_DEV_DIR/pids/$PT_DEV_PROFILE"
export PT_DEV_LOGS="$LOCAL_DEV_DIR/logs/$PT_DEV_PROFILE"
export PT_DEV_DATA="$LOCAL_DEV_DIR/data/$PT_DEV_PROFILE"

mkdir -p "$PT_DEV_PIDS" "$PT_DEV_LOGS" "$PT_DEV_DATA"
