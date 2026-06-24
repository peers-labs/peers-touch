#!/bin/bash
set -euo pipefail

# Proto code generation — Go (Station) and TypeScript (desktop).
# Dart/Flutter generation has been removed (deprecated path).
# Mobile (Kotlin/Swift) generation: use tooling/scripts/proto-gen-mobile.sh
# Desktop Rust generation: handled separately by tauri build pipeline.

PROJECT_ROOT=$(cd "$(dirname "$0")/.."; pwd)
PROTO_ROOT="$PROJECT_ROOT/model"
GO_OUT="$PROJECT_ROOT/apps/station"
TS_OUT="$PROJECT_ROOT/apps/desktop/src/gen/proto"
PROTOC_GEN_ES="$PROJECT_ROOT/apps/desktop/node_modules/.bin/protoc-gen-es"

echo "=== Peers Touch Proto Generation ==="
echo "Project Root: $PROJECT_ROOT"
echo "Proto Root:   $PROTO_ROOT"
echo "Go Output:    $GO_OUT"
echo "TS Output:    $TS_OUT"
echo ""

if [ ! -d "$GO_OUT" ]; then
    echo "Creating Go output directory: $GO_OUT"
    mkdir -p "$GO_OUT"
fi

GO_PROTO_FILES=$(find "$PROTO_ROOT/domain" -name "*.proto" -not -path "*/ai_box/ai_box_message.proto")

if [ -z "$GO_PROTO_FILES" ]; then
    echo "No .proto files found. Exiting."
    exit 0
fi

PROTO_COUNT=$(echo "$GO_PROTO_FILES" | wc -l | tr -d ' ')
echo "Found $PROTO_COUNT proto files"
echo ""

echo "Running protoc for Go..."
GOBIN=""
if command -v go &>/dev/null; then
  GOBIN="$(go env GOPATH)/bin"
  export PATH="$GOBIN:$PATH"
fi
PROTOC_GEN_GO=""
if [ -n "$GOBIN" ] && [ -x "$GOBIN/protoc-gen-go" ]; then
  PROTOC_GEN_GO="--plugin=protoc-gen-go=$GOBIN/protoc-gen-go"
fi
STATION_MODULE_PREFIX="github.com/peers-labs/peers-touch/station/"
APPLET_SERVICE_MODULE_PREFIX="github.com/peers-labs/peers-touch/apps/applets/"

for file in $GO_PROTO_FILES; do
    GO_PACKAGE_LINE=$(grep 'option[[:space:]]\+go_package' "$file" || true)
    GO_PROTO_OUT="$GO_OUT"
    GO_MODULE="github.com/peers-labs/peers-touch/station"

    if [[ "$GO_PACKAGE_LINE" =~ \"([^\"]+)\" ]]; then
        GO_PACKAGE="${BASH_REMATCH[1]}"
        GO_PACKAGE="${GO_PACKAGE%%;*}"

        if [[ "$GO_PACKAGE" == "$STATION_MODULE_PREFIX"* ]]; then
            REL_GO_DIR="${GO_PACKAGE#$STATION_MODULE_PREFIX}"
            FILE_NAME=$(basename "$file")
            GO_FILE_NAME="${FILE_NAME%.proto}.pb.go"
            FULL_GO_PATH="$GO_OUT/$REL_GO_DIR/$GO_FILE_NAME"
            echo "  Generating $file -> $FULL_GO_PATH"
        elif [[ "$GO_PACKAGE" =~ ^github.com/peers-labs/peers-touch/apps/applets/([^/]+)/service(/.*)?$ ]]; then
            APPLET_SERVICE="${BASH_REMATCH[1]}"
            GO_MODULE="github.com/peers-labs/peers-touch/apps/applets/$APPLET_SERVICE/service"
            GO_PROTO_OUT="$PROJECT_ROOT/apps/applets/$APPLET_SERVICE/service"
            REL_GO_DIR="${GO_PACKAGE#$GO_MODULE/}"
            FILE_NAME=$(basename "$file")
            GO_FILE_NAME="${FILE_NAME%.proto}.pb.go"
            FULL_GO_PATH="$GO_PROTO_OUT/$REL_GO_DIR/$GO_FILE_NAME"
            echo "  Generating $file -> $FULL_GO_PATH"
        else
            echo "  Generating $file (go_package: $GO_PACKAGE)"
        fi
    else
        echo "  Generating $file (no go_package option)"
    fi

    mkdir -p "$GO_PROTO_OUT"
    protoc $PROTOC_GEN_GO --go_out="$GO_PROTO_OUT" --go_opt=module="$GO_MODULE" -I"$PROTO_ROOT" "$file"
done

echo ""
echo "Running protoc for TypeScript (desktop)..."

# protoc-gen-es ships with @bufbuild/protoc-gen-es; install desktop deps
# first if you see this skip path. The TS bundle is a derived product —
# we wipe and regenerate so deleted protos do not leave orphan _pb.ts
# files behind.
if [ ! -x "$PROTOC_GEN_ES" ]; then
    echo "  protoc-gen-es not found at $PROTOC_GEN_ES"
    echo "  → run 'pnpm install' from the repo root, then re-run this script"
    echo ""
    echo "=== Proto generation complete (Go only) ==="
    exit 0
fi

rm -rf "$TS_OUT"
mkdir -p "$TS_OUT"

for file in $GO_PROTO_FILES; do
    REL_PATH="${file#$PROTO_ROOT/}"
    echo "  Generating $REL_PATH -> TS"
    protoc \
        --plugin=protoc-gen-es="$PROTOC_GEN_ES" \
        --es_out="$TS_OUT" \
        --es_opt=target=ts \
        -I"$PROTO_ROOT" \
        "$file"
done

echo ""
echo "=== Proto generation complete (Go + TS) ==="
