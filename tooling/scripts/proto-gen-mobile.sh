#!/bin/bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.."; pwd)
PROTO_ROOT="$PROJECT_ROOT/model"
ANDROID_OUT="$PROJECT_ROOT/apps/mobile/android/app/src/main/java"
IOS_OUT="$PROJECT_ROOT/apps/mobile/ios/PeersTouch/Core/Proto"
WEB_TS_OUT="${PT_MOBILE_WEB_PROTO_OUT:-$PROJECT_ROOT/apps/mobile/src/gen/proto}"
PROTOC_GEN_ES="$PROJECT_ROOT/apps/mobile/node_modules/.bin/protoc-gen-es"

echo "=== Peers Touch Mobile Proto Generation ==="
echo "Proto Root:    $PROTO_ROOT"
echo "Android Out:   $ANDROID_OUT"
echo "iOS Out:       $IOS_OUT"
echo "Web TS Out:    $WEB_TS_OUT"
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

    if [ ! -d "$PROJECT_ROOT/apps/mobile/android" ]; then
        echo "Android native project is not configured; skipping Kotlin generation."
        echo ""
        return 0
    fi

    mkdir -p "$ANDROID_OUT"

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

    if [ ! -d "$PROJECT_ROOT/apps/mobile/ios" ]; then
        echo "iOS native project is not configured; skipping Swift generation."
        echo ""
        return 0
    fi

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

generate_web_ts() {
    echo "--- Generating Web TypeScript ---"

    if [ ! -x "$PROTOC_GEN_ES" ]; then
        echo "[ERROR] protoc-gen-es not found at $PROTOC_GEN_ES"
        echo "Install deps: pnpm install"
        return 1
    fi

    WEB_TS_STAGE=$(mktemp -d)
    trap 'rm -rf "$WEB_TS_STAGE"' RETURN

    for file in $PROTO_FILES; do
        REL_PATH=${file#$PROTO_ROOT/}
        echo "  $REL_PATH"
        protoc \
            --plugin=protoc-gen-es="$PROTOC_GEN_ES" \
            --es_out="$WEB_TS_STAGE" \
            --es_opt=target=ts \
            -I"$PROTO_ROOT" \
            "$file"
    done

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

    echo "Web TypeScript generation complete."
    echo ""
}

case "${1:-all}" in
    kotlin|android)
        generate_kotlin
        ;;
    swift|ios)
        generate_swift
        ;;
    web|ts|typescript)
        generate_web_ts
        ;;
    all)
        generate_kotlin
        generate_swift
        generate_web_ts
        ;;
    *)
        echo "Usage: $0 [kotlin|swift|web|all]"
        exit 1
        ;;
esac

echo "=== Done ==="
