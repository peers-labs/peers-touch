#!/usr/bin/env bash
set -euo pipefail

DEVICE_NAME="${1:-iPhone 17 Pro Max}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_DIR="$APP_DIR/src-tauri"
SIM_LIB="$TAURI_DIR/target/aarch64-apple-ios-sim/debug/libpeers_touch_mobile_lib.a"
EXTERNAL_LIB="$TAURI_DIR/gen/apple/Externals/arm64-sim/debug/libapp.a"

cd "$APP_DIR"

pnpm build

cd "$TAURI_DIR"

# Frontend assets are embedded by tauri::generate_context! into the Rust staticlib.
# Remove the app crate artifacts so frontend-only changes cannot reuse a stale libapp.a.
rm -f \
  target/aarch64-apple-ios-sim/debug/libpeers_touch_mobile_lib.a \
  target/aarch64-apple-ios-sim/debug/libpeers_touch_mobile_lib.d \
  target/aarch64-apple-ios-sim/debug/deps/libpeers_touch_mobile_lib.a
rm -rf target/aarch64-apple-ios-sim/debug/incremental/peers_touch_mobile_lib-*

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

cargo build --target aarch64-apple-ios-sim

mkdir -p "$(dirname "$EXTERNAL_LIB")"
cp "$SIM_LIB" "$EXTERNAL_LIB"

cd "$APP_DIR"
exec npx tauri ios dev "$DEVICE_NAME"
