#!/usr/bin/env bash
# warm-builder-cache.sh — Build the Go builder base image on all deploy hosts.
# Run once per Go version bump. Subsequent `make docker-station` skips apt+Go.
#
# Usage:
#   tooling/docker/warm-builder-cache.sh              # all envs
#   tooling/docker/warm-builder-cache.sh station-1    # single env
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENVS_DIR="$PROJECT_ROOT/.local/deploy/envs"
DOCKERFILE="tooling/docker/builder-base.Dockerfile"
IMAGE_TAG="peers-station-builder:go1.24.6"

build_on_host() {
  local env_file="$1"
  local env_name
  env_name="$(basename "$env_file" .env)"

  # shellcheck source=/dev/null
  source "$env_file"

  local host="${PT_DEPLOY_HOST:-}"
  local user="${PT_DEPLOY_USER:-shuxian}"
  local path="${PT_DEPLOY_PATH:-peers-touch}"

  if [[ -z "$host" ]]; then
    echo "[SKIP] $env_name — no PT_DEPLOY_HOST"
    return
  fi

  echo "[BUILD] $env_name ($user@$host) ..."

  # Client-side expansion injects the selected deploy profile into the remote script.
  # shellcheck disable=SC2087
  ssh "$user@$host" bash -s <<EOF
set -e
cd "\$HOME/$path"
if docker image inspect $IMAGE_TAG >/dev/null 2>&1; then
  echo "  [CACHED] $IMAGE_TAG already exists on $host"
else
  echo "  [BUILDING] $IMAGE_TAG on $host ..."
  docker build -f $DOCKERFILE -t $IMAGE_TAG .
  echo "  [DONE] $IMAGE_TAG built on $host"
fi
EOF
}

target="${1:-}"

if [[ -n "$target" ]]; then
  env_file="$ENVS_DIR/$target.env"
  if [[ ! -f "$env_file" ]]; then
    echo "[ERROR] Env file not found: $env_file"
    exit 1
  fi
  build_on_host "$env_file"
else
  for env_file in "$ENVS_DIR"/*.env; do
    build_on_host "$env_file" || true
  done
fi

echo ""
echo "[DONE] Builder cache warmed. Subsequent 'make docker-station' will skip apt+Go install."
