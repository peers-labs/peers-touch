#!/bin/sh
# Trial desktop installer for macOS Apple Silicon.
#
# This template is rendered by publish-trial.sh at publish time. It is NOT the
# Station self-host installer (install.sh at the distribution root). It fetches
# one unsigned DMG from a profile-scoped trial origin, verifies its SHA-256,
# installs the .app into /Applications, and clears the download quarantine.
#
# Rendered placeholders:
#   __TRIAL_BASE_URL__   Directory URL containing the DMG (no trailing slash)
#   __TRIAL_DMG_NAME__   Canonical DMG file name
#   __TRIAL_SHA256__     Expected hex SHA-256 of the DMG bytes
#   __TRIAL_APP_NAME__   Installed .app directory name
set -eu

BASE_URL="__TRIAL_BASE_URL__"
DMG_NAME="__TRIAL_DMG_NAME__"
EXPECTED_SHA256="__TRIAL_SHA256__"
APP_NAME="__TRIAL_APP_NAME__"

fail() { echo "peers-install: $1" >&2; exit 1; }
for dependency in curl shasum hdiutil ditto; do
  command -v "$dependency" >/dev/null 2>&1 || fail "missing dependency: $dependency"
done
case "$BASE_URL" in https://*|http://*) ;; *) fail "invalid trial origin" ;; esac

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT HUP INT TERM
dmg_path="$stage/$DMG_NAME"

echo "Downloading $DMG_NAME ..."
curl -fL --retry 2 -o "$dmg_path" "$BASE_URL/$DMG_NAME" \
  || fail "download failed"

actual_sha256="$(shasum -a 256 "$dmg_path" | awk '{print $1}')"
if [ "$actual_sha256" != "$EXPECTED_SHA256" ]; then
  fail "checksum mismatch (got $actual_sha256)"
fi

mount_point="$(mktemp -d)"
attach_output="$(hdiutil attach -nobrowse -readonly -mountpoint "$mount_point" "$dmg_path")" \
  || fail "mounting DMG failed"
# Always attempt detach; the trap above only removes local staging directories.
detach() { hdiutil detach -quiet "$mount_point" >/dev/null 2>&1 || true; }
trap 'detach; rm -rf "$stage"' EXIT HUP INT TERM

app_path="$mount_point/$APP_NAME"
[ -d "$app_path" ] || fail "DMG does not contain $APP_NAME"

if [ -d "/Applications/$APP_NAME" ]; then
  rm -rf "/Applications/$APP_NAME"
fi
ditto "$app_path" "/Applications/$APP_NAME" || fail "copy to /Applications failed"
detach

# Unsigned trial builds carry a quarantine xattr from download. The checksum
# comparison above is the integrity gate; clearing the attribute lets Gatekeeper
# open the build without a notarization ticket.
xattr -dr com.apple.quarantine "/Applications/$APP_NAME" 2>/dev/null || true

echo "Installed /Applications/$APP_NAME"
echo "Open it from Applications or run: open -a '$APP_NAME'"
