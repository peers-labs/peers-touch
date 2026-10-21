#!/usr/bin/env bash
# Build the official Lark channel plugin for the host GOOS/GOARCH and lay it
# out as an importable plugin package:
#   <out>/plugin.json
#   <out>/bin/lark-channel-plugin
#
# Usage: build-lark-plugin.sh [output-dir] [station-app-dir]
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
OUT=${1:-"$REPO_ROOT/build/plugins/lark"}
APP_DIR=${2:-"$REPO_ROOT/apps/station/app"}
MANIFEST="$APP_DIR/cmd/lark-channel-plugin/plugin.json"
PKG_KEY="$(go env GOOS)/$(go env GOARCH)"

echo "Building lark-channel-plugin for $PKG_KEY -> $OUT"
mkdir -p "$OUT/bin"

if ! grep -Fq "\"$PKG_KEY\"" "$MANIFEST"; then
  echo "plugin manifest has no entry for $PKG_KEY" >&2
  exit 1
fi

( cd "$APP_DIR" && \
  CGO_ENABLED=0 go build -trimpath \
    -o "$OUT/bin/lark-channel-plugin" ./cmd/lark-channel-plugin )

cp "$MANIFEST" "$OUT/plugin.json"

chmod 0755 "$OUT/bin/lark-channel-plugin"
echo "Plugin package ready at $OUT"
