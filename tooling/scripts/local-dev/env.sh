#!/usr/bin/env bash
# env.sh — Load current worktree's active dev profile
# Sourced (not executed) by other local-dev scripts.
#
# Profile resolution:
#   1. PT_DEV_PROFILE_FILE env var (explicit override)
#   2. Profile name from the worktree-specific active symlink
#   3. Reviewed canonical profile from the sibling env repo
#   4. Human-authorized local compose profile with a matching machine receipt
#
# Env repo discovery: sibling convention — env repo at $PROJECT_ROOT/../env
#
# Pids/logs/data are scoped by profile name so multiple profiles
# can coexist when .local/ is shared across worktrees.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LOCAL_DEV_DIR="$PROJECT_ROOT/.local/dev"
AUTHORIZATION_SCRIPT="$SCRIPT_DIR/environment-creation-authorization.py"

list_profile_directories() {
  local env_root="$1"
  local directory
  for directory in "$env_root"/peers-touch/*/; do
    [[ -d "$directory" ]] || continue
    [[ "$(basename "$directory")" == "0-tpl" ]] && continue
    basename "$directory"
  done
}

WORKTREE_ID="$(basename "$PROJECT_ROOT")"
export WORKTREE_ID
ENV_REPO="$(cd "$PROJECT_ROOT/.." && pwd)/env"
export PT_ENV_REPO="$ENV_REPO"

PROFILE_FILE="${PT_DEV_PROFILE_FILE:-}"

if [[ -n "$PROFILE_FILE" ]]; then
  if [[ "${PT_DEV_PROFILE_FILE_AUTHORITY:-}" != "acceptance-runtime-manifest" ]]; then
    echo "[ERROR] PT_DEV_PROFILE_FILE requires acceptance-runtime-manifest authority."
    exit 1
  fi
  runtime_profile_root="${PT_ACCEPTANCE_RUNTIME_PROFILE_ROOT:-}"
  if [[ -z "$runtime_profile_root" || "$runtime_profile_root" != /* ]]; then
    echo "[ERROR] PT_ACCEPTANCE_RUNTIME_PROFILE_ROOT must be an absolute path."
    exit 1
  fi
  if ! PROFILE_FILE="$(python3 - "$PROFILE_FILE" "$runtime_profile_root" <<'PY'
import os
from pathlib import Path
import stat
import sys

profile = Path(sys.argv[1]).expanduser().resolve(strict=True)
root = Path(sys.argv[2]).expanduser().resolve(strict=True)
metadata = profile.lstat()
if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid():
    raise SystemExit(1)
if profile.parent != root:
    raise SystemExit(1)
sys.stdout.write(f"{profile}\n")
PY
  )"; then
    echo "[ERROR] PT_DEV_PROFILE_FILE must be an owned regular file directly under the declared Acceptance runtime profile root."
    exit 1
  fi
else
  ACTIVE_PROFILE="$LOCAL_DEV_DIR/active/$WORKTREE_ID.env"
  if [[ ! -L "$ACTIVE_PROFILE" ]]; then
    echo "[ERROR] No worktree-specific active profile for '$WORKTREE_ID'."
    echo "        Run: make profiles"
    echo "        Then: make profile <name>"
    local_env_repo="$(cd "$PROJECT_ROOT/.." && pwd)/env"
    if [[ -d "$local_env_repo/peers-touch" ]]; then
      echo "        Observed profile directories (approval not implied):"
      list_profile_directories "$local_env_repo" | sed 's/^/          /'
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

  ENV_PROFILE_DIR="$ENV_REPO/peers-touch/${PROFILE_NAME}"
  ENV_PROFILE="$ENV_PROFILE_DIR/profile.env.example"

  if [[ -f "$ENV_PROFILE" ]]; then
    if ! git -C "$ENV_REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      echo "[ERROR] Environment repository is not a Git worktree: $ENV_REPO"
      exit 1
    fi
    if ! git -C "$ENV_REPO" ls-files --error-unmatch \
      "peers-touch/${PROFILE_NAME}/profile.env.example" >/dev/null 2>&1; then
      echo "[ERROR] Profile '${PROFILE_NAME}' is not Git-tracked in the env repository."
      echo "        Untracked topology cannot authorize profile selection."
      exit 1
    fi
    if [[ -n "$(git -C "$ENV_REPO" status --porcelain --untracked-files=all -- "peers-touch/${PROFILE_NAME}")" ]]; then
      echo "[ERROR] Profile '${PROFILE_NAME}' has dirty or untracked env definitions."
      echo "        Review and commit the exact topology before selection."
      exit 1
    fi
    PROFILE_FILE="$ENV_PROFILE"
  elif [[ -f "$ACTIVE_PROFILE" ]]; then
    if ! receipt="$(python3 "$AUTHORIZATION_SCRIPT" verify \
      --workspace-root "$PROJECT_ROOT" \
      --profile "$PROFILE_NAME" \
      --profile-file "$ACTIVE_PROFILE")"; then
      echo "[ERROR] Local profile '${PROFILE_NAME}' is not human-authorized."
      echo "        Missing topology is a blocker; no local fallback is allowed."
      exit 1
    fi
    PROFILE_FILE="$ACTIVE_PROFILE"
    export PT_ENV_CREATION_AUTHORIZATION_RECEIPT="$receipt"
  else
    echo "[ERROR] Profile '${PROFILE_NAME}' not found."
    echo "        Checked reviewed env source: $ENV_PROFILE"
    echo "        Checked authorized local source: $ACTIVE_PROFILE"
    if [[ -d "$ENV_REPO/peers-touch" ]]; then
      echo ""
      echo "        Observed profile directories (approval not implied):"
      list_profile_directories "$ENV_REPO" | sed 's/^/          /'
    fi
    exit 1
  fi
fi

# shellcheck disable=SC1090
profile_allexport_enabled=0
case "$-" in
  *a*) profile_allexport_enabled=1 ;;
esac
set -a
source "$PROFILE_FILE"
if [[ "$profile_allexport_enabled" -eq 0 ]]; then
  set +a
fi

: "${PT_DEV_PROFILE:?PT_DEV_PROFILE not set in profile}"

if [[ -n "${PROFILE_NAME:-}" && "$PT_DEV_PROFILE" != "$PROFILE_NAME" ]]; then
  echo "[ERROR] Active profile identity mismatch: selected=$PROFILE_NAME declared=$PT_DEV_PROFILE"
  exit 1
fi

for tool_bin in \
  "${PT_GO_BIN:-}" \
  "${PT_PYTHON_BIN:-}" \
  "${PT_NODE_BIN:-}" \
  "${PT_NPM_BIN:-}" \
  "${PT_PROTOC_BIN:-}"; do
  if [[ -n "$tool_bin" && ":$PATH:" != *":$tool_bin:"* ]]; then
    PATH="$tool_bin:$PATH"
  fi
done
export PATH

export PROJECT_ROOT
export LOCAL_DEV_DIR
export PT_DEV_PIDS="$LOCAL_DEV_DIR/pids/$PT_DEV_PROFILE"
export PT_DEV_LOGS="$LOCAL_DEV_DIR/logs/$PT_DEV_PROFILE"
export PT_DEV_DATA="$LOCAL_DEV_DIR/data/$PT_DEV_PROFILE"

mkdir -p "$PT_DEV_PIDS" "$PT_DEV_LOGS" "$PT_DEV_DATA"
