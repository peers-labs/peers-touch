#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.."; pwd)
SRC_DIR="$ROOT_DIR/src"
SOCIAL_WIRE_FILES=(
  "$SRC_DIR/services/eventStream.ts"
  "$SRC_DIR/services/socialRealtime.ts"
)

if grep -R -n -E 'ProtoReader|STREAM_EVENT_[A-Z_]+_FIELD|reader\.varint|reader\.bytes|field-number' "$SRC_DIR/services" "$SRC_DIR/runtimes" "$SRC_DIR/store"; then
  echo "Desktop social wire contract violation: use generated TS proto bindings instead of hand-written protobuf decoding." >&2
  exit 1
fi

if ! grep -q 'StreamEventSchema' "$SRC_DIR/services/eventStream.ts"; then
  echo "Desktop social wire contract violation: eventStream.ts must decode realtime envelopes through StreamEventSchema." >&2
  exit 1
fi

if ! grep -q 'FriendChatMessageSchema' "$SRC_DIR/services/socialRealtime.ts"; then
  echo "Desktop social wire contract violation: socialRealtime.ts must decode friend chat payloads through FriendChatMessageSchema." >&2
  exit 1
fi

if ! grep -q 'GroupMessageSchema' "$SRC_DIR/services/socialRealtime.ts"; then
  echo "Desktop social wire contract violation: socialRealtime.ts must decode group chat payloads through GroupMessageSchema." >&2
  exit 1
fi

for file in "${SOCIAL_WIRE_FILES[@]}"; do
  if ! grep -q 'fromBinary' "$file"; then
    echo "Desktop social wire contract violation: $file must use generated protobuf decoding." >&2
    exit 1
  fi
done

echo "Desktop social wire contract OK."
