#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# pt-bootstrap.sh — one-time setup for the Peers-Touch test environment
#
# What it does:
#   1. Removes the legacy `dev-box` docker context (if present).
#   2. Creates four docker contexts pointing at the three remote hosts.
#      (pt-station-2 and pt-station-relay-only intentionally share an
#       SSH endpoint — Docker-layer project namespacing handles isolation.)
#   3. Verifies SSH reachability for each host.
#   4. Verifies that every gitignored .env.<name> file is in place.
#
# Idempotent: re-running is safe; existing contexts are recreated.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

declare -a CONTEXTS=(
  "pt-relay              ssh://shuxian@10.37.118.48"
  "pt-station-1          ssh://shuxian@10.37.246.80"
  "pt-station-2          ssh://shuxian@10.37.195.98"
  "pt-station-relay-only ssh://shuxian@10.37.195.98"
)

declare -a ENV_FILES=(
  "tooling/docker/.env"
  "tooling/docker/.env.pt-relay"
  "tooling/docker/.env.pt-station-1"
  "tooling/docker/.env.pt-station-2"
  "tooling/docker/.env.pt-station-relay-only"
)

echo "═══ Peers-Touch test environment bootstrap ═══"
echo ""

# ── 1. retire legacy context ────────────────────────────────
if docker context inspect dev-box >/dev/null 2>&1; then
  echo "[1/4] Removing legacy 'dev-box' context …"
  docker context rm dev-box
else
  echo "[1/4] Legacy 'dev-box' context already absent."
fi
echo ""

# ── 2. (re)create the four pt-* contexts ────────────────────
echo "[2/4] Registering docker contexts …"
for entry in "${CONTEXTS[@]}"; do
  name="${entry%% *}"
  host="${entry##* }"
  if docker context inspect "$name" >/dev/null 2>&1; then
    docker context rm "$name" >/dev/null
  fi
  docker context create "$name" --docker "host=${host}" >/dev/null
  printf "       %-22s → %s\n" "$name" "$host"
done
echo ""

# ── 3. SSH probe ─────────────────────────────────────────────
# Bash 3 (macOS default) lacks associative arrays. Track probed hosts in a
# whitespace-padded string and substring-match against it. Each host is
# wrapped in spaces so partial matches can't false-positive (e.g. .98 vs .988).
#
# Diagnostic granularity: distinguish (a) SSH unreachable, (b) SSH OK but no
# docker binary, (c) docker present but daemon down / wrong perms. This saves
# guessing time when a host is degraded.
echo "[3/4] Probing SSH + remote docker daemon …"
PROBED=" "
fatal=0
for entry in "${CONTEXTS[@]}"; do
  name="${entry%% *}"
  host="${entry##* }"
  case "$PROBED" in
    *" $host "*) continue ;;
  esac
  PROBED="$PROBED$host "

  # The host token has the form ssh://shuxian@10.37.x.y; carve out the
  # user@addr part for raw-ssh diagnostics.
  ssh_target="${host#ssh://}"

  if docker --context "$name" version --format '{{.Server.Version}}' >/dev/null 2>&1; then
    server_ver="$(docker --context "$name" version --format '{{.Server.Version}}' 2>/dev/null)"
    printf "       %-32s OK (docker %s)\n" "$host" "$server_ver"
    continue
  fi

  # Failure: figure out which level.
  if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$ssh_target" 'true' >/dev/null 2>&1; then
    printf "       %-32s FAIL (ssh unreachable)\n" "$host" >&2
    echo   "         hint: verify network / authorized_keys for $ssh_target" >&2
  elif ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$ssh_target" 'command -v docker' >/dev/null 2>&1; then
    printf "       %-32s FAIL (docker not installed on remote)\n" "$host" >&2
    echo   "         hint: ssh $ssh_target 'sudo apt-get install -y docker.io && sudo usermod -aG docker \$(id -un)'" >&2
  else
    printf "       %-32s FAIL (docker daemon unreachable / perms)\n" "$host" >&2
    echo   "         hint: ssh $ssh_target 'sudo systemctl start docker && groups | grep -q docker'" >&2
  fi
  fatal=1
done
if [ $fatal -ne 0 ]; then
  echo "" >&2
  echo "Bootstrap aborted: at least one remote host is not provisioned." >&2
  exit 4
fi
echo ""

# ── 4. local env files exist ────────────────────────────────
echo "[4/4] Checking gitignored env files …"
missing=0
for f in "${ENV_FILES[@]}"; do
  if [[ -f "$PROJECT_ROOT/$f" ]]; then
    printf "       %-46s present\n" "$f"
  else
    printf "       %-46s MISSING\n" "$f"
    missing=1
  fi
done
if (( missing > 0 )); then
  echo ""
  echo "Some env files are missing. Copy tooling/docker/.env.example, fill in the" >&2
  echo "secrets (or copy from your password manager), and rerun bootstrap." >&2
  exit 5
fi

echo ""
echo "═══ Bootstrap complete. Next: make pt-up ENV=all ═══"
