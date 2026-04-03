#!/usr/bin/env bash
# IDE configuration setup script.
# Links IDE config from docs/.ide/ (version-controlled source) into each IDE's config directory.
#
# Usage:
#   ./tooling/scripts/ide-setup.sh <ide-name>
#   ./tooling/scripts/ide-setup.sh --clean <ide-name>
#
# Supported IDEs: trae, cursor

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[OK]${NC}   $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERR]${NC}  $1"; }
die()   { error "$1"; exit 1; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IDE_SRC="$ROOT_DIR/docs/.ide"

CLEAN=false
if [[ "${1:-}" == "--clean" ]]; then
  CLEAN=true
  shift
fi

IDE_NAME="${1:-}"
if [[ -z "$IDE_NAME" ]]; then
  die "Usage: $0 [--clean] <trae|cursor>"
fi

if [[ "$IDE_NAME" != "trae" && "$IDE_NAME" != "cursor" ]]; then
  die "Unsupported IDE: $IDE_NAME (expected: trae or cursor)"
fi

[[ -d "$IDE_SRC" ]] || die "Source directory not found: $IDE_SRC"

# --- helpers ---

backup_if_needed() {
  local dir="$1"
  if [[ -e "$dir" && ! -L "$dir" ]]; then
    if [[ -d "$dir" ]]; then
      local backup="${dir}.bak.$(date +%Y%m%d%H%M%S)"
      warn "Existing directory is not a symlink: $dir"
      warn "Backing up to $backup"
      mv "$dir" "$backup"
    fi
  fi
}

ensure_dir() {
  mkdir -p "$1"
}

force_symlink() {
  local src="$1"
  local dest="$2"
  if [[ -L "$dest" ]]; then
    rm "$dest"
  elif [[ -e "$dest" ]]; then
    local backup="${dest}.bak.$(date +%Y%m%d%H%M%S)"
    warn "Non-symlink exists at $dest, backing up to $backup"
    mv "$dest" "$backup"
  fi
  ln -s "$src" "$dest"
  info "$(basename "$dest") -> $src"
}

link_files_flat() {
  local src_dir="$1"
  local dest_dir="$2"
  local pattern="${3:-*}"

  [[ -d "$src_dir" ]] || return 0
  ensure_dir "$dest_dir"

  find "$src_dir" -maxdepth 1 -type f -name "$pattern" | while read -r f; do
    force_symlink "$f" "$dest_dir/$(basename "$f")"
  done
}

clean_ide_dir() {
  local dir="$1"
  if [[ -e "$dir" || -L "$dir" ]]; then
    rm -rf "$dir"
    info "Removed $dir"
  fi
}

# --- scoped rules mapping (bash 3.2 compatible) ---

SCOPED_NAMES=("station-frame" "mobile-flutter")
SCOPED_PATHS=("apps/station/frame" "apps/mobile/flutter")

# --- trae setup ---

setup_trae() {
  local ide_dir="$ROOT_DIR/.trae"

  if $CLEAN; then
    clean_ide_dir "$ide_dir"
  fi

  backup_if_needed "$ide_dir"
  ensure_dir "$ide_dir"

  force_symlink "$IDE_SRC/rules"     "$ide_dir/rules"
  force_symlink "$IDE_SRC/documents" "$ide_dir/documents"
  force_symlink "$IDE_SRC/specs"     "$ide_dir/specs"

  local i
  for i in "${!SCOPED_NAMES[@]}"; do
    local scope="${SCOPED_NAMES[$i]}"
    local scoped_src="$IDE_SRC/scoped/$scope"
    local target_root="$ROOT_DIR/${SCOPED_PATHS[$i]}"
    local target_dir="$target_root/.trae/rules"

    [[ -d "$scoped_src" ]] || continue
    [[ -d "$target_root" ]] || { warn "Target project dir not found, skipping: $target_root"; continue; }

    if $CLEAN; then
      clean_ide_dir "$target_root/.trae"
    fi

    backup_if_needed "$target_dir"
    ensure_dir "$target_root/.trae"
    force_symlink "$scoped_src" "$target_dir"
  done
}

# --- cursor setup ---

setup_cursor() {
  local ide_dir="$ROOT_DIR/.cursor"

  if $CLEAN; then
    clean_ide_dir "$ide_dir"
  fi

  backup_if_needed "$ide_dir"
  ensure_dir "$ide_dir/rules"

  link_files_flat "$IDE_SRC/rules" "$ide_dir/rules" "*.md"
  link_files_flat "$IDE_SRC/rules" "$ide_dir/rules" "*.yml"
  link_files_flat "$IDE_SRC/documents" "$ide_dir/rules" "*.md"

  local i
  for i in "${!SCOPED_NAMES[@]}"; do
    local scope="${SCOPED_NAMES[$i]}"
    local scoped_src="$IDE_SRC/scoped/$scope"
    local target_root="$ROOT_DIR/${SCOPED_PATHS[$i]}"
    local target_dir="$target_root/.cursor/rules"

    [[ -d "$scoped_src" ]] || continue
    [[ -d "$target_root" ]] || { warn "Target project dir not found, skipping: $target_root"; continue; }

    if $CLEAN; then
      clean_ide_dir "$target_root/.cursor"
    fi

    backup_if_needed "$target_dir"
    ensure_dir "$target_dir"
    link_files_flat "$scoped_src" "$target_dir" "*.md"
    link_files_flat "$scoped_src" "$target_dir" "*.yml"
  done
}

# --- main ---

echo ""
info "Setting up IDE config: $IDE_NAME"
echo ""

case "$IDE_NAME" in
  trae)   setup_trae   ;;
  cursor) setup_cursor ;;
esac

echo ""
info "Done. Directory tree:"
echo ""

print_tree() {
  local dir="$1"
  if command -v tree >/dev/null 2>&1; then
    tree -L 3 --noreport "$dir" 2>/dev/null || ls -la "$dir"
  else
    find "$dir" -maxdepth 3 -print | sed "s|$dir||;s|/|  |g;s|^|  |"
  fi
}

print_tree "$ROOT_DIR/.$IDE_NAME"

for i in "${!SCOPED_NAMES[@]}"; do
  local_ide="$ROOT_DIR/${SCOPED_PATHS[$i]}/.$IDE_NAME"
  if [[ -d "$local_ide" || -L "$local_ide/rules" ]]; then
    echo ""
    info "Scoped: ${SCOPED_PATHS[$i]}/.$IDE_NAME"
    print_tree "$local_ide"
  fi
done

echo ""
