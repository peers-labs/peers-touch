#!/usr/bin/env bash
# config.sh — Show current profile configuration
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env.sh"
source "$SCRIPT_DIR/redact-env.sh"

echo ""
echo "Authoritative Workspace Binding"
echo "==============================="
echo "  Workspace ID : $PT_MACHINE_WORKSPACE_ID"
echo "  Worktree     : $PT_MACHINE_WORKSPACE_ROOT"
echo "  Profile      : $PT_DEV_PROFILE"
echo "  Slot         : $PT_DEV_SLOT"
echo "  Capabilities : ${PT_MACHINE_ALLOWED_CAPABILITIES:-<none>}"
echo "  Profile file : $PROFILE_FILE"
echo ""
echo "Profile Definition:"
print_redacted_env_file "$PROFILE_FILE" | sed 's/^/  /'
echo ""
echo "Resolved Local Ports:"
echo "  PT_DESKTOP_APP_GATEWAY_PORT=$PT_DESKTOP_APP_GATEWAY_PORT"
echo "  PT_DESKTOP_APP_WEB_PORT=$PT_DESKTOP_APP_WEB_PORT"
echo "  PT_MOBILE_WEB_PORT=$PT_MOBILE_WEB_PORT"
echo ""
