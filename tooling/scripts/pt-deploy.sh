#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# pt-deploy.sh — orchestrate the test-environment lifecycle
#
# Subcommands:
#   up     <env>            Build + start a single environment (or `all`)
#   down   <env>            Tear it down completely (compose down -v)
#   status                  Show health of every node
#   desktop <env>           Launch the Desktop client paired with <env>
#
# Environments and their per-node configuration are resolved here in one
# place, so the Makefile stays thin. See .localenv §1–§2 for the
# authoritative topology.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/tooling/docker/compose.yml"

ALL_ENVS=(pt-relay pt-station-1 pt-station-2 pt-station-relay-only pt-station-local)

# ─── docker config isolation ─────────────────────────────────
# `docker --context ...` still consults the *local* ~/.docker/config.json
# for credential helpers, even when the build runs on a remote daemon.
# When the user has Docker Desktop's `credsStore: "desktop"` in there but
# the helper binary is not on PATH, every build fails with
#   "exec: docker-credential-desktop: executable file not found".
#
# We do NOT mutate the user's global ~/.docker (they may run Docker Desktop
# in other contexts). Instead, build a side-by-side DOCKER_CONFIG that
# preserves contexts/ and plugins via symlinks but ships its own minimal
# config.json with no credential helpers.
PT_DOCKER_CONFIG="$(mktemp -d -t pt-docker-config.XXXXXX)"
cat > "$PT_DOCKER_CONFIG/config.json" <<EOF
{
  "currentContext": "default",
  "auths": {}
}
EOF
# Symlink every other entry (contexts, buildx, cli-plugins, …) so we don't
# have to enumerate Docker's growing zoo of state directories.
if [ -d "$HOME/.docker" ]; then
  for entry in "$HOME"/.docker/*; do
    [ -e "$entry" ] || continue
    name="$(basename "$entry")"
    [ "$name" = "config.json" ] && continue
    ln -s "$entry" "$PT_DOCKER_CONFIG/$name"
  done
fi
trap 'rm -rf "$PT_DOCKER_CONFIG"' EXIT
export DOCKER_CONFIG="$PT_DOCKER_CONFIG"

# ─── env-file precedence shield ──────────────────────────────
# docker-compose interpolation precedence is: shell-env > --env-file > defaults.
# We deliberately rely on per-env files, so any matching variable already set
# in the operator's shell (e.g. a leftover `export PEERS_AUTH_SECRET=...`
# from a different test run) silently wins and the container boots with the
# wrong secret. This was a real foot-gun that caused JWT auth to fail across
# the test bench.
#
# Strategy: read every `KEY=...` from the target env file BEFORE compose runs
# and unset that key from our process. The user's interactive shell is not
# touched. We do NOT scrub variables that are not in the env file.
clear_envfile_pollution() {
  local file="$1"
  [ -f "$file" ] || return 0
  local key
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$line" ]] && continue
    key="${line%%=*}"
    key="${key//[[:space:]]/}"
    [ -n "$key" ] && unset "$key"
  done < "$file"
}

# ─── per-env resolver ────────────────────────────────────────
# Echoes four space-separated tokens:  CONTEXT  PROFILE  ENV_FILE  HEALTH_URL
# CONTEXT is empty for the local node.
resolve_env() {
  local env="$1"
  case "$env" in
    pt-relay)
      echo "pt-relay relay tooling/docker/.env.pt-relay http://10.37.118.48:18081/sub-oss/healthz"
      ;;
    pt-station-1)
      echo "pt-station-1 station tooling/docker/.env.pt-station-1 http://10.37.246.80:18080/sub-oss/healthz"
      ;;
    pt-station-2)
      echo "pt-station-2 station tooling/docker/.env.pt-station-2 http://10.37.195.98:18080/sub-oss/healthz"
      ;;
    pt-station-relay-only)
      echo "pt-station-relay-only station tooling/docker/.env.pt-station-relay-only http://10.37.195.98:18082/sub-oss/healthz"
      ;;
    pt-station-local)
      echo "  station tooling/docker/.env http://127.0.0.1:18080/sub-oss/healthz"
      ;;
    *)
      echo "[pt-deploy] unknown env: $env" >&2
      echo "  expected: ${ALL_ENVS[*]}  or  all" >&2
      exit 2
      ;;
  esac
}

# ─── compose driver ─────────────────────────────────────────
# Builds the right `docker compose ...` command for one env.
compose_cmd() {
  local context="$1" project="$2" env_file="$3"
  local docker="docker"
  if [[ -n "$context" ]]; then
    docker="docker --context $context"
  fi
  echo "$docker compose -p $project -f $COMPOSE_FILE --env-file $PROJECT_ROOT/$env_file"
}

# ─── up ──────────────────────────────────────────────────────
do_up_one() {
  local env="$1"
  read -r context profile env_file health_url <<<"$(resolve_env "$env")"

  if [[ ! -f "$PROJECT_ROOT/$env_file" ]]; then
    echo "[pt-deploy] missing env file: $env_file" >&2
    echo "[pt-deploy] copy tooling/docker/.env.example and fill in the secrets" >&2
    exit 3
  fi

  echo ""
  echo "── pt-up: $env ────────────────────────────────────────"
  echo "    context : ${context:-<local>}"
  echo "    profile : $profile"
  echo "    envfile : $env_file"
  echo "    health  : $health_url"
  echo ""

  clear_envfile_pollution "$PROJECT_ROOT/$env_file"

  local cmd
  cmd="$(compose_cmd "$context" "$env" "$env_file")"
  # shellcheck disable=SC2086
  $cmd --profile "$profile" --profile infra up -d --build

  echo ""
  echo "[pt-deploy] waiting for healthz at $health_url ..."
  local attempts=24  # 24 × 5s = 2 minutes
  while ((attempts-- > 0)); do
    if curl -fsS --max-time 3 "$health_url" >/dev/null 2>&1; then
      echo "[pt-deploy] $env is healthy."
      return 0
    fi
    sleep 5
  done
  echo "[pt-deploy] $env did not become healthy in time. Inspect with:" >&2
  echo "    $cmd --profile $profile --profile infra logs --tail=80" >&2
  exit 4
}

do_up() {
  local env="$1"
  if [[ "$env" == "all" ]]; then
    for e in "${ALL_ENVS[@]}"; do do_up_one "$e"; done
  else
    do_up_one "$env"
  fi
}

# ─── down ────────────────────────────────────────────────────
do_down_one() {
  local env="$1"
  read -r context _profile env_file _health <<<"$(resolve_env "$env")"

  echo ""
  echo "── pt-down: $env ──────────────────────────────────────"

  clear_envfile_pollution "$PROJECT_ROOT/$env_file"

  local cmd
  cmd="$(compose_cmd "$context" "$env" "$env_file")"
  # shellcheck disable=SC2086
  $cmd --profile station --profile relay --profile infra down -v
}

do_down() {
  local env="$1"
  if [[ "$env" == "all" ]]; then
    for e in "${ALL_ENVS[@]}"; do do_down_one "$e"; done
  else
    do_down_one "$env"
  fi
}

# ─── status ──────────────────────────────────────────────────
do_status() {
  printf "%-26s %-10s %s\n" "ENV" "HEALTH" "URL"
  printf "%-26s %-10s %s\n" "---" "------" "---"
  for env in "${ALL_ENVS[@]}"; do
    read -r _context _profile _env_file health_url <<<"$(resolve_env "$env")"
    if curl -fsS --max-time 3 "$health_url" >/dev/null 2>&1; then
      printf "%-26s %-10s %s\n" "$env" "ok" "$health_url"
    else
      printf "%-26s %-10s %s\n" "$env" "down" "$health_url"
    fi
  done
}

# ─── desktop ─────────────────────────────────────────────────
# Wraps the existing dev-desktop-app.sh with the right REMOTE.
# Note: running multiple Desktops concurrently on the same machine
# requires the INSTANCE_OFFSET patch to dev-desktop-app.sh (tracked
# separately in .localenv §8). One Desktop at a time is fine today.
do_desktop() {
  local env="$1"
  case "$env" in
    pt-station-local)
      exec "$PROJECT_ROOT/tooling/scripts/dev-desktop-app.sh"
      ;;
    pt-station-1|pt-station-2|pt-station-relay-only)
      exec env REMOTE="$env" \
           PEERS_STATION_URL="$(env_to_station_url "$env")" \
           "$PROJECT_ROOT/tooling/scripts/dev-desktop-app.sh"
      ;;
    pt-relay)
      echo "[pt-deploy] pt-relay has no Desktop pairing." >&2
      exit 2
      ;;
    *)
      echo "[pt-deploy] unknown env: $env" >&2
      exit 2
      ;;
  esac
}

env_to_station_url() {
  local env="$1"
  read -r _context _profile env_file _health <<<"$(resolve_env "$env")"
  local host port
  host="$(grep -E '^STATION_HOST=' "$PROJECT_ROOT/$env_file" | head -1 | cut -d= -f2-)"
  port="$(grep -E '^STATION_PORT=' "$PROJECT_ROOT/$env_file" | head -1 | cut -d= -f2-)"
  echo "http://${host}:${port:-18080}"
}

# ─── dispatch ────────────────────────────────────────────────
cmd="${1:-}"
shift || true
case "$cmd" in
  up)      do_up "${1:?usage: pt-deploy up <env|all>}" ;;
  down)    do_down "${1:?usage: pt-deploy down <env|all>}" ;;
  status)  do_status ;;
  desktop) do_desktop "${1:?usage: pt-deploy desktop <env>}" ;;
  *)
    cat >&2 <<EOF
Usage: $(basename "$0") <subcommand> [args]

Subcommands:
  up      <env|all>   Build + start the environment(s)
  down    <env|all>   Tear down (compose down -v) — host returns to neutral
  status              Health check across all five environments
  desktop <env>       Launch the Desktop client paired with <env>

Known envs: ${ALL_ENVS[*]}
EOF
    exit 1
    ;;
esac
