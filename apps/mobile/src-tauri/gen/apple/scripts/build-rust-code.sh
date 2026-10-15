#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRCROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_TAURI_DIR="$(cd "$SRCROOT/../.." && pwd)"

if [ -n "${MOBILE_TAURI_DEV_CONFIG:-}" ] && [ -f "${MOBILE_TAURI_DEV_CONFIG}" ]; then
  export TAURI_CONFIG="$(cat "${MOBILE_TAURI_DEV_CONFIG}")"
fi

is_tauri_dev_build() {
  [ -n "${TAURI_CONFIG:-}" ] || return 1
  node -e '
    try {
      const config = JSON.parse(process.env.TAURI_CONFIG);
      process.exit(config?.build?.devUrl ? 0 : 1);
    } catch {
      process.exit(1);
    }
  '
}

globalize_swift_rs_runtime() {
  local archive="$1"
  local nm_output
  if ! nm_output="$(nm "$archive" 2>/dev/null)"; then
    return
  fi
  if ! awk '
    $2 == "t" && $3 == "_release_object" { found = 1 }
    END { exit found ? 0 : 1 }
  ' <<<"$nm_output"; then
    return
  fi

  local rust_host
  rust_host="$(rustc -vV | awk '/^host:/ { print $2 }')"
  local llvm_bin
  llvm_bin="$(rustc --print sysroot)/lib/rustlib/$rust_host/bin"
  local llvm_ar="$llvm_bin/llvm-ar"
  local llvm_objcopy="$llvm_bin/llvm-objcopy"
  if [ ! -x "$llvm_ar" ] || [ ! -x "$llvm_objcopy" ]; then
    echo "Rust llvm-tools are required for Xcode 27 iOS builds." >&2
    echo "Install them with: rustup component add llvm-tools" >&2
    exit 1
  fi

  local work_dir
  work_dir="$(mktemp -d "${TMPDIR:-/tmp}/peers-swiftrs.XXXXXX")"
  (
    cd "$work_dir"
    "$llvm_ar" xN 1 "$archive" SwiftRs.o
    "$llvm_objcopy" \
      --globalize-symbol=_release_object \
      --globalize-symbol=_retain_object \
      --globalize-symbol=_string_from_bytes \
      SwiftRs.o
    local member_count
    member_count="$("$llvm_ar" t "$archive" | awk '$0 == "SwiftRs.o" { count++ } END { print count + 0 }')"
    for ((index = 0; index < member_count; index++)); do
      "$llvm_ar" dN 1 "$archive" SwiftRs.o
    done
    "$llvm_ar" q "$archive" SwiftRs.o
    "$llvm_ar" s "$archive"
  )
  rm -rf "$work_dir"
}

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
  # The Swift host supplies the mobile plugin bridge symbols at the final Xcode
  # link. Build only the static library so Cargo does not try to resolve them
  # early while also linking the crate's cdylib output.
  if [[ "$SDKROOT" == *iPhoneSimulator* || "$SDKROOT" == *iPhoneOS* ]]; then
    cargo_features="custom-protocol,tauri/rustls-tls"
    if [ "${MOBILE_TAURI_STATIC_BUNDLE_BUILD:-0}" = "1" ]; then
      cargo_features="acceptance-harness,custom-protocol,tauri/rustls-tls"
    elif is_tauri_dev_build; then
      cargo_features="tauri/rustls-tls"
    fi
    rust_env_triple="${rust_target//-/_}"
    export "CFLAGS_${rust_env_triple}=-isysroot $SDKROOT"
    export "CXXFLAGS_${rust_env_triple}=-isysroot $SDKROOT"
    export "OBJC_INCLUDE_PATH_${rust_env_triple}=$SDKROOT/usr/include"
    cargo_args=(
      rustc
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
    cargo_args+=(--crate-type staticlib)
    cargo "${cargo_args[@]}"
    globalize_swift_rs_runtime "$rust_lib"
  fi
  external_dir="$SRCROOT/Externals/$external_arch/$CONFIGURATION"
  external_lib="$external_dir/libapp.a"

  if [ ! -f "$rust_lib" ]; then
    echo "Expected Rust static library not found: $rust_lib" >&2
    exit 1
  fi

  mkdir -p "$external_dir"
  cp "$rust_lib" "$external_lib"

  # Swift static archives do not carry their SPM resource bundles.
  resource_manifest="$cargo_target_dir/$rust_target/$profile_dir/mobile-native-resource-bundles"
  if [ ! -f "$resource_manifest" ]; then
    echo "Current native resource bundle manifest not found: $resource_manifest" >&2
    exit 1
  fi
  resource_dir="${TARGET_BUILD_DIR:?}/${UNLOCALIZED_RESOURCES_FOLDER_PATH:?}"
  mkdir -p "$resource_dir"
  while IFS= read -r bundle || [ -n "$bundle" ]; do
    if [ ! -d "$bundle" ] || [[ "$bundle" != *.bundle ]]; then
      echo "Native resource bundle is invalid: $bundle" >&2
      exit 1
    fi
    ditto "$bundle" "$resource_dir/$(basename "$bundle")"
  done < "$resource_manifest"
done
