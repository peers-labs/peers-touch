#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_WEB_PORT="${VITE_DEV_SERVER_PORT:-5173}"
MOBILE_DEV_HOST="${VITE_DEV_SERVER_HOST:-127.0.0.1}"
DEV_CONFIG="${MOBILE_TAURI_DEV_CONFIG:-$APP_DIR/src-tauri/target/mobile-tauri-dev.json}"
DEV_URL="http://$MOBILE_DEV_HOST:$MOBILE_WEB_PORT"
VITE_LOG="$APP_DIR/src-tauri/target/mobile-vite-dev.log"
VITE_PID=""

booted_iphone_name() {
  xcrun simctl list devices booted \
    | sed -nE 's/^[[:space:]]+([^()]+)[[:space:]]+\([^)]+\)[[:space:]]+\(Booted\)$/\1/p' \
    | sed 's/[[:space:]]*$//' \
    | grep -E '^iPhone ' \
    | head -n 1
}

REQUESTED_DEVICE_NAME="${1:-${MOBILE_IOS_DEVICE:-${PT_MOBILE_IOS_DEVICE:-}}}"
DEVICE_NAME="${REQUESTED_DEVICE_NAME:-$(booted_iphone_name)}"
DEVICE_NAME="${DEVICE_NAME:-iPhone 17}"

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

IOS_PROJECT_DIR="$APP_DIR/src-tauri/gen/apple"
if [ -f "$IOS_PROJECT_DIR/project.yml" ]; then
  if ! command -v xcodegen >/dev/null 2>&1; then
    echo "xcodegen is required to sync the iOS project from project.yml before launch." >&2
    exit 1
  fi
  mkdir -p "$IOS_PROJECT_DIR/Externals" "$IOS_PROJECT_DIR/assets"
  (cd "$IOS_PROJECT_DIR" && xcodegen generate >/dev/null)
fi

# Tauri installs to the named simulator. Keep that target booted so a shutdown
# default device cannot tear down the dev server after a successful build.
xcrun simctl boot "$DEVICE_NAME" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$DEVICE_NAME" -b >/dev/null

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
export MOBILE_TAURI_DEV_CONFIG="$DEV_CONFIG"
export TAURI_CONFIG="$(cat "$DEV_CONFIG")"
# Tauri embeds devUrl into the native context during the Rust build. Force the
# build script to rerun so dev sessions cannot reuse a stale libapp.a.
touch "$APP_DIR/src-tauri/build.rs"
xattr -dr com.apple.provenance "$APP_DIR/src-tauri/target" 2>/dev/null || true
find "$APP_DIR/src-tauri/target" "$APP_DIR/src-tauri/gen/apple/Externals" \
  \( -name libpeers_touch_mobile_lib.a -o -name libapp.a \) \
  -delete 2>/dev/null || true

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

echo "Launching Peers on iOS simulator: $DEVICE_NAME"
npx tauri ios dev --config "$DEV_CONFIG" "$DEVICE_NAME"
