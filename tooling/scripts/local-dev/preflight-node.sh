#!/usr/bin/env bash
# preflight-node.sh — zero-dependency Node.js pre-bootstrap for `make dev-up`.
#
# dev-up itself is a Node program, so a clean machine needs Node before it can
# install Node. This script is plain POSIX-ish bash + curl + tar: it installs
# the current Node LTS into /opt/peers-dev/node from a China-reachable mirror
# and writes one /etc/profile.d entry. Idempotent: exits 0 when an acceptable
# Node (>= 20) is already on PATH or already installed under /opt/peers-dev.
#
# Overrides:
#   BOOTSTRAP_NODE_VERSION   pin an exact version (e.g. v22.11.0)
#   BOOTSTRAP_NODE_BASE      dist mirror base URL
#   BOOTSTRAP_INSTALL_ROOT   install prefix (default /opt/peers-dev)
set -euo pipefail

INSTALL_ROOT="${BOOTSTRAP_INSTALL_ROOT:-/opt/peers-dev}"
NODE_BASE="${BOOTSTRAP_NODE_BASE:-https://npmmirror.com/mirrors/node}"
PROFILE_D="/etc/profile.d/peers-dev.sh"
MIN_MAJOR=20

log() { printf '[preflight-node] %s\n' "$*"; }

version_major() {
  local version
  version="$("$1" --version 2>/dev/null || true)"
  version="${version#v}"
  printf '%s' "${version%%.*}"
}

if command -v node >/dev/null 2>&1; then
  major="$(version_major node || true)"
  if [ -n "${major:-}" ] && [ "$major" -ge "$MIN_MAJOR" ]; then
    log "node $(node --version) already present"
    exit 0
  fi
fi

if [ -x "$INSTALL_ROOT/node/bin/node" ]; then
  major="$(version_major "$INSTALL_ROOT/node/bin/node" || true)"
  if [ -n "${major:-}" ] && [ "$major" -ge "$MIN_MAJOR" ]; then
    log "node $("$INSTALL_ROOT/node/bin/node" --version) already installed under $INSTALL_ROOT"
    exit 0
  fi
fi

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux)
    node_os="linux"
    case "$arch" in
      x86_64|amd64) node_arch="x64" ;;
      aarch64|arm64) node_arch="arm64" ;;
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;;
    esac
    ;;
  Darwin)
    node_os="darwin"
    case "$arch" in
      x86_64|amd64) node_arch="x64" ;;
      arm64) node_arch="arm64" ;;
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "unsupported OS: $os (use the manual bootstrap on Windows)" >&2
    exit 1
    ;;
esac

version="${BOOTSTRAP_NODE_VERSION:-}"
if [ -z "$version" ]; then
  # Resolve the highest Node LTS with coreutils only (no python, no node):
  # one object per line, keep string-LTS entries ("lts":"Name"), take max.
  version="$(curl -fsSL --retry 3 "$NODE_BASE/index.json" \
    | tr '{' '\n' \
    | grep '"lts":"' \
    | sed -nE 's/.*"version":"(v[0-9]+\.[0-9]+\.[0-9]+)".*/\1/p' \
    | sort -V | tail -1)"
  if [ -z "$version" ]; then
    echo "cannot resolve latest Node LTS from $NODE_BASE/index.json" >&2
    echo "set BOOTSTRAP_NODE_VERSION explicitly" >&2
    exit 1
  fi
fi

log "installing node $version ($node_os-$node_arch) from $NODE_BASE"
archive="$(mktemp -t node-lts.XXXXXX 2>/dev/null || mktemp)"
trap 'rm -f "$archive"' EXIT
curl -fsSL --retry 3 -o "$archive" \
  "$NODE_BASE/$version/node-$version-$node_os-$node_arch.tar.xz"

sudo mkdir -p "$INSTALL_ROOT"
sudo rm -rf "$INSTALL_ROOT/node"
sudo mkdir -p "$INSTALL_ROOT/node"
sudo tar -C "$INSTALL_ROOT/node" --strip-components=1 -xJf "$archive"

tmp_profile="$(mktemp)"
cat >"$tmp_profile" <<EOF
# Peers-Touch developer toolchain (managed by devctl bootstrap)
export PATH="$INSTALL_ROOT/go/bin:$INSTALL_ROOT/node/bin:\$HOME/.cargo/bin:\$PATH"
EOF
sudo install -m 0644 "$tmp_profile" "$PROFILE_D"
rm -f "$tmp_profile"

"$INSTALL_ROOT/node/bin/node" --version
log "installed; new login sessions get it via $PROFILE_D"
