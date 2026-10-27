#!/usr/bin/env bash
# accept-onboarding.sh — reproducible acceptance for the developer onboarding
# manual ("make dev-up") on a clean remote Linux host.
#
# The harness is revertible end to end:
#   reset     removes containers, volumes, the clone, profile and workspace
#             registration (fast, keeps the installed toolchain)
#   teardown  additionally uninstalls docker/go/node/rust/client apt packages,
#             apt sources, /opt/peers-dev, profile.d, cargo/rustup and the
#             central-git authorization key — the host returns to pre-run state
#
# Every state-changing command is idempotent, so run/reset/run is a valid loop.
#
# Configuration (env):
#   ACCEPT_HOST          ssh target,        default shuxian@10.37.52.145
#   ACCEPT_REMOTE        git url,           default shuxian@<gitserver>:peers-touch/bare.git
#   ACCEPT_GIT_SERVER    central git host,  default 10.37.246.80
#   ACCEPT_BRANCH        default feat/developer-guidance-enhancement
#   ACCEPT_DIR           remote work dir,   default $HOME/peers-touch-onboarding
#   ACCEPT_REGISTRY      image prefix,      default hub.byted.org ("" disables)
set -euo pipefail

ACCEPT_HOST="${ACCEPT_HOST:-shuxian@10.37.52.145}"
ACCEPT_GIT_SERVER="${ACCEPT_GIT_SERVER:-10.37.246.80}"
ACCEPT_REMOTE="${ACCEPT_REMOTE:-shuxian@${ACCEPT_GIT_SERVER}:peers-touch/bare.git}"
ACCEPT_BRANCH="${ACCEPT_BRANCH:-feat/developer-guidance-enhancement}"
ACCEPT_DIR_NAME="$(basename "${ACCEPT_DIR:-peers-touch-onboarding}")"
ACCEPT_REGISTRY="${ACCEPT_REGISTRY-hub.byted.org}"
SSH_OPTS=(-o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

log()  { printf '\033[36m[accept]\033[0m %s\n' "$*"; }
fail() { printf '\033[31m[accept][FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

rexec() {
  local prefix="ACCEPT_DIR_NAME='$ACCEPT_DIR_NAME' ACCEPT_REGISTRY='$ACCEPT_REGISTRY' ACCEPT_BRANCH='$ACCEPT_BRANCH' ACCEPT_REMOTE='$ACCEPT_REMOTE'"
  [ -n "${BOOTSTRAP_DOCKER_APT:-}" ] && prefix+=" BOOTSTRAP_DOCKER_APT='$BOOTSTRAP_DOCKER_APT'"
  ssh "${SSH_OPTS[@]}" "$ACCEPT_HOST" "$prefix bash -s" "$@"
}

remote_script() {
  # Emit the shared remote function library to stdout.
  cat <<'REMOTE_EOF'
set -euo pipefail
ROOT="$HOME/$ACCEPT_DIR_NAME"
REG_ARGS=()
[ -n "$ACCEPT_REGISTRY" ] && REG_ARGS=(INSECURE_REGISTRY="$ACCEPT_REGISTRY" IMAGE_REGISTRY="$ACCEPT_REGISTRY")
[ -n "${BOOTSTRAP_DOCKER_APT:-}" ] && REG_ARGS+=(BOOTSTRAP_DOCKER_APT="$BOOTSTRAP_DOCKER_APT")

in_repo() { cd "$ROOT"; }
REMOTE_EOF
}

# ─── central git authorization (runs on the operator machine) ───────────────

central_key_comment="shuxian@n37-052-145"

authorize_central() {
  local pub
  pub="$(rexec <<<'cat ~/.ssh/id_rsa.pub')"
  ssh "${SSH_OPTS[@]}" "shuxian@${ACCEPT_GIT_SERVER}" \
    "touch ~/.ssh/authorized_keys; grep -qF '$central_key_comment' ~/.ssh/authorized_keys || echo '$pub' >> ~/.ssh/authorized_keys"
  log "central authorized for host key ($central_key_comment)"
}

revoke_central() {
  ssh "${SSH_OPTS[@]}" "shuxian@${ACCEPT_GIT_SERVER}" \
    "sed -i.tmp '/$central_key_comment/d' ~/.ssh/authorized_keys && rm -f ~/.ssh/authorized_keys.tmp"
  log "central key revoked"
}

# ─── phases ──────────────────────────────────────────────────────────────────

do_clone() {
  log "clone $ACCEPT_BRANCH"
  rexec <<EOF
$(remote_script)
rm -rf "\$ROOT"
git clone -q -b "\$ACCEPT_BRANCH" "\$ACCEPT_REMOTE" "\$ROOT"
cd "\$ROOT"
git config user.email "shuxian@peers.dev"
git config user.name  "Peers Onboarding Acceptance"
EOF
}

# dev-up needs two login sessions when it creates the docker group membership.
do_dev_up() {
  log "dev-up pass 1 (install toolchain; exit 3 = relogin required)"
  set +e
  rexec <<EOF
$(remote_script)
cd "\$ROOT"
make dev-up \${REG_ARGS[@]+"\${REG_ARGS[@]}"}
EOF
  local code=$?
  set -e
  if [ "$code" -ne 0 ] && [ "$code" -ne 3 ]; then
    fail "dev-up pass 1 failed ($code)"
  fi
  log "dev-up pass 2 (fresh login session, starts Station)"
  rexec <<EOF
$(remote_script)
cd "\$ROOT"
make dev-up \${REG_ARGS[@]+"\${REG_ARGS[@]}"}
EOF
}

do_assert() {
  log "assert health and dev seed"
  rexec <<EOF
$(remote_script)
set -e
cd "\$ROOT"
make station-check
# The four dev accounts must have been seeded at Station startup.
docker exec \$(docker ps --format '{{.Names}}' | grep -- '-postgres-1' | head -1) \
  psql -U peers -d peers_touch_local -tAc \
  "SELECT count(*) FROM touch_actor WHERE username IN ('alice','bob','carol','dave')" \
  | grep -qx 4
echo "seed: 4 dev accounts present"
EOF
  log "assertions passed"
}

do_clients() {
  log "client install verification (no GUI started)"
  rexec <<EOF
$(remote_script)
set -e
export PATH=/opt/peers-dev/go/bin:/opt/peers-dev/node/bin:\$HOME/.cargo/bin:\$PATH
cd "\$ROOT"
pnpm install
pnpm applets:build
bash model/build.sh
pnpm --filter @peers-touch/app-desktop run check
pnpm --filter @peers-touch/app-mobile run check
(cd apps/desktop/src-tauri && cargo check)
EOF
  log "client toolchain verified"
}

do_reset() {
  log "project reset (containers, volumes, clone, registration)"
  rexec <<EOF
$(remote_script)
set +e
if [ -d "\$ROOT" ]; then
  cd "\$ROOT"
  docker compose -p pt_local -f tooling/docker/compose.yml --env-file tooling/docker/.env \
    --profile infra --profile station down -v --rmi local --remove-orphans 2>/dev/null || true
fi
set -e
rm -rf "\$ROOT"
rm -f "\$HOME"/.peers-touch/dev/runtime/local/pids/*.pid 2>/dev/null || true
# Remove this clone's machine registration without touching other workspaces.
python3 - "\$ROOT" <<'PY'
import json, os, sys, glob, pathlib
root = os.path.realpath(sys.argv[1])
home = pathlib.Path.home() / '.peers-touch' / 'dev'
for path in glob.glob(str(home / '**' / '*.json'), recursive=True):
    try:
        data = json.loads(pathlib.Path(path).read_text())
    except Exception:
        continue
    blob = json.dumps(data)
    if root in blob:
        pathlib.Path(path).unlink()
        print('removed registration', path)
PY
EOF
  log "reset complete"
}

do_teardown() {
  do_reset
  log "full toolchain teardown"
  rexec <<'EOF'
set +e
sudo systemctl disable --now docker 2>/dev/null
sudo apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin \
  docker-compose-plugin docker-ce-rootless-extras docker-client docker-client-latest \
  docker-common docker-engine docker.io 2>/dev/null
sudo apt-get autoremove -y 2>/dev/null
sudo rm -f /etc/apt/sources.list.d/docker.list /etc/apt/keyrings/docker.gpg /etc/docker/daemon.json \
  /etc/apt/apt.conf.d/99peers-bootstrap
sudo rm -rf /opt/peers-dev /etc/profile.d/peers-dev.sh /var/lib/docker /etc/docker
sudo gpasswd -d "$USER" docker 2>/dev/null || true
rm -rf "$HOME/.cargo" "$HOME/.rustup" "$HOME/.npmrc" "$HOME/.cache/go-build"
sudo apt-get update -qq
set -e
echo "teardown complete"
EOF
  revoke_central
}

usage() {
  sed -n '2,20p' "$0"
  echo "usage: $0 {authorize|run|assert|clients|reset|teardown|all}"
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    authorize) authorize_central ;;
    clone)     do_clone ;;
    run)       do_clone; do_dev_up; do_assert ;;
    assert)    do_assert ;;
    clients)   do_clients ;;
    reset)     do_reset ;;
    teardown)  do_teardown ;;
    all)       authorize_central; do_clone; do_dev_up; do_assert; do_clients ;;
    *) usage; exit 2 ;;
  esac
}

main "$@"
