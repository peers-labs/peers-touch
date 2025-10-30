#!/bin/bash

# check_proto_compliance.sh
# Script to check if a project is using proto definitions that aren't defined in the central repository

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROTO_HUB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROTO_FILES_DIR="${PROTO_HUB_DIR}/v1"

# Function to print usage
usage() {
    echo -e "${BLUE}Usage:${NC} $0 <project_directory>"
    echo -e "\nChecks if a project is using proto definitions that aren't defined in the central repository."
    echo -e "\nExample: $0 ../peers-touch-mobile"
    exit 1
}

# Check if project directory is provided
if [ $# -ne 1 ]; then
    usage
fi

PROJECT_DIR="$1"

# Check if project directory exists
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${RED}Error:${NC} Project directory '$PROJECT_DIR' does not exist."
    exit 1
fi

echo -e "${BLUE}Checking proto compliance for:${NC} $PROJECT_DIR"
echo -e "${BLUE}Proto hub directory:${NC} $PROTO_HUB_DIR"

# Find all .proto files in the project directory
echo -e "\n${YELLOW}Searching for .proto files in project...${NC}"
PROJECT_PROTO_FILES=$(find "$PROJECT_DIR" -name "*.proto" 2>/dev/null || true)

if [ -z "$PROJECT_PROTO_FILES" ]; then
    echo -e "${GREEN}✅ No .proto files found in project. Compliance check passed.${NC}"
    exit 0
fi

# Count the number of .proto files found
PROTO_COUNT=$(echo "$PROJECT_PROTO_FILES" | wc -l | tr -d ' ')
echo -e "${YELLOW}Found $PROTO_COUNT .proto file(s) in project:${NC}"

# Check each .proto file
VIOLATIONS=0
for PROTO_FILE in $PROJECT_PROTO_FILES; do
    RELATIVE_PATH=$(realpath --relative-to="$PROJECT_DIR" "$PROTO_FILE")
    
    # Check if this is a generated file
    if [[ "$PROTO_FILE" == *"/gen/"* ]] || [[ "$PROTO_FILE" == *"/generated/"* ]]; then
        echo -e "  ${GREEN}✓${NC} $RELATIVE_PATH (Generated file, skipping)"
        continue
    fi
    
    # Check if this file exists in the proto hub
    FILENAME=$(basename "$PROTO_FILE")
    if [ -f "$PROTO_FILES_DIR/$FILENAME" ]; then
        echo -e "  ${GREEN}✓${NC} $RELATIVE_PATH (Defined in proto hub)"
    else
        echo -e "  ${RED}✗${NC} $RELATIVE_PATH ${RED}(NOT defined in proto hub)${NC}"
        VIOLATIONS=$((VIOLATIONS + 1))
    fi
done

# Print summary
echo -e "\n${BLUE}Summary:${NC}"
if [ $VIOLATIONS -eq 0 ]; then
    echo -e "${GREEN}✅ All proto files are compliant with the central proto hub.${NC}"
    exit 0
else
    echo -e "${RED}❌ Found $VIOLATIONS proto file(s) that are not defined in the central proto hub.${NC}"
    echo -e "${YELLOW}Action required:${NC} Move these proto definitions to the proto hub repository."
    echo -e "See the PROTO_GUIDELINES.md file for more information."
    exit 1
fi