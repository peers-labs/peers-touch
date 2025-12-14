#!/bin/bash

export PATH="$PATH":"$HOME/.pub-cache/bin"

# Set paths
PROJECT_ROOT=$(cd "$(dirname "$0")/.."; pwd)
PROTO_ROOT="$PROJECT_ROOT/model"
DART_OUT="$PROJECT_ROOT/client/common/peers_touch_base/lib/model"
GO_OUT="$PROJECT_ROOT/station"

echo "Project Root: $PROJECT_ROOT"
echo "Proto Root: $PROTO_ROOT"
echo "Dart Output Directory: $DART_OUT"
echo "Go Output Directory: $GO_OUT"

# Create Dart output directory if it doesn't exist
if [ ! -d "$DART_OUT" ]; then
    echo "Creating Dart output directory: $DART_OUT"
    mkdir -p "$DART_OUT"
fi

# Create Go output directory if it doesn't exist
if [ ! -d "$GO_OUT" ]; then
    echo "Creating Go output directory: $GO_OUT"
    mkdir -p "$GO_OUT"
fi

# Find all .proto files for Dart generation (domain files and google protobuf files, exclude ai_box_message.proto)
DART_PROTO_FILES=$(find "$PROTO_ROOT/domain" -name "*.proto" -not -path "*/ai_box/ai_box_message.proto")
# Add google protobuf files explicitly (if present in repo mirror)
if [ -f "$PROTO_ROOT/google/protobuf/struct.proto" ]; then
  DART_PROTO_FILES="$DART_PROTO_FILES $PROTO_ROOT/google/protobuf/struct.proto"
fi
if [ -f "$PROTO_ROOT/google/protobuf/any.proto" ]; then
  DART_PROTO_FILES="$DART_PROTO_FILES $PROTO_ROOT/google/protobuf/any.proto"
fi
if [ -f "$PROTO_ROOT/google/protobuf/timestamp.proto" ]; then
  DART_PROTO_FILES="$DART_PROTO_FILES $PROTO_ROOT/google/protobuf/timestamp.proto"
fi

if [ -z "$DART_PROTO_FILES" ]; then
    echo "No .proto files found for Dart. Exiting."
    exit 0
fi

# Check for protoc-gen-dart plugin
if [ -n "$PROTOC_GEN_DART_PLUGIN" ]; then
    PLUGIN="--plugin=protoc-gen-dart=$PROTOC_GEN_DART_PLUGIN"
    echo "Running protoc for Dart with plugin..."
    protoc $PLUGIN --dart_out="$DART_OUT" -I"$PROTO_ROOT" $DART_PROTO_FILES
else
    echo "Running protoc for Dart..."
    protoc --dart_out="$DART_OUT" -I"$PROTO_ROOT" $DART_PROTO_FILES
fi

# Protobuf 5.1.0+ supports toProto3Json natively

GO_PROTO_FILES=$(find "$PROTO_ROOT/domain" -name "*.proto" -not -path "*/ai_box/ai_box_message.proto")

echo "Running protoc for Go..."
protoc --go_out="$GO_OUT" --go_opt=module=github.com/peers-labs/peers-touch/station -I"$PROTO_ROOT" $GO_PROTO_FILES

echo "Protobuf code generation complete."
