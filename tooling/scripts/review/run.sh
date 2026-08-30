#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: run.sh [--range <git-range>] [--strict-knowledge]

Runs the Peers-Touch review framework checks that are safe for local and CI use.
USAGE
}

diff_range="HEAD"
strict_knowledge=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --range)
      diff_range="${2:?missing --range value}"
      shift 2
      ;;
    --strict-knowledge)
      strict_knowledge=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "review run: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

echo "== Review route =="
tooling/scripts/review/route-change.sh --range "$diff_range"

echo
echo "== Hard rules =="
tooling/scripts/review/hard-rules.sh --range "$diff_range"

echo
echo "== Frontend runtime registry =="
bash tooling/scripts/check-frontend-runtime-registry.sh --range "$diff_range"

echo
echo "== Knowledge match =="
if [[ "$strict_knowledge" -eq 1 ]]; then
  tooling/scripts/review/knowledge-match.sh --range "$diff_range" --strict
else
  tooling/scripts/review/knowledge-match.sh --range "$diff_range"
fi

if ! changed_for_skill="$(git diff --name-only "$diff_range" --)"; then
  echo "review run: invalid or unreadable git range: $diff_range" >&2
  exit 1
fi
if [[ "$diff_range" == "HEAD" ]]; then
  changed="$(printf '%s\n%s\n' "$changed_for_skill" "$(git ls-files --others --exclude-standard)" | sed '/^$/d' | sort -u)"
else
  changed="$(printf '%s\n' "$changed_for_skill" | sed '/^$/d' | sort -u)"
fi
if rg -q '^(tooling/skills/|tooling/review-fixtures/|tooling/scripts/review/|docs/global/code-review-framework.md|AGENTS.md|docs/architecture/|docs/client/|docs/station/|docs/global/coding-guide/|docs/knowledge/)' <<< "$changed"; then
  echo
  echo "== Review skill freshness =="
  tooling/scripts/review/skill-check.sh
fi

echo
echo "review run: pass"
