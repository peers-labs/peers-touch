#!/bin/sh
# Publish one unsigned desktop trial build into a profile-scoped directory on
# the Station deployment host and serve it with the smallest possible HTTP
# service. Trial closed loop only — no updater artifacts, no release lifecycle.
#
# Remote layout:
#   $REMOTE_ROOT/<profile>/releases/<release-id>/{<dmg>,install.sh,checksums.txt}
#   $REMOTE_ROOT/<profile>/current -> releases/<release-id>
#
# A dedicated systemd system unit (pt-distribution-<profile>.service) serves the
# profile root read-only on one port. Station containers and data volumes are
# never touched.
#
# Required parameters (environment or --key=value):
#   PROFILE  Profile name, e.g. corpstable
#   HOST     SSH target, e.g. shuxian@10.0.0.1
#   PORT     HTTP port for this profile's file service
#   DMG      Local path to the macOS .dmg produced by `make package`
# Optional:
#   VERSION      Release identity component (default: DMG file name stem)
#   COMMIT       Source commit appended to the release id
#   APP_NAME     Installed .app name (default: Peers.app)
#   REMOTE_ROOT  Profile distribution root (default: ~/.peers-touch/distribution)
set -eu

fail() { echo "publish-trial: $1" >&2; exit 1; }
for dependency in ssh scp sed awk sha256sum mktemp; do
  command -v "$dependency" >/dev/null 2>&1 || fail "missing dependency: $dependency"
done

PROFILE="${PROFILE:-}"
HOST="${HOST:-}"
PORT="${PORT:-}"
DMG="${DMG:-}"
VERSION="${VERSION:-}"
COMMIT="${COMMIT:-}"
APP_NAME="${APP_NAME:-Peers.app}"
REMOTE_ROOT="${REMOTE_ROOT:-.peers-touch/distribution}"

for argument in "$@"; do
  key=${argument%%=*}
  value=${argument#*=}
  case "$key" in
    --profile) PROFILE="$value" ;;
    --host) HOST="$value" ;;
    --port) PORT="$value" ;;
    --dmg) DMG="$value" ;;
    --version) VERSION="$value" ;;
    --commit) COMMIT="$value" ;;
    --app-name) APP_NAME="$value" ;;
    --remote-root) REMOTE_ROOT="$value" ;;
    *) fail "unknown argument: $key" ;;
  esac
done

[ -n "$PROFILE" ] && [ -n "$HOST" ] && [ -n "$PORT" ] && [ -n "$DMG" ] \
  || fail "PROFILE, HOST, PORT and DMG are required"
case "$PORT" in ''|*[!0-9]*) fail "PORT must be a number" ;; esac
[ -f "$DMG" ] || fail "DMG not found: $DMG"
case "$PROFILE" in *[!a-z0-9-]*|'') fail "PROFILE must match [a-z0-9-]+" ;; esac

# sha256sum is Linux/GNU; macOS coreutils provides shasum.
checksum() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

DMG_NAME=$(basename "$DMG")
DMG_SHA=$(checksum "$DMG")
[ -z "$VERSION" ] && VERSION=$(printf '%s' "$DMG_NAME" | sed -E 's/\.dmg$//I')
RELEASE_ID="$VERSION"
[ -n "$COMMIT" ] && RELEASE_ID="$RELEASE_ID-$(printf '%s' "$COMMIT" | cut -c1-7)"
case "$RELEASE_ID" in *[!A-Za-z0-9._-]*) fail "release id must be [A-Za-z0-9._-]+: $RELEASE_ID" ;; esac

remote_info=$(ssh "$HOST" 'printf "%s|%s|%s|%s\n" "$(id -un)" "$(id -gn)" "$HOME" "$(command -v python3)"')
REMOTE_USER=$(printf '%s' "$remote_info" | awk -F'|' '{print $1}')
REMOTE_GROUP=$(printf '%s' "$remote_info" | awk -F'|' '{print $2}')
REMOTE_HOME=$(printf '%s' "$remote_info" | awk -F'|' '{print $3}')
REMOTE_PYTHON=$(printf '%s' "$remote_info" | awk -F'|' '{print $4}')
case "$REMOTE_HOME:$REMOTE_PYTHON" in *:|*:) fail "could not resolve remote home or python3" ;; esac
case "$REMOTE_ROOT" in
  /*) ROOT_ABS="$REMOTE_ROOT/$PROFILE" ;;
  ~*) ROOT_ABS="$REMOTE_HOME/${REMOTE_ROOT#~}/$PROFILE" ;;
  *) ROOT_ABS="$REMOTE_HOME/$REMOTE_ROOT/$PROFILE" ;;
esac
BASE_URL="http://$(printf '%s' "$HOST" | sed -E 's/^[^@]+@//'):$PORT/current"

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
template=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/desktop-install.template.sh
[ -f "$template" ] || fail "missing desktop-install.template.sh next to this script"
sed \
  -e "s|__TRIAL_BASE_URL__|$BASE_URL|g" \
  -e "s|__TRIAL_DMG_NAME__|$DMG_NAME|g" \
  -e "s|__TRIAL_SHA256__|$DMG_SHA|g" \
  -e "s|__TRIAL_APP_NAME__|$APP_NAME|g" \
  "$template" > "$stage/install.sh"
chmod 0755 "$stage/install.sh"
if grep -q '__TRIAL_' "$stage/install.sh"; then
  fail "install template still contains unrendered placeholders"
fi
printf '%s  %s\n' "$DMG_SHA" "$DMG_NAME" > "$stage/checksums.txt"
printf '%s  install.sh\n' "$(checksum "$stage/install.sh")" >> "$stage/checksums.txt"

echo "publish-trial: uploading $DMG_NAME ($RELEASE_ID) to $HOST:$ROOT_ABS"
ssh "$HOST" "mkdir -p '$ROOT_ABS/releases/$RELEASE_ID'"
scp -q "$DMG" "$HOST:$ROOT_ABS/releases/$RELEASE_ID/$DMG_NAME"
scp -q "$stage/install.sh" "$HOST:$ROOT_ABS/releases/$RELEASE_ID/install.sh"
scp -q "$stage/checksums.txt" "$HOST:$ROOT_ABS/releases/$RELEASE_ID/checksums.txt"

ssh "$HOST" "
set -eu
chmod 0755 '$ROOT_ABS/releases/$RELEASE_ID/install.sh'
ln -sfn 'releases/$RELEASE_ID' '$ROOT_ABS/current.tmp'
mv -Tf '$ROOT_ABS/current.tmp' '$ROOT_ABS/current'
command -v sudo >/dev/null 2>&1 && SUDO='sudo -n' || SUDO=''
\$SUDO tee /etc/systemd/system/pt-distribution-$PROFILE.service >/dev/null <<UNIT
[Unit]
Description=Peers Touch trial file distribution ($PROFILE)
After=network.target

[Service]
Type=simple
User=$REMOTE_USER
Group=$REMOTE_GROUP
WorkingDirectory=$ROOT_ABS
ExecStart=$REMOTE_PYTHON -m http.server $PORT --directory $ROOT_ABS
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
\$SUDO systemctl daemon-reload
\$SUDO systemctl enable --now pt-distribution-$PROFILE.service >/dev/null 2>&1
\$SUDO systemctl restart pt-distribution-$PROFILE.service
"

echo "publish-trial: verifying public read of $BASE_URL/install.sh"
curl -fsS --retry 4 --retry-connrefused --retry-delay 1 -o /dev/null "$BASE_URL/install.sh" \
  || fail "install.sh not reachable at $BASE_URL"
echo "publish-trial: OK"
echo "  install: curl -fL $BASE_URL/install.sh -o peers-install.sh && sh peers-install.sh"
