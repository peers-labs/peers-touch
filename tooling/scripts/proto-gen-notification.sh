#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROTO="$PROJECT_ROOT/model/domain/notification/notification.proto"
PROTO_ROOT="$PROJECT_ROOT/model"
GO_PLUGIN="$(go env GOPATH)/bin/protoc-gen-go"
DESKTOP_ES="$PROJECT_ROOT/apps/desktop/node_modules/.bin/protoc-gen-es"
MOBILE_ES="$PROJECT_ROOT/apps/mobile/node_modules/.bin/protoc-gen-es"

for executable in protoc "$GO_PLUGIN" "$DESKTOP_ES" "$MOBILE_ES"; do
  if [ ! -x "$executable" ] && ! command -v "$executable" >/dev/null 2>&1; then
    echo "required proto generator is unavailable: $executable" >&2
    exit 1
  fi
done

protoc \
  --plugin="protoc-gen-go=$GO_PLUGIN" \
  --go_out="$PROJECT_ROOT/apps/station" \
  --go_opt=module=github.com/peers-labs/peers-touch/station \
  -I"$PROTO_ROOT" \
  "$PROTO"

protoc \
  --plugin="protoc-gen-es=$DESKTOP_ES" \
  --es_out="$PROJECT_ROOT/apps/desktop/src/gen/proto" \
  --es_opt=target=ts \
  -I"$PROTO_ROOT" \
  "$PROTO"

protoc \
  --plugin="protoc-gen-es=$MOBILE_ES" \
  --es_out="$PROJECT_ROOT/apps/mobile/src/gen/proto" \
  --es_opt=target=ts \
  -I"$PROTO_ROOT" \
  "$PROTO"

for output in \
  "$PROJECT_ROOT/apps/desktop/src/gen/proto/domain/notification/notification_pb.ts" \
  "$PROJECT_ROOT/apps/mobile/src/gen/proto/domain/notification/notification_pb.ts"; do
  perl -0pi -e 's/\n*\z/\n/' "$output"
done
