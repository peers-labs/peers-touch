#!/bin/bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.."; pwd)
PROTO_ROOT="$PROJECT_ROOT/model"
ANDROID_OUT="$PROJECT_ROOT/apps/mobile/android/app/src/main/java"
IOS_OUT="$PROJECT_ROOT/apps/mobile/ios/PeersTouch/Core/Proto"

echo "=== Peers Touch Mobile Proto Generation ==="
echo "Proto Root:    $PROTO_ROOT"
echo "Android Out:   $ANDROID_OUT"
echo "iOS Out:       $IOS_OUT"
echo ""

PROTO_FILES=$(find "$PROTO_ROOT/domain" -name "*.proto")

if [ -z "$PROTO_FILES" ]; then
    echo "No .proto files found. Exiting."
    exit 0
fi

PROTO_COUNT=$(echo "$PROTO_FILES" | wc -l | tr -d ' ')
echo "Found $PROTO_COUNT proto files"
echo ""

generate_kotlin() {
    echo "--- Generating Kotlin (Java Lite) ---"

    GOBIN=""
    if command -v go &>/dev/null; then
        GOBIN="$(go env GOPATH)/bin"
    fi

    PROTOC_GEN_JAVALITE=""
    if [ -n "$GOBIN" ] && [ -x "$GOBIN/protoc-gen-java" ]; then
        PROTOC_GEN_JAVALITE="--plugin=protoc-gen-java=$GOBIN/protoc-gen-java"
    fi

    for file in $PROTO_FILES; do
        REL_PATH=${file#$PROTO_ROOT/}
        echo "  $REL_PATH"
        protoc $PROTOC_GEN_JAVALITE \
            --java_out=lite:"$ANDROID_OUT" \
            -I"$PROTO_ROOT" \
            "$file" 2>/dev/null || echo "  [WARN] Failed: $REL_PATH"
    done

    echo "Kotlin generation complete."
    echo ""
}

generate_swift() {
    echo "--- Generating Swift ---"

    if ! command -v protoc-gen-swift &>/dev/null; then
        echo "[ERROR] protoc-gen-swift not found."
        echo "Install: brew install swift-protobuf"
        echo "Or: git clone https://github.com/apple/swift-protobuf && swift build"
        return 1
    fi

    mkdir -p "$IOS_OUT"

    for file in $PROTO_FILES; do
        REL_PATH=${file#$PROTO_ROOT/}
        echo "  $REL_PATH"
        protoc \
            --swift_out="$IOS_OUT" \
            --swift_opt=Visibility=Public \
            -I"$PROTO_ROOT" \
            "$file" 2>/dev/null || echo "  [WARN] Failed: $REL_PATH"
    done

    echo "Swift generation complete."
    echo ""
}

case "${1:-all}" in
    kotlin|android)
        generate_kotlin
        ;;
    swift|ios)
        generate_swift
        ;;
    all)
        generate_kotlin
        generate_swift
        ;;
    *)
        echo "Usage: $0 [kotlin|swift|all]"
        exit 1
        ;;
esac

echo "=== Done ==="
