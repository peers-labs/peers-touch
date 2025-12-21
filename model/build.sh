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

# Determine plugin option
PLUGIN_OPT=""
if [ -n "$PROTOC_GEN_DART_PLUGIN" ]; then
    PLUGIN_OPT="--plugin=protoc-gen-dart=$PROTOC_GEN_DART_PLUGIN"
    echo "Using protoc-gen-dart plugin from env: $PROTOC_GEN_DART_PLUGIN"
fi

echo "Running protoc for Dart..."
# Loop through Dart proto files
for file in $DART_PROTO_FILES; do
    # Calculate relative path from ProtoRoot
    # Using python for reliable relative path calculation or simple string substitution
    REL_PATH=${file#$PROTO_ROOT/}
    # Replace .proto with .pb.dart
    DART_REL_PATH="${REL_PATH%.proto}.pb.dart"
    FULL_DART_PATH="$DART_OUT/$DART_REL_PATH"
    
    echo "Generating $file to $FULL_DART_PATH"
    protoc $PLUGIN_OPT --dart_out="$DART_OUT" -I"$PROTO_ROOT" "$file"
done

# Protobuf 5.1.0+ supports toProto3Json natively

GO_PROTO_FILES=$(find "$PROTO_ROOT/domain" -name "*.proto" -not -path "*/ai_box/ai_box_message.proto")

echo "Running protoc for Go..."
MODULE_PREFIX="github.com/peers-labs/peers-touch/station/"

for file in $GO_PROTO_FILES; do
    # Read file to find go_package
    # Grep for option go_package = "..."
    GO_PACKAGE_LINE=$(grep 'option[[:space:]]\+go_package' "$file")
    
    # Extract package path
    if [[ "$GO_PACKAGE_LINE" =~ \"([^\"]+)\" ]]; then
        GO_PACKAGE="${BASH_REMATCH[1]}"
        # Remove anything after ;
        GO_PACKAGE="${GO_PACKAGE%%;*}"
        
        # Check if it starts with module prefix
        if [[ "$GO_PACKAGE" == "$MODULE_PREFIX"* ]]; then
            REL_GO_DIR="${GO_PACKAGE#$MODULE_PREFIX}"
            FILE_NAME=$(basename "$file")
            GO_FILE_NAME="${FILE_NAME%.proto}.pb.go"
            FULL_GO_PATH="$GO_OUT/$REL_GO_DIR/$GO_FILE_NAME"
            echo "Generating $file to $FULL_GO_PATH"
        else
            echo "Generating $file (Could not determine exact output path from go_package: $GO_PACKAGE)"
        fi
    else
        echo "Generating $file (No go_package option found)"
    fi

    protoc --go_out="$GO_OUT" --go_opt=module=github.com/peers-labs/peers-touch/station -I"$PROTO_ROOT" "$file"
done

echo "Protobuf code generation complete."
