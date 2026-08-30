#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRCROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_TAURI_DIR="$(cd "$SRCROOT/../.." && pwd)"

if [ -n "${MOBILE_TAURI_DEV_CONFIG:-}" ] && [ -f "${MOBILE_TAURI_DEV_CONFIG}" ]; then
  export TAURI_CONFIG="$(cat "${MOBILE_TAURI_DEV_CONFIG}")"
fi

if [ "${MOBILE_TAURI_STATIC_BUNDLE_BUILD:-0}" != "1" ]; then
  pnpm tauri ios xcode-script -v \
    --platform "${PLATFORM_DISPLAY_NAME:?}" \
    --sdk-root "${SDKROOT:?}" \
    --framework-search-paths "${FRAMEWORK_SEARCH_PATHS:?}" \
    --header-search-paths "${HEADER_SEARCH_PATHS:?}" \
    --gcc-preprocessor-definitions "${GCC_PREPROCESSOR_DEFINITIONS:-}" \
    --configuration "${CONFIGURATION:?}" \
    ${FORCE_COLOR:-} \
    ${ARCHS:?}
fi

profile_dir="$CONFIGURATION"
if [ "$CONFIGURATION" = "debug" ]; then
  profile_dir="debug"
elif [ "$CONFIGURATION" = "release" ]; then
  profile_dir="release"
fi

for arch in ${ARCHS:?}; do
  case "${SDKROOT}:${arch}" in
    *iPhoneSimulator*:*arm64*)
      rust_target="aarch64-apple-ios-sim"
      external_arch="arm64-sim"
      ;;
    *iPhoneSimulator*:*x86_64*)
      rust_target="x86_64-apple-ios"
      external_arch="x86_64"
      ;;
    *iPhoneOS*:*arm64*)
      rust_target="aarch64-apple-ios"
      external_arch="arm64"
      ;;
    *)
      continue
      ;;
  esac

  cargo_target_dir="${CARGO_TARGET_DIR:-$SRC_TAURI_DIR/target}"
  rust_lib="$cargo_target_dir/$rust_target/$profile_dir/libpeers_touch_mobile_lib.a"
  if [[ "$rust_target" == *-sim ]] && {
    [ ! -f "$rust_lib" ] \
      || [ "${MOBILE_TAURI_STATIC_BUNDLE_BUILD:-0}" = "1" ]
  }; then
    cargo_features="tauri/rustls-tls"
    if [ "${MOBILE_TAURI_STATIC_BUNDLE_BUILD:-0}" = "1" ]; then
      cargo_features="custom-protocol,tauri/rustls-tls"
    fi
    cargo_args=(
      build
      --package peers-touch-mobile
      --manifest-path "$SRC_TAURI_DIR/Cargo.toml"
      --target "$rust_target"
      --features "$cargo_features"
      --lib
      --no-default-features
    )
    if [ "$CONFIGURATION" = "release" ]; then
      cargo_args+=(--release)
    fi
    cargo "${cargo_args[@]}"
  fi
  external_dir="$SRCROOT/Externals/$external_arch/$CONFIGURATION"
  external_lib="$external_dir/libapp.a"

  if [ ! -f "$rust_lib" ]; then
    echo "Expected Rust static library not found: $rust_lib" >&2
    exit 1
  fi

  mkdir -p "$external_dir"
  cp "$rust_lib" "$external_lib"
done
