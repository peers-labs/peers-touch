#!/usr/bin/env bash
set -euo pipefail

DEVICE_NAME="${1:-iPhone 17 Pro Max}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_WEB_PORT="${VITE_DEV_SERVER_PORT:-4210}"
DEV_CONFIG="${MOBILE_TAURI_DEV_CONFIG:-$APP_DIR/src-tauri/target/mobile-tauri-dev.json}"

cd "$APP_DIR"

mkdir -p "$(dirname "$DEV_CONFIG")"
cat > "$DEV_CONFIG" <<EOF
{
  "build": {
    "devUrl": "http://localhost:$MOBILE_WEB_PORT",
    "beforeDevCommand": "pnpm dev -- --host 0.0.0.0 --port $MOBILE_WEB_PORT --strictPort"
  }
}
EOF

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

exec npx tauri ios dev --config "$DEV_CONFIG" "$DEVICE_NAME"
