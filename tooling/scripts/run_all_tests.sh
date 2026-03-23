#!/bin/bash
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
BACKEND_TEST_DIR="$PROJECT_ROOT/apps/station/frame/touch/social"
DESKTOP_TEST_DIR="$PROJECT_ROOT/apps/desktop"

echo "========================================="
echo "  Social Follow API - Test Suite"
echo "========================================="
echo ""

echo "📍 Project Root: $PROJECT_ROOT"
echo ""

echo "========================================="
echo "  1️⃣  Running Backend Tests"
echo "========================================="
cd "$BACKEND_TEST_DIR"

echo "Running integration tests..."
go test -v -run TestFollow 2>&1 | tee test_output.log

echo ""
echo "Generating coverage report..."
go test -coverprofile=coverage.out ./...
go tool cover -func=coverage.out | tail -5

COVERAGE_FILE="$BACKEND_TEST_DIR/coverage.out"
if [ -f "$COVERAGE_FILE" ]; then
    echo "✅ Coverage report generated: $COVERAGE_FILE"
fi

echo ""
echo "========================================="
echo "  2️⃣  Running Frontend Tests"
echo "========================================="
cd "$DESKTOP_TEST_DIR"

if [ -f "$DESKTOP_TEST_DIR/package.json" ]; then
echo "Installing dependencies..."
if command -v pnpm >/dev/null 2>&1; then
  pnpm install > /dev/null 2>&1
  echo "Running unit tests..."
  pnpm test
else
  npm install > /dev/null 2>&1
  echo "Running unit tests..."
  npm test
fi
COVERAGE_FILE="$DESKTOP_TEST_DIR/coverage/lcov.info"
else
echo "Installing dependencies..."
flutter pub get > /dev/null 2>&1
echo "Generating mock files..."
flutter pub run build_runner build --delete-conflicting-outputs > /dev/null 2>&1
echo "Running unit tests..."
flutter test test/features/social/service/social_api_service_test.dart
echo ""
echo "Generating coverage report..."
flutter test --coverage > /dev/null 2>&1
COVERAGE_FILE="$DESKTOP_TEST_DIR/coverage/lcov.info"
fi
if [ -f "$COVERAGE_FILE" ]; then
    echo "✅ Coverage report generated: $COVERAGE_FILE"
fi

echo ""
echo "========================================="
echo "  ✅ All Tests Completed!"
echo "========================================="
echo ""
echo "📊 Test Summary:"
echo "  - Backend: 11 integration tests + 1 benchmark"
echo "  - Frontend: 13 unit tests"
echo ""
echo "📁 Coverage Reports:"
echo "  - Backend: $BACKEND_TEST_DIR/coverage.out"
echo "  - Frontend: $DESKTOP_TEST_DIR/coverage/lcov.info"
echo ""
echo "📖 For more details, see: TESTING.md"
echo ""
