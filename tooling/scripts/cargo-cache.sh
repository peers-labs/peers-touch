#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
CARGO_HOME_DIR="${CARGO_HOME:-$HOME/.cargo}"
MACHINE_ROOT="${PT_CARGO_CACHE_ROOT:-$HOME/.peers-touch/dev/cargo-cache}"
MACHINE_BIN="$MACHINE_ROOT/bin/peers-rustc-wrapper"
MACHINE_CONFIG="$MACHINE_ROOT/config.toml"
CACHE_DIR="${SCCACHE_DIR:-$MACHINE_ROOT/data}"
CACHE_SIZE="${SCCACHE_CACHE_SIZE:-${PT_CARGO_CACHE_SIZE:-10G}}"
CONFIG_MARKER_BEGIN="# BEGIN peers-touch cargo cache"
CONFIG_MARKER_END="# END peers-touch cargo cache"
VERIFY_TEMP_ROOT=""

cleanup_verify() {
  if [[ -n "$VERIFY_TEMP_ROOT" ]]; then
    rm -rf "$VERIFY_TEMP_ROOT"
  fi
}

fail() {
  printf '[cargo-cache] ERROR: %s\n' "$*" >&2
  exit 1
}

find_sccache() {
  if [[ "${PT_SCCACHE_BIN+x}" == "x" ]]; then
    [[ -x "${PT_SCCACHE_BIN:-}" ]] || return 1
    printf '%s\n' "$PT_SCCACHE_BIN"
    return 0
  fi

  if command -v sccache >/dev/null 2>&1; then
    command -v sccache
    return 0
  fi

  local candidate
  for candidate in \
    "$CARGO_HOME_DIR/bin/sccache" \
    /opt/homebrew/bin/sccache \
    /usr/local/bin/sccache; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

cache_disabled() {
  case "${PT_CARGO_CACHE:-1}" in
    0|false|FALSE|off|OFF|disabled|DISABLED) return 0 ;;
    *) return 1 ;;
  esac
}

run_wrapper() {
  [[ "$#" -gt 0 ]] || fail "Cargo did not provide a compiler command"

  if cache_disabled; then
    exec "$@"
  fi

  local backend
  if ! backend="$(find_sccache)"; then
    exec "$@"
  fi

  mkdir -p "$CACHE_DIR"
  export SCCACHE_DIR="$CACHE_DIR"
  export SCCACHE_CACHE_SIZE="$CACHE_SIZE"
  exec "$backend" "$@"
}

cargo_user_config() {
  if [[ -f "$CARGO_HOME_DIR/config" ]]; then
    printf '%s\n' "$CARGO_HOME_DIR/config"
  else
    printf '%s\n' "$CARGO_HOME_DIR/config.toml"
  fi
}

toml_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

install_backend() {
  local backend
  if backend="$(find_sccache)"; then
    printf '[cargo-cache] backend: %s\n' "$backend"
    return 0
  fi

  if [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    printf '[cargo-cache] installing sccache with Homebrew\n'
    HOMEBREW_NO_AUTO_UPDATE=1 brew install sccache
  elif command -v cargo >/dev/null 2>&1; then
    printf '[cargo-cache] installing sccache with cargo\n'
    cargo install sccache --locked
  else
    fail "sccache is missing and no supported installer is available"
  fi

  backend="$(find_sccache)" || fail "sccache installation completed without an executable"
  printf '[cargo-cache] backend: %s\n' "$backend"
}

install_machine_wrapper() {
  local wrapper_temp config_temp
  mkdir -p "$MACHINE_ROOT/bin" "$CACHE_DIR"
  if [[ "$SCRIPT_PATH" != "$MACHINE_BIN" ]]; then
    wrapper_temp="$(mktemp "$MACHINE_ROOT/bin/.peers-rustc-wrapper.XXXXXX")"
    install -m 0755 "$SCRIPT_PATH" "$wrapper_temp"
    mv "$wrapper_temp" "$MACHINE_BIN"
  fi

  local escaped_wrapper
  escaped_wrapper="$(toml_escape "$MACHINE_BIN")"
  config_temp="$(mktemp "$MACHINE_ROOT/.config.toml.XXXXXX")"
  {
    printf '[build]\n'
    printf 'rustc-wrapper = "%s"\n' "$escaped_wrapper"
  } > "$config_temp"
  chmod 0600 "$config_temp"
  mv "$config_temp" "$MACHINE_CONFIG"
}

install_cargo_include() {
  mkdir -p "$CARGO_HOME_DIR"

  local config_path escaped_config temp_path
  config_path="$(cargo_user_config)"
  escaped_config="$(toml_escape "$MACHINE_CONFIG")"

  if [[ -f "$config_path" ]] && grep -Fq "$CONFIG_MARKER_BEGIN" "$config_path"; then
    grep -Fq "$MACHINE_CONFIG" "$config_path" \
      || fail "managed Cargo include exists but points to another cache config: $config_path"
    printf '[cargo-cache] Cargo include already configured: %s\n' "$config_path"
    return 0
  fi

  if [[ -f "$config_path" ]] \
    && grep -Eq '^[[:space:]]*include[[:space:]]*=' "$config_path"; then
    fail "Cargo config already owns a top-level include; merge $MACHINE_CONFIG into $config_path explicitly"
  fi

  temp_path="$(mktemp "$CARGO_HOME_DIR/.config.toml.peers-cache.XXXXXX")"
  {
    printf '%s\n' "$CONFIG_MARKER_BEGIN"
    printf 'include = [{ path = "%s", optional = true }]\n' "$escaped_config"
    printf '%s\n' "$CONFIG_MARKER_END"
    if [[ -s "$config_path" ]]; then
      printf '\n'
      command cat "$config_path"
    fi
  } > "$temp_path"
  chmod 0600 "$temp_path"
  mv "$temp_path" "$config_path"
  printf '[cargo-cache] Cargo include configured: %s\n' "$config_path"
}

show_status() {
  local backend config_path
  config_path="$(cargo_user_config)"
  printf 'machine_root=%s\n' "$MACHINE_ROOT"
  printf 'cache_dir=%s\n' "$CACHE_DIR"
  printf 'cache_size=%s\n' "$CACHE_SIZE"
  printf 'repo_wrapper=%s\n' "$SCRIPT_PATH"
  printf 'machine_wrapper=%s\n' "$MACHINE_BIN"
  printf 'machine_config=%s\n' "$MACHINE_CONFIG"
  printf 'cargo_user_config=%s\n' "$config_path"

  if backend="$(find_sccache)"; then
    printf 'backend=%s\n' "$backend"
    SCCACHE_DIR="$CACHE_DIR" SCCACHE_CACHE_SIZE="$CACHE_SIZE" \
      "$backend" --show-stats
  else
    printf 'backend=unavailable\n'
    return 1
  fi
}

ensure_server() {
  local backend="$1"
  if SCCACHE_DIR="$CACHE_DIR" SCCACHE_CACHE_SIZE="$CACHE_SIZE" \
    "$backend" --show-stats >/dev/null 2>&1; then
    return 0
  fi

  SCCACHE_DIR="$CACHE_DIR" SCCACHE_CACHE_SIZE="$CACHE_SIZE" \
    "$backend" --start-server >/dev/null 2>&1 \
    || SCCACHE_DIR="$CACHE_DIR" SCCACHE_CACHE_SIZE="$CACHE_SIZE" \
      "$backend" --show-stats >/dev/null
}

cache_hit_count() {
  python3 -c '
import json
import sys

payload = json.load(sys.stdin)

def total(value):
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, dict):
        return sum(total(child) for child in value.values())
    if isinstance(value, list):
        return sum(total(child) for child in value)
    return 0

def find(value):
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = key.lower().replace(" ", "_").replace("-", "_")
            if normalized == "cache_hits":
                if isinstance(child, dict) and "counts" in child:
                    return total(child["counts"])
                return total(child)
            found = find(child)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find(child)
            if found is not None:
                return found
    return None

hits = find(payload)
if hits is None:
    raise SystemExit("cache_hits field missing from sccache statistics")
print(int(hits))
'
}

verify_cache() {
  local backend temp_root hits user_config
  backend="$(find_sccache)" || fail "sccache is unavailable; run cargo-cache-setup first"
  command -v cargo >/dev/null 2>&1 || fail "cargo is unavailable"
  command -v python3 >/dev/null 2>&1 || fail "python3 is unavailable"
  user_config="$(cargo_user_config)"
  [[ -x "$MACHINE_BIN" ]] || fail "machine wrapper is missing; run cargo-cache-setup first"
  [[ -f "$MACHINE_CONFIG" ]] || fail "machine cache config is missing; run cargo-cache-setup first"
  if [[ ! -f "$user_config" ]] \
    || ! grep -Fq "$CONFIG_MARKER_BEGIN" "$user_config"; then
    fail "Cargo user config does not include the machine cache; run cargo-cache-setup first"
  fi

  temp_root="$(mktemp -d "${TMPDIR:-/tmp}/peers-cargo-cache.XXXXXX")"
  VERIFY_TEMP_ROOT="$temp_root"
  trap cleanup_verify EXIT INT TERM
  mkdir -p \
    "$temp_root/shared-dependency/src" \
    "$temp_root/worktree-a/cache-probe/src" \
    "$temp_root/worktree-b/cache-probe/src"

  {
    printf '[package]\n'
    printf 'name = "peers-cargo-cache-shared"\n'
    printf 'version = "0.1.0"\n'
    printf 'edition = "2021"\n'
  } > "$temp_root/shared-dependency/Cargo.toml"
  {
    printf 'pub fn shared_dependency(value: u64) -> u64 {\n'
    printf '    value.rotate_left(7) ^ 0x5a5a_5a5a_5a5a_5a5a\n'
    printf '}\n'
  } > "$temp_root/shared-dependency/src/lib.rs"

  for worktree in worktree-a worktree-b; do
    {
      printf '[package]\n'
      printf 'name = "peers-cargo-cache-probe"\n'
      printf 'version = "0.1.0"\n'
      printf 'edition = "2021"\n'
      printf '\n[dependencies]\n'
      printf 'peers-cargo-cache-shared = { path = "../../shared-dependency" }\n'
    } > "$temp_root/$worktree/cache-probe/Cargo.toml"
    {
      printf 'pub fn shared_compile_probe(value: u64) -> u64 {\n'
      printf '    peers_cargo_cache_shared::shared_dependency(value)\n'
      printf '}\n'
    } > "$temp_root/$worktree/cache-probe/src/lib.rs"
  done

  export SCCACHE_DIR="$CACHE_DIR"
  export SCCACHE_CACHE_SIZE="$CACHE_SIZE"
  export CARGO_INCREMENTAL=0
  ensure_server "$backend"
  "$backend" --zero-stats >/dev/null

  (
    cd "$temp_root/worktree-a/cache-probe"
    cargo check --offline --quiet
  )
  (
    cd "$temp_root/worktree-b/cache-probe"
    cargo check --offline --quiet
  )

  [[ -d "$temp_root/worktree-a/cache-probe/target" ]] \
    || fail "first worktree target directory is missing"
  [[ -d "$temp_root/worktree-b/cache-probe/target" ]] \
    || fail "second worktree target directory is missing"

  hits="$("$backend" --show-stats --stats-format json | cache_hit_count)"
  [[ "$hits" -ge 1 ]] || fail "cross-directory verification produced no cache hit"

  printf '[cargo-cache] verification passed: cache_hits=%s\n' "$hits"
  printf '[cargo-cache] targets remained isolated\n'
  cleanup_verify
  VERIFY_TEMP_ROOT=""
  trap - EXIT INT TERM
}

setup_cache() {
  install_backend
  install_machine_wrapper
  install_cargo_include

  local backend
  backend="$(find_sccache)" || fail "sccache is unavailable after setup"
  ensure_server "$backend"
  printf '[cargo-cache] ready: shared compiler cache at %s (max %s)\n' \
    "$CACHE_DIR" "$CACHE_SIZE"
}

usage() {
  printf 'Usage: %s <setup|status|verify|compiler ...>\n' "$0"
}

case "${1:-}" in
  setup)
    shift
    [[ "$#" -eq 0 ]] || fail "setup accepts no arguments"
    setup_cache
    ;;
  status)
    shift
    [[ "$#" -eq 0 ]] || fail "status accepts no arguments"
    show_status
    ;;
  verify)
    shift
    [[ "$#" -eq 0 ]] || fail "verify accepts no arguments"
    verify_cache
    ;;
  help|-h|--help)
    usage
    ;;
  "")
    usage >&2
    exit 2
    ;;
  *)
    run_wrapper "$@"
    ;;
esac
