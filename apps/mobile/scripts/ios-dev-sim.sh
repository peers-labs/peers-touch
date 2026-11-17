#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(cd "$APP_DIR/../.." && pwd -P)"
source "$PROJECT_ROOT/tooling/scripts/local-dev/env.sh"
MACHINE_DEV="$PROJECT_ROOT/tooling/scripts/local-dev/machine-dev.mjs"
if [[ -z "${PT_MACHINE_RESOURCE_OPERATION_ID:-}" ]]; then
  arguments=(resource-run-ios --workspace-root "$PROJECT_ROOT" --env-repo "$PT_ENV_REPO")
  selector="${1:-${PT_IOS_RESOURCE:-}}"
  if [[ -n "$selector" ]]; then arguments+=(--selector "$selector"); fi
  if [[ -n "${PT_IOS_OPERATION_ID:-}" ]]; then arguments+=(--operation-id "$PT_IOS_OPERATION_ID"); fi
  exec node "$MACHINE_DEV" "${arguments[@]}" -- /bin/bash "$0"
fi
IOS_UDID="${PT_MACHINE_RESOURCE_PROVIDER_ID:?Held resource UUID is required}"
node "$MACHINE_DEV" verify-held --workspace-root "$PROJECT_ROOT" \
  --resource-kind simulator.ios --resource-id "$IOS_UDID" >/dev/null
MOBILE_WEB_PORT="$PT_MOBILE_WEB_PORT"
MOBILE_DEV_HOST="127.0.0.1"
DEV_CONFIG="$PT_DEV_DATA/mobile-tauri-dev.json"
DEV_URL="http://$MOBILE_DEV_HOST:$MOBILE_WEB_PORT"
VITE_LOG="$PT_DEV_LOGS/mobile-vite-dev.log"
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

IOS_PROJECT_DIR="$APP_DIR/src-tauri/gen/apple"

node "$MACHINE_DEV" resource-check-dev-endpoint --workspace-root "$PROJECT_ROOT" \
  --operation-id "$PT_MACHINE_RESOURCE_OPERATION_ID" >/dev/null
if is_dev_url_ready; then
  echo "Development endpoint $DEV_URL already has a server. Preserve its owner and use an isolated workspace slot." >&2
  exit 1
fi
export PT_MOBILE_BUILD_IDENTITY_JSON="$(node "$MACHINE_DEV" resource-build-identity \
  --workspace-root "$PROJECT_ROOT" --operation-id "$PT_MACHINE_RESOURCE_OPERATION_ID")"
if ! is_dev_url_ready; then
  pnpm dev --host "$MOBILE_DEV_HOST" --port "$MOBILE_WEB_PORT" --strictPort >"$VITE_LOG" 2>&1 &
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

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

# The generated Tauri build phase consumes MOBILE_TAURI_DEV_CONFIG. Xcode uses
# the locked UUID; Tauri CLI's fuzzy device-name selector is not an identity.
BUILD_ROOT="$PT_DEV_DATA/mobile-ios-build"
xcodebuild -project "$IOS_PROJECT_DIR/peers-touch-mobile.xcodeproj" \
  -scheme peers-touch-mobile_iOS -configuration debug -sdk iphonesimulator \
  -destination "id=$IOS_UDID" -derivedDataPath "$BUILD_ROOT" \
  CODE_SIGNING_ALLOWED=NO build
applications=("$BUILD_ROOT"/Build/Products/debug-iphonesimulator/*.app)
if [[ "${#applications[@]}" != "1" || ! -d "${applications[0]}" ]]; then
  echo "Expected exactly one built simulator app in $BUILD_ROOT." >&2
  exit 1
fi
node "$MACHINE_DEV" resource-use-install --workspace-root "$PROJECT_ROOT" \
  --operation-id "$PT_MACHINE_RESOURCE_OPERATION_ID" --app-path "${applications[0]}"
xcrun simctl launch "$IOS_UDID" com.peers.touch.mobile
echo "Mobile installed on the assigned device. Web edits reload; rerun this entry after native edits."
if [[ -n "$VITE_PID" ]]; then
  wait "$VITE_PID"
fi
