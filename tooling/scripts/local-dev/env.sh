#!/usr/bin/env bash
# env.sh — Resolve current worktree configuration from the machine registry
# Sourced (not executed) by other local-dev scripts.
#
# Profile resolution:
#   1. Canonical worktree root -> workspaceId
#   2. Authoritative machine registry binding
#   3. Reviewed canonical profile from the sibling env repo
#   4. Machine-owned slot and derived local ports
#
# Acceptance runtime-manifest overrides remain contained, but the worktree must
# still have an authoritative machine registration and slot allocation.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd -P)"
LOCAL_DEV_DIR="$PROJECT_ROOT/.local/dev"
ENV_REPO="${PT_ENV_REPO:-$(cd "$PROJECT_ROOT/.." && pwd)/env}"
export PT_ENV_REPO="$ENV_REPO"
MACHINE_DEV_SCRIPT="$SCRIPT_DIR/machine-dev.mjs"

if ! resolved_exports="$(
  node "$MACHINE_DEV_SCRIPT" resolve \
    --workspace-root "$PROJECT_ROOT" \
    --env-repo "$ENV_REPO" \
    --format shell
)"; then
  echo "[ERROR] Machine Dev Control Plane resolution failed."
  echo "        Register explicitly with make env-register; no profile or slot fallback is allowed."
  exit 1
fi
eval "$resolved_exports"

PROFILE_FILE="${PT_DEV_PROFILE_FILE:-}"
PROFILE_FROM_MACHINE=0

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
  PROFILE_FILE="$PT_MACHINE_PROFILE_FILE"
  PROFILE_FROM_MACHINE=1
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

if [[ "$PROFILE_FROM_MACHINE" == "1" ]] \
  && [[ "$PT_DEV_PROFILE" != "$PT_MACHINE_PROFILE" ]]; then
  echo "[ERROR] Machine binding and profile definition identities do not match."
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

if [[ -n "${PT_MACHINE_WORKSPACE_ID:-}" ]]; then
  # Machine allocation owns local ports. Profile slot/port values are legacy
  # topology observations and cannot override the workspace binding.
  export PT_DEV_SLOT="$PT_MACHINE_SLOT"
  export PT_DESKTOP_APP_GATEWAY_PORT="$PT_MACHINE_DESKTOP_APP_GATEWAY_PORT"
  export PT_DESKTOP_APP_WEB_PORT="$PT_MACHINE_DESKTOP_APP_WEB_PORT"
  export PT_DESKTOP_WEB_GATEWAY_PORT="$PT_MACHINE_DESKTOP_WEB_GATEWAY_PORT"
  export PT_DESKTOP_WEB_WEB_PORT="$PT_MACHINE_DESKTOP_WEB_WEB_PORT"
  export PT_MOBILE_WEB_PORT="$PT_MACHINE_MOBILE_WEB_PORT"

  if [[ "${PT_STATION_MODE:-}" == "local" || "${PT_STATION_MODE:-}" == "compose" ]]; then
    export PT_STATION_PORT="$((18080 + PT_DEV_SLOT * 100))"
    export PT_STATION_URL="http://127.0.0.1:${PT_STATION_PORT}"
  fi
fi

WORKTREE_ID="${PT_MACHINE_WORKSPACE_ID:-$(basename "$PROJECT_ROOT")}"
export PROJECT_ROOT
export LOCAL_DEV_DIR
export WORKTREE_ID
RUNTIME_ROOT="${PT_MACHINE_WORKSPACE_STATE_ROOT:-$LOCAL_DEV_DIR}/runtime/$PT_DEV_PROFILE"
export PT_DEV_PIDS="$RUNTIME_ROOT/pids"
export PT_DEV_LOGS="$RUNTIME_ROOT/logs"
export PT_DEV_DATA="$RUNTIME_ROOT/data"

mkdir -p "$PT_DEV_PIDS" "$PT_DEV_LOGS" "$PT_DEV_DATA"
