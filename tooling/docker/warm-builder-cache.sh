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

build_on_host() (
  local env_file="$1"
  local env_name
  env_name="$(basename "$env_file" .env.example)"

  # The reviewed deploy env (or these restricted-network defaults) owns build
  # transport. Ambient developer shell values must not change a remote image.
  unset APT_MIRROR GO_TARBALL_MIRROR GOPROXY GOSUMDB GONOSUMCHECK || true
  # shellcheck source=/dev/null
  source "$env_file"
  : "${APT_MIRROR:=https://mirrors.aliyun.com}"
  : "${GO_TARBALL_MIRROR:=https://mirrors.aliyun.com/golang}"
  : "${GOPROXY:=https://goproxy.cn,direct}"
  : "${GOSUMDB:=off}"
  : "${GONOSUMCHECK:=*}"

  local host="${PT_DEPLOY_HOST:-}"
  local user="${PT_DEPLOY_USER:-}"
  local path="${PT_DEPLOY_PATH:-peers-touch}"

  if [[ -z "$host" || -z "$user" ]]; then
    echo "[SKIP] $env_name — no PT_DEPLOY_HOST or PT_DEPLOY_USER"
    return
  fi

  echo "[BUILD] $env_name ($user@$host) ..."

  # Quote each SSH argument once; profile overrides must not become remote code.
  local remote_command quoted argument
  local build_args=()
  for argument in APT_MIRROR GO_TARBALL_MIRROR GOPROXY GOSUMDB GONOSUMCHECK; do
    if [[ -n "${!argument:-}" ]]; then
      build_args+=(--build-arg "$argument=${!argument}")
    fi
  done
  remote_command="bash -s --"
  for argument in "$path" "$DOCKERFILE" "$IMAGE_TAG" "${build_args[@]}"; do
    printf -v quoted '%q' "$argument"
    remote_command+=" $quoted"
  done
  ssh "$user@$host" "$remote_command" <<'EOF'
set -euo pipefail
deploy_path="$1"
dockerfile="$2"
image_tag="$3"
shift 3
cd "$HOME/$deploy_path"
# Always evaluate the Dockerfile and ARGs; an old tag alone is not a cache key.
docker build -f "$dockerfile" -t "$image_tag" "$@" .
EOF
)

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
