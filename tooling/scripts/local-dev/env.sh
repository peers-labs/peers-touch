#!/usr/bin/env bash
# env.sh — Load current worktree's active dev profile
# Sourced (not executed) by other local-dev scripts.
#
# Profile resolution:
#   1. PT_DEV_PROFILE_FILE env var (explicit override)
#   2. Profile name from .local/dev/profile (one word, e.g. "two")
#   3. Source profile from the env repo (sibling: ../env/peers-touch/<name>/profile.env.example)
#   4. Fallback: .local/dev/profiles/<name>.env (local copy, for offline or legacy use)
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
  PROFILE_SELECTOR="$LOCAL_DEV_DIR/profile"
  if [[ ! -f "$PROFILE_SELECTOR" ]]; then
    echo "[ERROR] No profile configured for this worktree."
    echo "        Create .local/dev/profile containing the profile name."
    echo "        Example: echo 'one' > .local/dev/profile"
    local_env_repo="$(cd "$PROJECT_ROOT/.." && pwd)/env"
    if [[ -d "$local_env_repo/peers-touch" ]]; then
      echo "        Available (from env repo):"
      ls -d "$local_env_repo/peers-touch"/*/ 2>/dev/null | xargs -I{} basename {} | grep -v '0-tpl' | sed 's/^/          /'
    fi
    exit 1
  fi

  PROFILE_NAME="$(cat "$PROFILE_SELECTOR" | tr -d '[:space:]')"
  if [[ -z "$PROFILE_NAME" ]]; then
    echo "[ERROR] .local/dev/profile is empty. Write a profile name (e.g. 'one' or 'two')."
    exit 1
  fi

  ENV_REPO="$(cd "$PROJECT_ROOT/.." && pwd)/env"

  if [[ -f "$ENV_REPO/peers-touch/${PROFILE_NAME}/profile.env.example" ]]; then
    PROFILE_FILE="$ENV_REPO/peers-touch/${PROFILE_NAME}/profile.env.example"
  elif [[ -f "$LOCAL_DEV_DIR/profiles/${PROFILE_NAME}.env" ]]; then
    PROFILE_FILE="$LOCAL_DEV_DIR/profiles/${PROFILE_NAME}.env"
  else
    echo "[ERROR] Profile '${PROFILE_NAME}' not found."
    echo "        Checked: $ENV_REPO/peers-touch/${PROFILE_NAME}/profile.env.example"
    echo "        Checked: $LOCAL_DEV_DIR/profiles/${PROFILE_NAME}.env"
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

export PROJECT_ROOT
export LOCAL_DEV_DIR
export PT_DEV_PIDS="$LOCAL_DEV_DIR/pids/$PT_DEV_PROFILE"
export PT_DEV_LOGS="$LOCAL_DEV_DIR/logs/$PT_DEV_PROFILE"
export PT_DEV_DATA="$LOCAL_DEV_DIR/data/$PT_DEV_PROFILE"

mkdir -p "$PT_DEV_PIDS" "$PT_DEV_LOGS" "$PT_DEV_DATA"
