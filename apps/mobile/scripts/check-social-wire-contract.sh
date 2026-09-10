#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.."; pwd)
SOCIAL_DIR="$ROOT_DIR/src/features/social"
GROUP_DIR="$ROOT_DIR/src/features/group"
MOBILE_SRC="$ROOT_DIR/src"
MOBILE_RUST_SRC="$ROOT_DIR/src-tauri/src"

if grep -R -n -E 'ProtoReader|STREAM_EVENT_[A-Z_]+_FIELD|reader\.varint|reader\.bytes|field-number' "$SOCIAL_DIR" "$GROUP_DIR"; then
  echo "Mobile social wire contract violation: use generated TS proto bindings instead of hand-written protobuf decoding." >&2
  exit 1
fi

if ! grep -R -q 'StreamEventSchema' "$SOCIAL_DIR/socialWire.ts"; then
  echo "Mobile social wire contract violation: socialWire.ts must decode realtime frames through StreamEventSchema." >&2
  exit 1
fi

if ! grep -R -q 'FriendChatMessageSchema' "$SOCIAL_DIR/socialWire.ts"; then
  echo "Mobile social wire contract violation: socialWire.ts must decode friend chat payloads through FriendChatMessageSchema." >&2
  exit 1
fi

if ! grep -R -q 'GroupMessageSchema' "$SOCIAL_DIR/socialWire.ts"; then
  echo "Mobile social wire contract violation: socialWire.ts must decode group chat payloads through GroupMessageSchema." >&2
  exit 1
fi

if grep -R -n -E \
  'groupE2ee|GROUP_SKDM|SENDER_KEY_DISTRIBUTION|crypto\.sender-key-ledger|signaling_envelope_(open|seal)|messaging_send_text' \
  "$MOBILE_SRC" "$MOBILE_RUST_SRC" \
  --exclude-dir=gen; then
  echo "Mobile social wire contract violation: legacy browser messaging ownership must remain deleted." >&2
  exit 1
fi

echo "Mobile social wire contract OK."
