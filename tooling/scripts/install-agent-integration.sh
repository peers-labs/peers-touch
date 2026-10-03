#!/usr/bin/env bash
set -euo pipefail

host=""
root=""
workspace=""
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
    --workspace)
      workspace="${2:-}"
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

args=(install --root "$root" --host "$host")
if [[ -n "$workspace" ]]; then
  args+=(--workspace "$workspace")
fi
python3 "$root/tooling/scripts/agent-integration-control.py" "${args[@]}"

audit_args=(--root "$root" --host "$host")
if [[ -n "$workspace" ]]; then
  audit_args+=(--workspace "$workspace")
fi
python3 "$root/tooling/scripts/agent-integration-audit.py" "${audit_args[@]}"
