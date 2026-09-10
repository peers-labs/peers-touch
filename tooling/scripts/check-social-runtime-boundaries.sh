#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.."; pwd)

DESKTOP_UI_DIRS=(
  "$ROOT_DIR/apps/desktop/src/pages"
  "$ROOT_DIR/apps/desktop/src/components"
)
MOBILE_UI_DIRS=(
  "$ROOT_DIR/apps/mobile/src/pages"
  "$ROOT_DIR/apps/mobile/src/components"
)

violation=0

check_pattern() {
  local label="$1"
  local pattern="$2"
  shift 2
  local paths=("$@")

  local matches
  matches=$(
    grep -R -n -E "$pattern" "${paths[@]}" --include='*.ts' --include='*.tsx' 2>/dev/null \
      | grep -v -E ':[0-9]+:[[:space:]]*(//|\*)' \
      || true
  )
  if [[ -n "$matches" ]]; then
    echo "$label" >&2
    echo "$matches" >&2
    violation=1
  fi
}

check_pattern \
  "Social runtime boundary violation: UI pages/components must not open realtime or presence streams directly." \
  '/events/stream|/presence/heartbeat|/presence/offline|EventSource\(' \
  "${DESKTOP_UI_DIRS[@]}" "${MOBILE_UI_DIRS[@]}"

check_pattern \
  "Social runtime boundary violation: UI pages/components must not install/start social runtime bridges directly." \
  'startEventStream|installEventStreamBridge|installSocialRealtimeBridge|installSocialChatRealtimeBridge|startRealtimeStream|startSocialRuntime|dispatchSocialRuntimeExternalEvent' \
  "${DESKTOP_UI_DIRS[@]}" "${MOBILE_UI_DIRS[@]}"

check_pattern \
  "Social runtime boundary violation: UI pages/components must not call runtime-level social reconcile/refresh APIs." \
  'refreshSocialProjection|\.reconcile\(|useSocialStore\.getState\(\)\.reconcile|loadFriendRequests\(|refreshFriendRequests\(|refreshSessions\(|refreshNotifications\(' \
  "${DESKTOP_UI_DIRS[@]}" "${MOBILE_UI_DIRS[@]}"

check_pattern \
  "Social runtime boundary violation: UI pages/components must not parse or call group E2EE primitives directly." \
  'GroupCiphertextSchema|SenderKeyDistributionMessageSchema|crypto_group|cryptoGroup|groupE2ee' \
  "${MOBILE_UI_DIRS[@]}"

if [[ "$violation" -ne 0 ]]; then
  echo "Social runtime boundary check failed. Move long-lived social freshness to runtime/store owners." >&2
  exit 1
fi

echo "Social runtime boundaries OK."
