#!/usr/bin/env bash
#
# WE-20261104 — Go client ↔ real provisioner integration.
#
# The sandbox package unit tests use in-process fake clients and the we-s6/
# we-s7 gates hit the provisioner over HTTP directly. This script closes the
# remaining seam: it starts a real provisioner (published on a host port) and
# runs the Go HTTPClient suite against it, exercising allocate/exec/dormant/
# cold-start/reconcile and the interactive PTY over the actual JSON wire.
#
# Usage:  bash tooling/acceptance/closures/we-s6/go-client-integration.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
NET="wbox-isolated"
MGMT="wbox-go-it"
PROV="we-go-integration"
PORT="18091"
BASE_TAG="peers/workspace-sandbox-base:24.04-1"
PROV_TAG="peers/workspace-sandbox-provisioner:dev"

cleanup() {
  docker rm -f "$PROV" >/dev/null 2>&1 || true
  for name in $(docker ps -a --format '{{.Names}}' | grep '^wbox-goitest'); do
    docker rm -f "$name" >/dev/null 2>&1 || true
  done
  for vol in $(docker volume ls --format '{{.Name}}' | grep '^wbox-vol-goitest'); do
    docker volume rm "$vol" >/dev/null 2>&1 || true
  done
  docker network rm "$MGMT" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Base image must exist (built by the we-s7 gates or explicitly).
docker image inspect "$BASE_TAG" >/dev/null 2>&1 || {
  docker build -q -t "$BASE_TAG" \
    -f "$ROOT/tooling/docker/sandbox/sandbox-base.Dockerfile" \
    --build-arg APT_MIRROR=mirrors.aliyun.com "$ROOT" >/dev/null
}
docker build -q -t "$PROV_TAG" -f "$ROOT/tooling/docker/sandbox/provisioner.Dockerfile" "$ROOT" >/dev/null
IMAGE_ID="$(docker inspect -f '{{.Id}}' "$BASE_TAG")"

docker network inspect "$NET" >/dev/null 2>&1 || docker network create --internal "$NET" >/dev/null
docker network inspect "$MGMT" >/dev/null 2>&1 || docker network create "$MGMT" >/dev/null
cleanup
docker network inspect "$NET" >/dev/null 2>&1 || docker network create --internal "$NET" >/dev/null
docker network inspect "$MGMT" >/dev/null 2>&1 || docker network create "$MGMT" >/dev/null

docker run -d --name "$PROV" -p "$PORT:8090" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e "SANDBOX_ALLOWED_IMAGE_IDS=$IMAGE_ID" \
  -e "SANDBOX_ISOLATED_NETWORK=$NET" \
  --network "$MGMT" "$PROV_TAG" >/dev/null
sleep 2

cd "$ROOT/apps/station/app"
PEERS_SANDBOX_INTEGRATION=1 \
PEERS_SANDBOX_PROVISIONER_URL="http://127.0.0.1:$PORT" \
PEERS_SANDBOX_IMAGE="$IMAGE_ID" \
  go test ./subserver/agent/service/sandbox -run Integration -count=1 -v
