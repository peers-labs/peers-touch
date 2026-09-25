#!/usr/bin/env bash
set -euo pipefail

host=""
root=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      host="${2:-}"
      shift 2
      ;;
    --root)
      root="${2:-}"
      shift 2
      ;;
    *)
      echo "unsupported argument: $1" >&2
      exit 2
      ;;
  esac
done

case "$host" in
  trae|cursor|codex) ;;
  *)
    echo "host must be trae, cursor, or codex" >&2
    exit 2
    ;;
esac

if [[ -z "$root" ]]; then
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
else
  root="$(cd "$root" && pwd -P)"
fi

python3 "$root/tooling/scripts/skill-rollout-control.py" \
  install --root "$root" --host "$host"
