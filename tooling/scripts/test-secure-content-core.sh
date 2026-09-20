#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
SOURCE_CRATE="$PROJECT_ROOT/packages/secure-content-core"
WORK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/pt-secure-content-core.XXXXXX")"
TEMP_CRATE="$WORK_ROOT/packages/secure-content-core"

cleanup() {
  rm -rf "$WORK_ROOT"
}
trap cleanup EXIT

mkdir -p \
  "$TEMP_CRATE" \
  "$WORK_ROOT/model/domain/secure_content" \
  "$WORK_ROOT/target"
cp -R "$SOURCE_CRATE/." "$TEMP_CRATE/"
cp -R \
  "$PROJECT_ROOT/model/domain/secure_content/testdata" \
  "$WORK_ROOT/model/domain/secure_content/"

export CARGO_TARGET_DIR="$WORK_ROOT/target"
cargo test --manifest-path "$TEMP_CRATE/Cargo.toml" "$@"
