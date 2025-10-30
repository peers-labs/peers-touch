#!/bin/bash

# Cross-Platform Protobuf Code Generation Script
# Automatically installs protoc and generates code for multiple targets

set -e

# Configuration
PROTO_DIR="./v1"
GO_MODULE="github.com/dirty-bro-tech/peers-touch-proto"

# Output directories for different targets
BACKEND_OUT="../peers-touch-station/backend/proto"
DESKTOP_OUT="../peers-touch-station/desktop/lib/model/proto"
MOBILE_OUT="../peers-touch-mobile/lib/model/proto"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting cross-platform protobuf code generation...${NC}"

# Detect operating system
detect_os() {
    case "$(uname -s)" in
        Darwin*)
            echo "macos"
            ;;
        Linux*)
            echo "linux"
            ;;
        CYGWIN*|MINGW*|MSYS*)
            echo "windows"
            ;;
        *)
            echo "unknown"
            ;;
    esac
}

# Install protoc based on OS
install_protoc() {
    local os=$1
    echo -e "${BLUE}🔍 Checking protoc installation...${NC}"
    
    if command -v protoc &> /dev/null; then
        echo -e "${GREEN}✅ protoc is already installed: $(protoc --version)${NC}"
        return 0
    fi
    
    echo -e "${YELLOW}📦 Installing protoc for $os...${NC}"
    
    case $os in
        "macos")
            if command -v brew &> /dev/null; then
                brew install protobuf
            else
                echo -e "${RED}❌ Homebrew not found. Please install Homebrew first or install protoc manually.${NC}"
                exit 1
            fi
            ;;
        "linux")
            if command -v apt-get &> /dev/null; then
                sudo apt-get update
                sudo apt-get install -y protobuf-compiler
            elif command -v yum &> /dev/null; then
                sudo yum install -y protobuf-compiler
            elif command -v pacman &> /dev/null; then
                sudo pacman -S protobuf
            else
                echo -e "${RED}❌ No supported package manager found. Please install protoc manually.${NC}"
                exit 1
            fi
            ;;
        "windows")
            if command -v choco &> /dev/null; then
                choco install protoc
            elif command -v scoop &> /dev/null; then
                scoop install protobuf
            else
                echo -e "${RED}❌ No supported package manager found. Please install protoc manually or use Chocolatey/Scoop.${NC}"
                exit 1
            fi
            ;;
        *)
            echo -e "${RED}❌ Unsupported operating system: $os${NC}"
            exit 1
            ;;
    esac
    
    # Verify installation
    if command -v protoc &> /dev/null; then
        echo -e "${GREEN}✅ protoc installed successfully: $(protoc --version)${NC}"
    else
        echo -e "${RED}❌ protoc installation failed${NC}"
        exit 1
    fi
}

# Install Go protobuf plugins
install_go_plugins() {
    echo -e "${BLUE}🔍 Checking Go protobuf plugins...${NC}"
    
    if ! command -v protoc-gen-go &> /dev/null; then
        echo -e "${YELLOW}📦 Installing protoc-gen-go...${NC}"
        go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
    fi
    
    if ! command -v protoc-gen-go-grpc &> /dev/null; then
        echo -e "${YELLOW}📦 Installing protoc-gen-go-grpc...${NC}"
        go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
    fi
    
    echo -e "${GREEN}✅ Go protobuf plugins ready${NC}"
}

# Parse generation config from proto file
parse_generation_config() {
    local proto_file=$1
    local target_path=$2
    local result="generate" # Default to generate if no config found
    
    # Check if the file has a PEERS_GENERATION_CONFIG section
    if grep -q "PEERS_GENERATION_CONFIG:" "$proto_file"; then
        # Check if the target path is explicitly skipped
        if grep -q "skip: $target_path" "$proto_file"; then
            result="skip"
        # Check if targets are explicitly listed and this target path is not included
        elif grep -q "target:" "$proto_file" && ! grep -q "target: $target_path" "$proto_file"; then
            result="skip"
        fi
    fi
    
    echo "$result"
}

# Check if model_only flag is set in proto file
check_model_only() {
    local proto_file=$1
    local result="false" # Default to false if no model_only flag found
    
    # Check if the file has a PEERS_GENERATION_CONFIG section with model_only flag
    if grep -q "PEERS_GENERATION_CONFIG:" "$proto_file" && grep -q "model_only: true" "$proto_file"; then
        result="true"
    fi
    
    echo "$result"
}

# Generate code for a specific target
generate_code() {
    local target=$1
    local output_dir=$2
    local lang=$3
    local target_path=$4
    
    echo -e "${BLUE}🔨 Generating $lang code for $target...${NC}"
    
    # Create output directory and parent directories if they don't exist
    mkdir -p "$output_dir"
    
    # Get all proto files
    local proto_files=("$PROTO_DIR"/*.proto)
    local filtered_proto_files=()
    
    # Filter proto files based on generation config
    for proto_file in "${proto_files[@]}"; do
        local should_generate=$(parse_generation_config "$proto_file" "$target_path")
        if [ "$should_generate" = "generate" ]; then
            filtered_proto_files+=("$proto_file")
            echo -e "  ${GREEN}✓${NC} $(basename "$proto_file") (Will generate)"
        else
            echo -e "  ${YELLOW}⚠${NC} $(basename "$proto_file") (Skipped based on config)"
        fi
    done
    
    # If no files to generate, return early
    if [ ${#filtered_proto_files[@]} -eq 0 ]; then
        echo -e "${YELLOW}⚠ No proto files to generate for $target${NC}"
        return 0
    fi
    
    case $lang in
        "go")
            # Check if any of the proto files have model_only flag set
            local model_only_files=()
            local server_files=()
            
            for proto_file in "${filtered_proto_files[@]}"; do
                if [ "$(check_model_only "$proto_file")" = "true" ]; then
                    model_only_files+=("$proto_file")
                    echo -e "  ${YELLOW}ℹ${NC} $(basename "$proto_file") (Model only, no gRPC code)"
                else
                    server_files+=("$proto_file")
                fi
            done
            
            # Generate model-only code (no gRPC)
            if [ ${#model_only_files[@]} -gt 0 ]; then
                protoc \
                    --proto_path="$PROTO_DIR" \
                    --go_out="$output_dir" \
                    --go_opt=module="$GO_MODULE" \
                    "${model_only_files[@]}"
            fi
            
            # Generate full code with gRPC for non-model-only files
            if [ ${#server_files[@]} -gt 0 ]; then
                protoc \
                    --proto_path="$PROTO_DIR" \
                    --go_out="$output_dir" \
                    --go_opt=module="$GO_MODULE" \
                    --go-grpc_out="$output_dir" \
                    --go-grpc_opt=module="$GO_MODULE" \
                    "${server_files[@]}"
            fi
            ;;
        "dart")
            # Check if dart is installed
            if ! command -v dart &> /dev/null; then
                echo -e "${RED}❌ Dart not found. Please install Dart first.${NC}"
                return 1
            fi
            
            # Ensure protoc-gen-dart is in PATH
            if ! command -v protoc-gen-dart &> /dev/null; then
                echo -e "${YELLOW}📦 Installing protoc-gen-dart...${NC}"
                dart pub global activate protoc_plugin
                
                # Add dart pub global to PATH if not already there
                DART_BIN="$(dart pub global bin)"
                if [[ ":$PATH:" != *":$DART_BIN:"* ]]; then
                    export PATH="$DART_BIN:$PATH"
                    echo -e "${YELLOW}📌 Added dart pub global bin to PATH: $DART_BIN${NC}"
                fi
            fi
            
            # Check if we have any proto files to process
            if [ ${#filtered_proto_files[@]} -eq 0 ]; then
                echo -e "${YELLOW}⚠ No proto files to generate for $target${NC}"
                return 0
            fi
            
            # Check if any of the proto files have model_only flag set
            local model_only_files=()
            local server_files=()
            
            for proto_file in "${filtered_proto_files[@]}"; do
                if [ "$(check_model_only "$proto_file")" = "true" ]; then
                    model_only_files+=("$proto_file")
                    echo -e "  ${YELLOW}ℹ${NC} $(basename "$proto_file") (Model only, no gRPC code)"
                else
                    server_files+=("$proto_file")
                fi
            done
            
            # For Dart, we need to generate only model code without server code
            # Generate code first
            protoc \
                --proto_path="$PROTO_DIR" \
                --proto_path="." \
                --dart_out="$output_dir" \
                "${filtered_proto_files[@]}" \
                "google/protobuf/timestamp.proto"
                
            # Then remove any server-related files for model_only files
            for proto_file in "${model_only_files[@]}"; do
                base_name=$(basename "$proto_file" .proto)
                # Remove the pbserver.dart files which contain server-side code
                if [ -f "$output_dir/$base_name.pbserver.dart" ]; then
                    echo -e "  ${YELLOW}🗑️${NC} Removing server code: $base_name.pbserver.dart"
                    rm "$output_dir/$base_name.pbserver.dart"
                fi
            done
            ;;
        *)
            echo -e "${RED}❌ Unsupported language: $lang${NC}"
            return 1
            ;;
    esac
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ $target code generation completed${NC}"
    else
        echo -e "${RED}❌ $target code generation failed${NC}"
        return 1
    fi
}

# Main execution
main() {
    # Detect OS
    OS=$(detect_os)
    echo -e "${BLUE}🖥️  Detected OS: $OS${NC}"
    
    # Check if proto files exist
    if [ ! -d "$PROTO_DIR" ] || [ -z "$(find "$PROTO_DIR" -name '*.proto' 2>/dev/null)" ]; then
        echo -e "${RED}❌ No .proto files found in $PROTO_DIR${NC}"
        exit 1
    fi
    
    # Install protoc if needed
    install_protoc "$OS"
    
    # Install Go plugins
    install_go_plugins
    
    echo -e "${YELLOW}📁 Proto files directory: $PROTO_DIR${NC}"
    echo -e "${YELLOW}📁 Backend output: $BACKEND_OUT${NC}"
    echo -e "${YELLOW}📁 Desktop output: $DESKTOP_OUT${NC}"
    echo -e "${YELLOW}📁 Mobile output: $MOBILE_OUT${NC}"
    
    # Generate code for different targets
    generate_code "Backend (Go)" "$BACKEND_OUT" "go" "peers-touch-station/backend/proto"
    generate_code "Desktop (Flutter/Dart)" "$DESKTOP_OUT" "dart" "peers-touch-station/desktop/lib/model/proto"
    generate_code "Mobile (Flutter/Dart)" "$MOBILE_OUT" "dart" "peers-touch-mobile/lib/model/proto"
    
    echo -e "${GREEN}🎉 All code generation completed successfully!${NC}"
    echo -e "${GREEN}📋 Generated files:${NC}"
    
    for dir in "$BACKEND_OUT" "$DESKTOP_OUT" "$MOBILE_OUT"; do
        if [ -d "$dir" ]; then
            echo -e "${YELLOW}  $dir:${NC}"
            find "$dir" -type f \( -name "*.go" -o -name "*.dart" \) | head -5 | sed 's/^/    - /'
            local count=$(find "$dir" -type f \( -name "*.go" -o -name "*.dart" \) | wc -l)
            if [ "$count" -gt 5 ]; then
                echo "    ... and $((count - 5)) more files"
            fi
        fi
    done
}

# Run main function
main "$@"