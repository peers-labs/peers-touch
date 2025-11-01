#!/bin/bash

# Simple proto generation script with PEERS_GENERATION_CONFIG support

set -e

PROTO_DIR="./v1"
BACKEND_OUT="../station/app/proto"
DESKTOP_OUT="../desktop/lib/model/proto"
MOBILE_OUT="../mobile/lib/model/proto"

echo "🔧 Starting proto generation..."

# Function to parse generation config
parse_config() {
    local proto_file=$1
    local target=$2
    
    # Default values
    local targets="all"
    local model_only="false"
    local skip=""
    
    # Check if config exists
    if grep -q "PEERS_GENERATION_CONFIG:" "$proto_file"; then
        # Extract targets
        if grep -q "targets:" "$proto_file"; then
            targets=$(grep "targets:" "$proto_file" | sed 's/.*targets: \[\([^]]*\)\].*/\1/')
        fi
        
        # Extract model_only
        if grep -q "model_only:" "$proto_file"; then
            model_only=$(grep "model_only:" "$proto_file" | sed 's/.*model_only: \([^]]*\).*/\1/')
        fi
        
        # Extract skip
        if grep -q "skip:" "$proto_file"; then
            skip=$(grep "skip:" "$proto_file" | sed 's/.*skip: \[\([^]]*\)\].*/\1/')
        fi
    fi
    
    # Check if should generate for this target
    if [[ "$targets" == "all" ]] || [[ "$targets" == *"$target"* ]]; then
        if [[ -n "$skip" ]] && [[ "$skip" == *"$target"* ]]; then
            echo "  ⚠️  Skipped for $target (in skip list)"
            return 1
        fi
        return 0
    fi
    
    echo "  ⚠️  Skipped for $target (not in targets)"
    return 1
}

# Function to generate Go code
generate_go() {
    local proto_file=$1
    local base_name=$(basename "$proto_file" .proto)
    
    echo "  📝 Generating Go code for $base_name..."
    
    if [[ "$model_only" == "true" ]]; then
        protoc --proto_path="$PROTO_DIR" --go_out="$BACKEND_OUT" "$proto_file"
    else
        protoc --proto_path="$PROTO_DIR" --go_out="$BACKEND_OUT" --go-grpc_out="$BACKEND_OUT" "$proto_file"
    fi
}

# Function to generate Dart code
generate_dart() {
    local proto_file=$1
    local output_dir=$2
    local base_name=$(basename "$proto_file" .proto)
    
    echo "  🎯 Generating Dart code for $base_name..."
    protoc --proto_path="$PROTO_DIR" --dart_out="$output_dir" "$proto_file"
    
    # Remove server code for model_only files
    if [[ "$model_only" == "true" ]]; then
        if [ -f "$output_dir/$base_name.pbserver.dart" ]; then
            echo "  🗑️  Removing server code: $base_name.pbserver.dart"
            rm "$output_dir/$base_name.pbserver.dart"
        fi
    fi
}

# Process all proto files
for proto_file in "$PROTO_DIR"/*.proto; do
    if [ -f "$proto_file" ]; then
        base_name=$(basename "$proto_file" .proto)
        echo "📄 Processing $base_name.proto..."
        
        # Parse config for this file
        targets="all"
        model_only="false"
        skip=""
        
        if grep -q "PEERS_GENERATION_CONFIG:" "$proto_file"; then
            if grep -q "targets:" "$proto_file"; then
                targets=$(grep "targets:" "$proto_file" | sed 's/.*targets: \[\([^]]*\)\].*/\1/')
            fi
            if grep -q "model_only:" "$proto_file"; then
                model_only=$(grep "model_only:" "$proto_file" | sed 's/.*model_only: \([^]]*\).*/\1/')
            fi
            if grep -q "skip:" "$proto_file"; then
                skip=$(grep "skip:" "$proto_file" | sed 's/.*skip: \[\([^]]*\)\].*/\1/')
            fi
        fi
        
        echo "  📋 Config: targets=[$targets], model_only=$model_only, skip=[$skip]"
        
        # Generate for each target
        if [[ "$targets" == "all" ]] || [[ "$targets" == *"backend"* ]]; then
            if [[ -z "$skip" ]] || [[ "$skip" != *"backend"* ]]; then
                echo "  🚀 Generating for backend..."
                generate_go "$proto_file"
            fi
        fi
        
        if [[ "$targets" == "all" ]] || [[ "$targets" == *"desktop"* ]]; then
            if [[ -z "$skip" ]] || [[ "$skip" != *"desktop"* ]]; then
                echo "  🚀 Generating for desktop..."
                generate_dart "$proto_file" "$DESKTOP_OUT"
            fi
        fi
        
        if [[ "$targets" == "all" ]] || [[ "$targets" == *"mobile"* ]]; then
            if [[ -z "$skip" ]] || [[ "$skip" != *"mobile"* ]]; then
                echo "  🚀 Generating for mobile..."
                generate_dart "$proto_file" "$MOBILE_OUT"
            fi
        fi
        
        echo ""
    fi
done

echo "✅ Proto generation completed!"