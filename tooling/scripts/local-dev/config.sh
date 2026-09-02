#!/usr/bin/env bash
# config.sh — Show current profile configuration
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"

echo ""
echo "Active Profile"
echo "=============="
echo "  Worktree: $WORKTREE_ID"
echo "  File: $PROFILE_FILE"
echo ""
echo "Configuration:"
grep -v '^#' "$PROFILE_FILE" | grep -v '^$' | sed 's/^/  /'
echo ""
