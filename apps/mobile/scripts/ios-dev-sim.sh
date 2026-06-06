#!/usr/bin/env bash
set -euo pipefail

DEVICE_NAME="${1:-iPhone 17 Pro Max}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_WEB_PORT="${VITE_DEV_SERVER_PORT:-4210}"
MOBILE_DEV_HOST="${VITE_DEV_SERVER_HOST:-127.0.0.1}"
DEV_CONFIG="${MOBILE_TAURI_DEV_CONFIG:-$APP_DIR/src-tauri/target/mobile-tauri-dev.json}"
DEV_URL="http://$MOBILE_DEV_HOST:$MOBILE_WEB_PORT"
VITE_LOG="$APP_DIR/src-tauri/target/mobile-vite-dev.log"
VITE_PID=""

is_dev_url_ready() {
  curl --silent --fail --max-time 1 "$DEV_URL" >/dev/null 2>&1
}

cleanup_vite() {
  if [ -n "$VITE_PID" ] && kill -0 "$VITE_PID" >/dev/null 2>&1; then
    kill "$VITE_PID" >/dev/null 2>&1 || true
  fi
}

cd "$APP_DIR"

mkdir -p "$(dirname "$DEV_CONFIG")"
mkdir -p "$(dirname "$VITE_LOG")"

if ! is_dev_url_ready; then
  pnpm dev -- --host "$MOBILE_DEV_HOST" --port "$MOBILE_WEB_PORT" --strictPort >"$VITE_LOG" 2>&1 &
  VITE_PID="$!"
  trap cleanup_vite EXIT INT TERM

  for _ in $(seq 1 80); do
    if is_dev_url_ready; then
      break
    fi
    if ! kill -0 "$VITE_PID" >/dev/null 2>&1; then
      echo "Mobile web dev server exited before it became ready. Log: $VITE_LOG" >&2
      tail -n 80 "$VITE_LOG" >&2 || true
      exit 1
    fi
    sleep 0.25
  done

  if ! is_dev_url_ready; then
    echo "Mobile web dev server did not become ready at $DEV_URL. Log: $VITE_LOG" >&2
    tail -n 80 "$VITE_LOG" >&2 || true
    exit 1
  fi
fi

cat > "$DEV_CONFIG" <<EOF
{
  "build": {
    "devUrl": "$DEV_URL",
    "beforeDevCommand": "echo mobile web dev server is ready at $DEV_URL"
  }
}
EOF

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

npx tauri ios dev --config "$DEV_CONFIG" "$DEVICE_NAME"
