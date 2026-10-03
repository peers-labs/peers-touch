#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# deploy.sh — Remote deployment via pull model
#
# Source modes (PT_DEPLOY_SOURCE):
#   direct  — Push to the target's external source repository via SSH
#   central — Push to central bare repo, remote fetches from it (recommended)
#   local   — Remote fetches from local git daemon via SSH reverse tunnel
#   github  — Remote fetches from GitHub origin
#
# Usage:
#   deploy.sh <env-name> [BRANCH=main]
#   deploy.sh status <env-name>
#   deploy.sh logs <env-name>
#   deploy.sh resolve <env-name>
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SOURCE_SYNC_SCRIPT="$SCRIPT_DIR/source-sync.sh"

cmd="${1:-}"
env_name="${2:-$cmd}"

if [[ "$cmd" == "status" || "$cmd" == "logs" || "$cmd" == "resolve" ]]; then
  env_name="${2:-}"
  if [[ -z "$env_name" ]]; then
    echo "[ERROR] Usage: deploy.sh $cmd <env-name>"
    exit 1
  fi
else
  env_name="$cmd"
fi

if [[ -z "$env_name" ]]; then
  echo "[ERROR] Usage: deploy.sh <env-name> [BRANCH=main]"
  exit 1
fi

resolve_reviewed_deploy_env() {
  local requested_name="$1"
  local env_repo="${PT_ENV_REPO:-$(dirname "$PROJECT_ROOT")/env}"
  if [[ ! "$requested_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
    echo "[ERROR] Invalid deploy environment name: $requested_name" >&2
    return 1
  fi
  if [[ ! -d "$env_repo/peers-touch" ]] \
    || ! git -C "$env_repo" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "[ERROR] Reviewed environment repository is unavailable: $env_repo" >&2
    return 1
  fi

  local matches=()
  local candidate
  while IFS= read -r candidate; do
    [[ -n "$candidate" ]] && matches+=("$candidate")
  done < <(
    find "$env_repo/peers-touch" -mindepth 3 -maxdepth 3 \
      -type f -path "*/deploy/${requested_name}.env.example" -print | sort
  )
  if [[ "${#matches[@]}" -ne 1 ]]; then
    echo "[ERROR] Deploy environment '$requested_name' must resolve to exactly one reviewed env-repository definition; found ${#matches[@]}." >&2
    return 1
  fi

  local resolved="${matches[0]}"
  local relative="${resolved#"$env_repo/"}"
  local profile_dir
  profile_dir="$(dirname "$(dirname "$relative")")"
  if ! git -C "$env_repo" ls-files --error-unmatch "$relative" >/dev/null 2>&1; then
    echo "[ERROR] Deploy environment '$requested_name' is not Git-tracked: $resolved" >&2
    return 1
  fi
  if [[ -n "$(git -C "$env_repo" status --porcelain --untracked-files=all -- "$profile_dir")" ]]; then
    echo "[ERROR] Deploy environment '$requested_name' has dirty or untracked topology under $profile_dir." >&2
    return 1
  fi
  printf '%s\n' "$resolved"
}

if ! ENV_FILE="$(resolve_reviewed_deploy_env "$env_name")"; then
  exit 1
fi
if [[ "$cmd" == "resolve" ]]; then
  printf '%s\n' "$ENV_FILE"
  exit 0
fi

# Load deploy env
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${PT_DEPLOY_HOST:?PT_DEPLOY_HOST not set in $ENV_FILE}"
: "${PT_DEPLOY_USER:?PT_DEPLOY_USER not set in $ENV_FILE}"
: "${PT_DEPLOY_PATH:?PT_DEPLOY_PATH not set in $ENV_FILE}"
: "${PT_DEPLOY_ROLE:?PT_DEPLOY_ROLE not set in $ENV_FILE}"

BRANCH="${BRANCH:-${PT_DEPLOY_BRANCH:-main}}"

acceptance_runtime_env_prefix() {
  local environment="${PT_ACCEPTANCE_ENVIRONMENT:-}"
  local scenario_control="${PT_AGENT_CAPABILITY_SCENARIO_CONTROL:-}"
  local run_id="${PT_ACCEPTANCE_RUN_ID:-}"
  if [[ -z "$environment" && -z "$scenario_control" && -z "$run_id" ]]; then
    return
  fi
  if [[ "$PT_DEPLOY_ROLE" != "station" ]] \
    || [[ "$environment" != "home-station" ]] \
    || [[ "$scenario_control" != "1" ]] \
    || [[ ! "$run_id" =~ ^[0-9]{8}T[0-9]{12}Z-[0-9a-f]{32}$ ]]; then
    echo "[ERROR] Invalid capability Acceptance runtime environment." >&2
    echo "        Require station + home-station + enabled control + valid run ID." >&2
    return 1
  fi
  printf \
    'PT_ACCEPTANCE_ENVIRONMENT=%s PT_AGENT_CAPABILITY_SCENARIO_CONTROL=%s PT_ACCEPTANCE_RUN_ID=%s ' \
    "$environment" \
    "$scenario_control" \
    "$run_id"
}

external_runtime_env_prefix() {
  local runtime_root="${PT_AGENT_EXTERNAL_RUNTIME_ROOT:-}"
  local start_argv="${PT_AGENT_EXTERNAL_START_ARGV_JSON:-}"
  local resume_argv="${PT_AGENT_EXTERNAL_RESUME_ARGV_JSON:-}"
  local reset_argv="${PT_AGENT_EXTERNAL_RESET_ARGV_JSON:-}"
  if [[ -z "$runtime_root" && -z "$start_argv" && -z "$resume_argv" && -z "$reset_argv" ]]; then
    return
  fi
  if [[ "$PT_DEPLOY_ROLE" != "station" ]] \
    || [[ -z "$runtime_root" ]] \
    || [[ -z "$start_argv" ]] \
    || [[ -z "$resume_argv" ]] \
    || [[ -z "$reset_argv" ]] \
    || [[ "$runtime_root" != /* ]]; then
    echo "[ERROR] Invalid external Agent runtime environment." >&2
    echo "        Require station + absolute runtime root + complete start/resume/reset argv JSON." >&2
    return 1
  fi
  printf \
    'PT_AGENT_EXTERNAL_RUNTIME_ROOT=%q PT_AGENT_EXTERNAL_START_ARGV_JSON=%q PT_AGENT_EXTERNAL_RESUME_ARGV_JSON=%q PT_AGENT_EXTERNAL_RESET_ARGV_JSON=%q ' \
    "$runtime_root" \
    "$start_argv" \
    "$resume_argv" \
    "$reset_argv"
}

if [[ "$cmd" != "status" && "$cmd" != "logs" ]]; then
  if ! ACCEPTANCE_RUNTIME_ENV_PREFIX="$(acceptance_runtime_env_prefix)"; then
    exit 1
  fi
  if ! EXTERNAL_RUNTIME_ENV_PREFIX="$(external_runtime_env_prefix)"; then
    exit 1
  fi
  if [[ -n "$ACCEPTANCE_RUNTIME_ENV_PREFIX$EXTERNAL_RUNTIME_ENV_PREFIX" ]] \
    && [[ -z "${PT_DEPLOY_RESTART_CMD:-}" ]]; then
    echo "[ERROR] Runtime variables require a reviewed restart command." >&2
    exit 1
  fi
  if [[ "$PT_DEPLOY_ROLE" == "station" ]]; then
    machine_dev_script="$PROJECT_ROOT/tooling/scripts/local-dev/machine-dev.mjs"
    env_repo="${PT_ENV_REPO:-$(dirname "$PROJECT_ROOT")/env}"
    if [[ "${PT_MACHINE_LEASE_KIND:-}" == "station.deploy" ]] \
      && [[ "${PT_MACHINE_LEASE_RESOURCE_ID:-}" == "$env_name" ]]; then
      node "$machine_dev_script" verify-held \
        --workspace-root "$PROJECT_ROOT" \
        --resource-kind station.deploy \
        --resource-id "$env_name" >/dev/null
    else
      exec node "$machine_dev_script" lease \
        --workspace-root "$PROJECT_ROOT" \
        --env-repo "$env_repo" \
        --resource-kind station.deploy \
        --resource-id "$env_name" \
        --budget-seconds "${PT_STATION_LEASE_BUDGET_SECONDS:-1200}" \
        -- /bin/bash "$SCRIPT_DIR/deploy.sh" "$@"
    fi
  elif [[ "${PT_PROFILE_LEASE_HELD:-0}" != "1" ]]; then
    cd "$PROJECT_ROOT"
    exec env PT_PROFILE_LEASE_HELD=1 \
      python3 -c 'from tooling.acceptance.core.lease import main; raise SystemExit(main())' \
        --resource "$env_name" \
        --owner "deploy:$env_name:${BRANCH:-default}" \
        -- /bin/bash "$SCRIPT_DIR/deploy.sh" "$@"
  fi
fi

SSH_TARGET="${PT_DEPLOY_USER}@${PT_DEPLOY_HOST}"
SSH_OPTS=(
  -o BatchMode=yes
  -o ConnectTimeout=10
  -o ConnectionAttempts=1
  -o StrictHostKeyChecking=yes
  -p "${PT_DEPLOY_SSH_PORT:-22}"
)
if [[ -n "${PT_DEPLOY_KNOWN_HOSTS_FILE:-}" ]]; then
  SSH_OPTS+=(-o "UserKnownHostsFile=$PT_DEPLOY_KNOWN_HOSTS_FILE")
fi

ssh_run() {
  # shellcheck disable=SC2029 # Callers intentionally provide the remote command.
  ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@"
}

remote_cli_runtime_env_prefix() {
  if [[ "$PT_DEPLOY_ROLE" != "station" ]]; then
    return
  fi

  local cli_bin="${PEERS_HOST_CLI_BIN_MOUNT:-}"
  local cli_home="${PEERS_HOST_CLI_HOME_MOUNT:-}"
  if [[ -z "$cli_bin" || -z "$cli_home" ]]; then
    local detected
    if ! detected="$(ssh_run '
      # PT_CLI_MOUNT_DISCOVERY
      set -eu
      resolved_bin=""
      PATH="$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
      for candidate in "$(command -v traecli 2>/dev/null || true)" \
        "$HOME/.local/bin/traecli" \
        "$HOME/.local/bin/traex" \
        "$HOME/.trae/bin/traecli" \
        "$HOME/.trae/bin/traex" \
        /usr/local/bin/traecli \
        /usr/local/bin/traex; do
        if [ -n "$candidate" ] && [ -x "$candidate" ]; then
          resolved_bin="$(readlink -f "$candidate" 2>/dev/null || printf "%s" "$candidate")"
          break
        fi
      done
      resolved_home=""
      if [ -d "$HOME/.trae" ]; then
        resolved_home="$(readlink -f "$HOME/.trae" 2>/dev/null || printf "%s" "$HOME/.trae")"
      fi
      printf "%s|%s\n" "$resolved_bin" "$resolved_home"
    ')"; then
      echo "[WARN] Remote CLI provider discovery failed; deploying without a CLI mount." >&2
      return
    fi
    local detected_bin="${detected%%|*}"
    local detected_home="${detected#*|}"
    [[ -n "$cli_bin" ]] || cli_bin="$detected_bin"
    [[ -n "$cli_home" ]] || cli_home="$detected_home"
  fi

  if [[ -z "$cli_bin" ]]; then
    echo "[INFO] No remote CLI provider binary detected." >&2
    return
  fi
  echo "[INFO] Remote CLI provider mount detected." >&2
  printf 'PEERS_HOST_CLI_BIN_MOUNT=%q PEERS_HOST_CLI_BIN=/usr/local/bin/traecli ' "$cli_bin"
  if [[ -n "$cli_home" ]]; then
    printf 'PEERS_HOST_CLI_HOME_MOUNT=%q PEERS_HOST_CLI_HOME=/root/.trae ' "$cli_home"
  fi
}

case "$cmd" in
  status)
    echo "[$env_name] Checking status on $SSH_TARGET ..."
    ssh_run "cd \$HOME/$PT_DEPLOY_PATH && git log --oneline -1 2>/dev/null || echo 'no git repo'"
    if [[ -n "${PT_DEPLOY_HEALTH_URL:-}" ]]; then
      if curl -fsS -m 3 "$PT_DEPLOY_HEALTH_URL" >/dev/null 2>&1; then
        echo "[OK] Health: $PT_DEPLOY_HEALTH_URL"
      else
        echo "[WARN] Health check failed: $PT_DEPLOY_HEALTH_URL"
      fi
    fi
    ;;

  logs)
    echo "[$env_name] Fetching logs from $SSH_TARGET ..."
    ssh_run "cd \$HOME/$PT_DEPLOY_PATH && tail -n 50 .local/dev/logs/${PT_DEPLOY_ROLE}.log 2>/dev/null || docker compose -p pt-${PT_DEPLOY_ROLE}-c logs --tail=50 ${PT_DEPLOY_ROLE} 2>/dev/null || echo 'No logs found'"
    ;;

  *)
    # ═══ Deploy ═══

    if [[ "${PT_SOURCE_LEASE_HELD:-0}" != "1" ]]; then
      echo "[0/5] Synchronizing exact Git source ..."
      exec /bin/bash "$SOURCE_SYNC_SCRIPT" \
        "$env_name" \
        --environment-file "$ENV_FILE" \
        --branch "$BRANCH" \
        -- \
        /bin/bash "$SCRIPT_DIR/deploy.sh" "$@"
    fi

    echo ""
    echo "═══════════════════════════════════════════════"
    echo "  Deploying: $env_name"
    echo "  Host:      $SSH_TARGET"
    echo "  Path:      \$HOME/$PT_DEPLOY_PATH"
    echo "  Branch:    $BRANCH"
    echo "  Role:      $PT_DEPLOY_ROLE"
    echo "  Source:    exact Git commit via source-sync"
    echo "═══════════════════════════════════════════════"
    echo ""

    echo "[1/5] Verifying synchronized source ..."
    ssh_run "git -C \$HOME/$PT_DEPLOY_PATH log --oneline -1"

    echo "[2/5] Preparing stable dependencies ..."
    if [[ -n "${PT_DEPLOY_DEPENDENCIES_CMD:-}" ]]; then
      ssh_run "cd \$HOME/$PT_DEPLOY_PATH && $PT_DEPLOY_DEPENDENCIES_CMD"
    else
      echo "[INFO] No stable dependencies declared"
    fi

    echo "[3/5] Building ..."
    if [[ -n "${PT_DEPLOY_BUILD_CMD:-}" ]]; then
      ssh_run "cd \$HOME/$PT_DEPLOY_PATH && PEERS_TOUCH_BUILD_COMMIT=\$(git rev-parse HEAD) PEERS_TOUCH_BUILD_LABEL=$BRANCH PEERS_TOUCH_BUILD_TIME=\$(date -u +%Y-%m-%dT%H:%M:%SZ) $PT_DEPLOY_BUILD_CMD"
    else
      case "$PT_DEPLOY_ROLE" in
        station)
          ssh_run "CACHE_ROOT=\$HOME/.cache/peers-touch/build/$env_name && mkdir -p \$CACHE_ROOT/go/mod \$CACHE_ROOT/go/build \$HOME/$PT_DEPLOY_PATH/apps/station/app/bin && cd \$HOME/$PT_DEPLOY_PATH/apps/station/app && GOMODCACHE=\$CACHE_ROOT/go/mod GOCACHE=\$CACHE_ROOT/go/build go build -o bin/station ."
          ;;
        relay)
          ssh_run "CACHE_ROOT=\$HOME/.cache/peers-touch/build/$env_name && mkdir -p \$CACHE_ROOT/go/mod \$CACHE_ROOT/go/build && cd \$HOME/$PT_DEPLOY_PATH && GOMODCACHE=\$CACHE_ROOT/go/mod GOCACHE=\$CACHE_ROOT/go/build make build-relay"
          ;;
        *)
          ssh_run "cd \$HOME/$PT_DEPLOY_PATH && make build"
          ;;
      esac
    fi

    echo "[4/5] Restarting $PT_DEPLOY_ROLE ..."
    if [[ -n "${PT_DEPLOY_RESTART_CMD:-}" ]]; then
      CLI_RUNTIME_ENV_PREFIX="$(remote_cli_runtime_env_prefix)"
      ssh_run "cd \$HOME/$PT_DEPLOY_PATH && ${ACCEPTANCE_RUNTIME_ENV_PREFIX}${EXTERNAL_RUNTIME_ENV_PREFIX}${CLI_RUNTIME_ENV_PREFIX}${PT_DEPLOY_RESTART_CMD}"
    else
      ssh_run "cd \$HOME/$PT_DEPLOY_PATH && systemctl --user restart peers-${PT_DEPLOY_ROLE}"
    fi

    echo "[5/5] Health check ..."
    sleep 2
    if [[ -n "${PT_DEPLOY_HEALTH_URL:-}" ]]; then
      if ssh_run "for i in \$(seq 1 30); do curl -fsS -m 3 $PT_DEPLOY_HEALTH_URL >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1"; then
        echo ""
        echo "[OK] Deploy complete: $env_name ($PT_DEPLOY_ROLE @ $PT_DEPLOY_HOST)"
      else
        echo ""
        echo "[ERROR] Deploy done but health check failed: $PT_DEPLOY_HEALTH_URL"
        exit 1
      fi
    else
      echo "[WARN] No PT_DEPLOY_HEALTH_URL configured — skipping health check"
      echo "[OK] Deploy complete: $env_name (unverified)"
    fi
    ;;
esac
