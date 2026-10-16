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
DEPLOY_SCRIPT="$PROJECT_ROOT/tooling/scripts/deploy/deploy.sh"
ENV_REPO="${PT_ENV_REPO:-$(dirname "$PROJECT_ROOT")/env}"
DOCKERFILE="tooling/docker/builder-base.Dockerfile"
IMAGE_TAG="peers-station-builder:go1.24.6"

build_on_host() {
  local env_file="$1"
  local env_name
  env_name="$(basename "$env_file" .env.example)"

  # shellcheck source=/dev/null
  source "$env_file"

  local host="${PT_DEPLOY_HOST:-}"
  local user="${PT_DEPLOY_USER:-}"
  local path="${PT_DEPLOY_PATH:-peers-touch}"

  if [[ -z "$host" || -z "$user" ]]; then
    echo "[SKIP] $env_name — no PT_DEPLOY_HOST or PT_DEPLOY_USER"
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
  if ! env_file="$(PT_ENV_REPO="$ENV_REPO" "$DEPLOY_SCRIPT" resolve "$target")"; then
    exit 1
  fi
  build_on_host "$env_file"
else
  if [[ ! -d "$ENV_REPO/peers-touch" ]] \
    || ! git -C "$ENV_REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "[ERROR] Reviewed environment repository is unavailable: $ENV_REPO"
    exit 1
  fi
  while IFS= read -r relative; do
    env_name="$(basename "$relative" .env.example)"
    env_file="$(PT_ENV_REPO="$ENV_REPO" "$DEPLOY_SCRIPT" resolve "$env_name")"
    build_on_host "$env_file"
  done < <(
    git -C "$ENV_REPO" ls-files \
      'peers-touch/*/deploy/*.env.example' | sort
  )
fi

echo ""
echo "[DONE] Builder cache warmed. Subsequent 'make docker-station' will skip apt+Go install."
