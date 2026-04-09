#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# dev-desktop.sh — Desktop development mode with HMR support
#
# Workflow:
#   1. Ensure Station is running (auto-start if not)
#   2. Launch "tauri dev" which:
#      a. Starts Vite Dev Server on port 3000 (via beforeDevCommand)
#      b. Compiles Rust BFF (incremental, ~10s after first build)
#      c. Opens Tauri window loading http://localhost:3000
#
# Frontend changes (tsx/ts/css) → instant HMR, no restart needed
# Rust BFF changes (.rs)        → incremental cargo build, auto-reload
#
# Use preview-desktop.sh for production-like testing (dist/ build)
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/apps/desktop"

source "$SCRIPT_DIR/_ensure-station.sh"

if [[ ! -d "$DESKTOP_DIR" ]]; then
  echo "[ERROR] desktop app dir not found: $DESKTOP_DIR"
  exit 1
fi

ensure_station_ready "$PROJECT_ROOT"

cd "$DESKTOP_DIR"

echo ""
echo "┌──────────────────────────────────────────────┐"
echo "│  Peers Touch Desktop — Development Mode      │"
echo "│                                              │"
echo "│  Frontend : Vite HMR on http://localhost:3210│"
echo "│  BFF      : Rust incremental build           │"
echo "│                                              │"
echo "│  tsx/css changes → instant hot reload         │"
echo "│  .rs changes     → auto recompile + reload   │"
echo "│                                              │"
echo "│  Ctrl+C to stop                              │"
echo "└──────────────────────────────────────────────┘"
echo ""

exec pnpm tauri:dev
