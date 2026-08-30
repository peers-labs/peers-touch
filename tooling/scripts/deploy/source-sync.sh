#!/usr/bin/env bash
# source-sync.sh — Incrementally synchronize one exact Git commit to a remote worktree.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/source_sync.py" "$@"
