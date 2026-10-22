#!/bin/bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.."; pwd)
PROTO_ROOT="$PROJECT_ROOT/model"
WEB_TS_OUT="${PT_MOBILE_WEB_PROTO_OUT:-$PROJECT_ROOT/apps/mobile/src/gen/proto}"
PROTOC_GEN_ES="$PROJECT_ROOT/apps/mobile/node_modules/.bin/protoc-gen-es"

if [[ $# -ne 1 || "${1:-}" != "web" ]]; then
    echo "Usage: $0 web"
    exit 1
fi

echo "=== Peers Touch Mobile Proto Generation ==="
echo "Proto Root: $PROTO_ROOT"
echo "Web TS Out: $WEB_TS_OUT"
echo ""

if [ ! -x "$PROTOC_GEN_ES" ]; then
    echo "[ERROR] protoc-gen-es not found at $PROTOC_GEN_ES"
    echo "Install deps: pnpm install"
    exit 1
fi

WEB_TS_STAGE=$(mktemp -d)
trap 'rm -rf "$WEB_TS_STAGE"' EXIT

generated_count=0
while IFS= read -r -d '' file; do
    relative_path=${file#$PROTO_ROOT/}
    echo "  $relative_path"
    protoc \
        --plugin=protoc-gen-es="$PROTOC_GEN_ES" \
        --es_out="$WEB_TS_STAGE" \
        --es_opt=target=ts \
        -I"$PROTO_ROOT" \
        "$file"
    generated_count=$((generated_count + 1))
done < <(find "$PROTO_ROOT/domain" -type f -name '*.proto' -print0)

if [[ $generated_count -eq 0 ]]; then
    echo "No .proto files found. Exiting."
    exit 0
fi

while IFS= read -r -d '' generated_file; do
    relative_path=${generated_file#$WEB_TS_STAGE/}
    destination="$WEB_TS_OUT/$relative_path"
    perl -0pi -e 's/\n*\z/\n/' "$generated_file"
    if [ -f "$destination" ] && cmp -s "$generated_file" "$destination"; then
        continue
    fi
    mkdir -p "$(dirname "$destination")"
    cp "$generated_file" "$destination"
done < <(find "$WEB_TS_STAGE" -type f -name '*_pb.ts' -print0)

if [ -d "$WEB_TS_OUT" ]; then
    while IFS= read -r -d '' existing_file; do
        relative_path=${existing_file#$WEB_TS_OUT/}
        if [ ! -f "$WEB_TS_STAGE/$relative_path" ]; then
            rm "$existing_file"
        fi
    done < <(find "$WEB_TS_OUT" -type f -name '*_pb.ts' -print0)
fi

echo ""
echo "Generated $generated_count proto file(s) for shared Mobile TypeScript."
echo "=== Done ==="
