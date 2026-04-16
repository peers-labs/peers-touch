#!/bin/bash
set -euo pipefail

# Proto code generation — Go only.
# Dart/Flutter generation has been removed (deprecated path).
# Mobile (Kotlin/Swift) generation: use tooling/scripts/proto-gen-mobile.sh

PROJECT_ROOT=$(cd "$(dirname "$0")/.."; pwd)
PROTO_ROOT="$PROJECT_ROOT/model"
GO_OUT="$PROJECT_ROOT/apps/station"

echo "=== Peers Touch Proto Generation (Go) ==="
echo "Project Root: $PROJECT_ROOT"
echo "Proto Root:   $PROTO_ROOT"
echo "Go Output:    $GO_OUT"
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
MODULE_PREFIX="github.com/peers-labs/peers-touch/station/"

for file in $GO_PROTO_FILES; do
    GO_PACKAGE_LINE=$(grep 'option[[:space:]]\+go_package' "$file" || true)

    if [[ "$GO_PACKAGE_LINE" =~ \"([^\"]+)\" ]]; then
        GO_PACKAGE="${BASH_REMATCH[1]}"
        GO_PACKAGE="${GO_PACKAGE%%;*}"

        if [[ "$GO_PACKAGE" == "$MODULE_PREFIX"* ]]; then
            REL_GO_DIR="${GO_PACKAGE#$MODULE_PREFIX}"
            FILE_NAME=$(basename "$file")
            GO_FILE_NAME="${FILE_NAME%.proto}.pb.go"
            FULL_GO_PATH="$GO_OUT/$REL_GO_DIR/$GO_FILE_NAME"
            echo "  Generating $file -> $FULL_GO_PATH"
        else
            echo "  Generating $file (go_package: $GO_PACKAGE)"
        fi
    else
        echo "  Generating $file (no go_package option)"
    fi

    protoc $PROTOC_GEN_GO --go_out="$GO_OUT" --go_opt=module=github.com/peers-labs/peers-touch/station -I"$PROTO_ROOT" "$file"
done

echo ""
echo "=== Proto generation complete ==="
