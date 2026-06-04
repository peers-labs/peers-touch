#!/usr/bin/env bash
# Build an applet from source and deploy to Desktop applets-dist.
# Usage: ./tooling/scripts/build-applet.sh <applet-source-dir> [applet-id]
#
# The applet source must have a lynx.config.ts and package.json with "build" script.
# Output: apps/desktop/applets-dist/<applet-id>/main.lynx.bundle
#
# Example:
#   ./tooling/scripts/build-applet.sh apps/desktop/applets-dev/hello-lynx hello-lynx
#   ./tooling/scripts/build-applet.sh ../my-peers-applets/applets/big-a/lynx big-a

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APPLET_SOURCE="${1:?Usage: build-applet.sh <applet-source-dir> [applet-id]}"
APPLET_ID="${2:-$(basename "$APPLET_SOURCE")}"

# Resolve to absolute path
if [[ "$APPLET_SOURCE" != /* ]]; then
  APPLET_SOURCE="$REPO_ROOT/$APPLET_SOURCE"
fi

DIST_DIR="$REPO_ROOT/apps/desktop/applets-dist/$APPLET_ID"

echo "==> Building applet: $APPLET_ID"
echo "    Source: $APPLET_SOURCE"
echo "    Output: $DIST_DIR/main.lynx.bundle"
echo ""

# Verify source exists
if [[ ! -f "$APPLET_SOURCE/lynx.config.ts" ]]; then
  echo "ERROR: $APPLET_SOURCE/lynx.config.ts not found" >&2
  exit 1
fi

# Build
cd "$APPLET_SOURCE"
npx rspeedy build

# Deploy
mkdir -p "$DIST_DIR"
cp "$APPLET_SOURCE/dist/main.lynx.bundle" "$DIST_DIR/main.lynx.bundle"

echo ""
echo "==> Done. Bundle deployed to $DIST_DIR/main.lynx.bundle"
echo "    Size: $(wc -c < "$DIST_DIR/main.lynx.bundle" | tr -d ' ') bytes"
