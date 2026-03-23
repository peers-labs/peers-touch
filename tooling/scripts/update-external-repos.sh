#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXTERNAL_DIR="${1:-$PROJECT_ROOT/external}"

if ! command -v git >/dev/null 2>&1; then
  echo "git not found"
  exit 1
fi

if [ ! -d "$EXTERNAL_DIR" ]; then
  echo "external directory not found: $EXTERNAL_DIR"
  exit 0
fi

updated=0
skipped=0

for dir in "$EXTERNAL_DIR"/*; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"

  if git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "updating: $name"
    git -C "$dir" remote update --prune

    if branch="$(git -C "$dir" symbolic-ref --short -q HEAD)"; then
      git -C "$dir" pull --ff-only origin "$branch"
    else
      echo "detached HEAD, fetched only: $name"
    fi
    updated=$((updated + 1))
  else
    echo "skip (not a git repo): $name"
    skipped=$((skipped + 1))
  fi
done

echo "done. updated=$updated skipped=$skipped"
