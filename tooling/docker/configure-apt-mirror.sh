#!/bin/sh
# An empty override preserves the base image's distribution and official sources.
set -eu

mirror="${1:-}"
apt_root="${2:-/etc/apt}"
[ -n "$mirror" ] || exit 0
case "$mirror" in
  http://*|https://*) ;;
  *) echo "APT_MIRROR_INVALID: expected an HTTP(S) archive origin" >&2; exit 1 ;;
esac
case "$mirror" in
  *[!a-zA-Z0-9:/._-]*) echo "APT_MIRROR_INVALID: unsupported URL characters" >&2; exit 1 ;;
esac
mirror="${mirror%/}"
found=false
for source in "$apt_root/sources.list" "$apt_root"/sources.list.d/*.list "$apt_root"/sources.list.d/*.sources; do
  [ -f "$source" ] || continue
  found=true
  # Retain /ubuntu, /ubuntu-ports, /debian and /debian-security, including deb822.
  temporary="$(mktemp "${source}.XXXXXX")"
  trap 'rm -f "$temporary"' EXIT HUP INT TERM
  sed -E \
    "s#https?://([a-z]{2}\.)?(archive.ubuntu.com|security.ubuntu.com|ports.ubuntu.com|deb.debian.org|security.debian.org)(/|[[:space:]])#${mirror}\3#g" \
    "$source" > "$temporary"
  cat "$temporary" > "$source"
  rm "$temporary"
done
[ "$found" = true ] || { echo "APT_SOURCES_MISSING: no apt source files" >&2; exit 1; }
