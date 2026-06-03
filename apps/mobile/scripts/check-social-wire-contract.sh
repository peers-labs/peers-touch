#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.."; pwd)
SOCIAL_DIR="$ROOT_DIR/src/features/social"

if grep -R -n -E 'ProtoReader|STREAM_EVENT_[A-Z_]+_FIELD|reader\.varint|reader\.bytes|field-number' "$SOCIAL_DIR"; then
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

echo "Mobile social wire contract OK."
