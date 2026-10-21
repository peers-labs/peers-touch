#!/bin/sh
# Fetch one complete immutable release, verify it, then enter the instance owner.
set -eu
umask 077

fail() { echo "$1" >&2; exit 1; }
for dependency in curl python3 docker; do
  command -v "$dependency" >/dev/null 2>&1 || fail "RD_DEPENDENCY_MISSING: $dependency"
done
docker compose version --short | sed 's/^v//' | python3 -c \
  'import sys; sys.exit(0 if sys.stdin.read().strip().startswith("2.") else 1)' \
  || fail "RD_COMPOSE_V2_REQUIRED"
docker info >/dev/null 2>&1 || fail "RD_DOCKER_UNAVAILABLE"

version=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "--version" ]; then version="$argument"; fi
  previous="$argument"
done
origin="${PEERS_RELEASE_ORIGIN:-https://github.com/peers-labs/peers-touch/releases/download}"
case "$origin" in https://*) ;; *) fail "RD_HTTPS_REQUIRED" ;; esac
if [ -z "$version" ]; then
  [ -z "${PEERS_RELEASE_ORIGIN:-}" ] || fail "RD_CANDIDATE_VERSION_REQUIRED"
  version="$(curl -fsSL --proto '=https' --tlsv1.2 https://api.github.com/repos/peers-labs/peers-touch/releases/latest \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); assert not d["draft"] and not d["prerelease"]; sys.stdout.write(d["tag_name"] + "\n")')"
fi
python3 -c 'import re,sys; assert re.fullmatch(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?",sys.argv[1])' \
  "$version" || fail "RD_VERSION_INVALID"

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT HUP INT TERM
for asset in checksums.txt installer.py installation_state.py docker-compose.yml station-release.json install.sh; do
  curl -fsSL --proto '=https' --tlsv1.2 "${origin%/}/$version/$asset" -o "$stage/$asset" \
    || fail "RD_ASSET_DOWNLOAD_FAILED: $asset"
done
python3 - "$stage" <<'PY'
import hashlib, pathlib, re, sys
root = pathlib.Path(sys.argv[1])
entries = {}
for line in (root / "checksums.txt").read_text().splitlines():
    match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9_.-]+)", line)
    if not match or match[2] in entries:
        raise SystemExit("RD_CHECKSUM_MANIFEST_INVALID")
    entries[match[2]] = match[1]
for name in ["installer.py", "installation_state.py", "docker-compose.yml", "station-release.json", "install.sh"]:
    if entries.get(name) != hashlib.sha256((root / name).read_bytes()).hexdigest():
        raise SystemExit("RD_CHECKSUM_MISMATCH: " + name)
PY
python3 "$stage/installer.py" --assets "$stage" --selected-version "$version" "$@"
