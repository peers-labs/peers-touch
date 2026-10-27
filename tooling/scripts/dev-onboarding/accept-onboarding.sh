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
# make maps a recipe exit code to 2, so membership state (not exit code) is
# the signal: the entry exists in /etc/group but the current SSH session was
# created before the change.
do_dev_up() {
  log "dev-up pass 1 (bootstrap toolchain)"
  rexec <<EOF
$(remote_script)
set -e
cd "\$ROOT"
make dev-up \${REG_ARGS[@]+"\${REG_ARGS[@]}"} || \\
  if id -nG | grep -qw docker; then exit 0; \\
  elif getent group docker | grep -qw "\$USER"; then echo "relogin required"; else exit 1; fi
EOF
  log "dev-up pass 2 (fresh login session, starts Station)"
  rexec <<EOF
$(remote_script)
set -e
cd "\$ROOT"
make dev-up \${REG_ARGS[@]+"\${REG_ARGS[@]}"}
EOF
}

do_assert() {
  log "assert health and dev seed"
  rexec <<EOF
$(remote_script)
set -e
export PATH=/opt/peers-dev/go/bin:/opt/peers-dev/node/bin:\$HOME/.cargo/bin:\$PATH
cd "\$ROOT"
make station-check
pg="\$(docker ps --format '{{.Names}}' | grep -- '-postgres-1' | head -1)"
# The four dev accounts must have been seeded at Station startup.
docker exec -u postgres "\$pg" psql -U peers -d peers_touch_local -tAc \
  "SELECT count(*) FROM touch_actor WHERE preferred_username IN ('alice','bob','carol','dave')" \
  | grep -qx 4
# Fresh schema must not recreate the retired first-generation tables.
docker exec -u postgres "\$pg" psql -U peers -d peers_touch_local -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN
   ('touch_conversation','touch_conv_member','touch_message','touch_attachment',
    'touch_receipt','touch_reaction','touch_key_epoch')" \
  | grep -qx 0
# Friendship seed: 10 directed edges across the four accounts.
docker exec -u postgres "\$pg" psql -U peers -d peers_touch_local -tAc "SELECT count(*) FROM follows" \
  | grep -qx 10
echo "seed: 4 dev accounts, 10 friendship edges, zero legacy tables"
EOF
  log "assertions passed"
}

do_clients() {
  log "client install verification (no GUI started)"
  rexec <<'EOF'
set -euo pipefail
ROOT="$HOME/$ACCEPT_DIR_NAME"
export PATH=/opt/peers-dev/go/bin:/opt/peers-dev/node/bin:$HOME/.cargo/bin:$PATH
cd "$ROOT"
pnpm install
pnpm applets:build
# Desktop: TS contract/type checks, the vite bundle (tauri generate_context!
# needs ../dist), then a full Rust check. No GUI is launched.
pnpm --filter @peers-touch/app-desktop run check
pnpm --filter @peers-touch/app-desktop run build
(cd apps/desktop/src-tauri && cargo check)
# Mobile on Linux stops before the iOS/Android project gates (xcodebuild/JDK
# are platform-specific); web bundle and Rust crates must still resolve.
pnpm --filter @peers-touch/app-mobile run check:web
pnpm --filter @peers-touch/app-mobile run build
(cd apps/mobile/src-tauri && cargo fetch && cargo check --offline)
echo "clients installable on headless linux"
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
# Remove exactly this clone's registration and workspace state, preserving
# any unrelated registrations in the shared machine registry.
python3 - "\$ROOT" <<'PY'
import json, os, pathlib, shutil, sys
root = os.path.realpath(sys.argv[1])
dev = pathlib.Path.home() / '.peers-touch' / 'dev'
registry = dev / 'registry.json'
if registry.exists():
    data = json.loads(registry.read_text())
    kept = [r for r in data.get('registrations', [])
            if os.path.realpath(r.get('canonicalRoot', '')) != root]
    removed = [r for r in data.get('registrations', []) if r not in kept]
    data['registrations'] = kept
    registry.write_text(json.dumps(data, indent=2) + '\n')
    for reg in removed:
        ws = dev / 'workspaces' / reg.get('workspaceId', '')
        if ws.parent == dev / 'workspaces' and ws.exists():
            shutil.rmtree(ws)
            print('removed workspace', ws)
    print(f'removed {len(removed)} registration(s)')
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
# Purge only packages actually installed: apt aborts the whole purge when a
# name is unknown, and build-essential is stock image content we keep.
pkgs=$(dpkg -l | awk '/^ii/ {print $2}' | grep -E \
  '^(docker-ce|docker-ce-cli|containerd.io|docker-buildx-plugin|docker-compose-plugin|docker-ce-rootless-extras|docker.io|protobuf-compiler|libprotobuf[0-9-]*|libwebkit2gtk-4.1-dev|libxdo-dev|libayatana-appindicator3-dev|librsvg2-dev)$' || true)
if [ -n "$pkgs" ]; then sudo apt-get purge -y $pkgs; fi
sudo apt-get autoremove -y 2>/dev/null
sudo rm -f /etc/apt/sources.list.d/docker.list /etc/apt/keyrings/docker.gpg /etc/docker/daemon.json \
  /etc/apt/apt.conf.d/99peers-bootstrap
sudo rm -rf /opt/peers-dev /etc/profile.d/peers-dev.sh /var/lib/docker /etc/docker
sudo gpasswd -d "$USER" docker 2>/dev/null || true
# Go module cache is read-only by design; sudo is required to remove it.
sudo rm -rf "$HOME/go"
rm -rf "$HOME/.cargo" "$HOME/.rustup" "$HOME/.npmrc" "$HOME/.cache/go-build" \
       "$HOME/.config/go" "$HOME/.local/share/pnpm"
# The machine is a dedicated acceptance host: once its registrations are
# gone, remove the whole local-dev state directory.
if [ -f "$HOME/.peers-touch/dev/registry.json" ] \
   && [ "$(python3 -c 'import json,pathlib;print(len(json.loads(pathlib.Path.home().joinpath(".peers-touch/dev/registry.json").read_text()).get("registrations",[])))')" = "0" ]; then
  rm -rf "$HOME/.peers-touch"
fi
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
