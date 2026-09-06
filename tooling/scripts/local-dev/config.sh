#!/usr/bin/env bash
# config.sh — Show current profile configuration
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"
source "$SCRIPT_DIR/redact-env.sh"

echo ""
echo "Active Profile"
echo "=============="
echo "  Worktree: $WORKTREE_ID"
echo "  File: $PROFILE_FILE"
echo ""
echo "Configuration:"
print_redacted_env_file "$PROFILE_FILE" | sed 's/^/  /'
echo ""
