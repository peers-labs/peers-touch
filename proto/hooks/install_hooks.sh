#!/bin/bash

# Script to install git hooks for proto compliance

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the proto hub directory
PROTO_HUB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../" && pwd)"

# Function to print usage
usage() {
    echo -e "${BLUE}Usage:${NC} $0 <project_directory>"
    echo -e "\nInstalls git hooks for proto compliance in the specified project."
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

# Check if project directory is a git repository
if [ ! -d "$PROJECT_DIR/.git" ]; then
    echo -e "${RED}Error:${NC} Project directory '$PROJECT_DIR' is not a git repository."
    exit 1
fi

# Create hooks directory if it doesn't exist
HOOKS_DIR="$PROJECT_DIR/.git/hooks"
mkdir -p "$HOOKS_DIR"

# Copy pre-commit hook
echo -e "${BLUE}Installing pre-commit hook...${NC}"
cp "$PROTO_HUB_DIR/hooks/pre-commit" "$HOOKS_DIR/"
chmod +x "$HOOKS_DIR/pre-commit"

echo -e "${GREEN}✅ Git hooks installed successfully in $PROJECT_DIR${NC}"
echo -e "${YELLOW}Note:${NC} The pre-commit hook will check for proto compliance before each commit."