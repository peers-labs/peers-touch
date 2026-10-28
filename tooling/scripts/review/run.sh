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
route_output="$(tooling/scripts/review/route-change.sh --range "$diff_range")"
printf '%s\n' "$route_output"

echo
echo "== Hard rules =="
tooling/scripts/review/hard-rules.sh --range "$diff_range"

echo
echo "== Code structure signals =="
node tooling/skills/pt-code-structure-review/scripts/structure-signals.mjs \
  --range "$diff_range"

# Advisory only: knip output is contextual input for the semantic structure
# decision. It never gates the pipeline and SKIPs without the toolchain.
echo
echo "== Dead code advisory (non-blocking) =="
node tooling/scripts/review/dead-code-advisory.mjs || true

if rg -q '^\[code-structure\]$' <<< "$route_output"; then
  echo
  echo "== Code structure decision =="
  if python3 tooling/scripts/review/code_structure_decision.py verify \
    --range "$diff_range"; then
    :
  else
    decision_status=$?
    if [[ "$decision_status" -eq 2 ]] &&
      [[ "${CI:-}" =~ ^(1|true|TRUE|yes|YES)$ ]]; then
      echo "code-structure decision: pending semantic reviewer"
    else
      exit "$decision_status"
    fi
  fi
fi

echo
echo "== Frontend runtime registry =="
node tooling/scripts/check-frontend-runtime-registry.mjs --range "$diff_range"

echo
echo "== Client boundary contracts =="
# Ownership must hold for every review, not only when an agent remembers the
# per-app pnpm check: social wire placement and runtime boundaries are
# source-only scans, plus their deterministic contract test.
node tooling/devctl/index.mjs check desktop-social-wire --root .
node tooling/devctl/index.mjs check mobile-social-wire --root .
node tooling/devctl/index.mjs check social-runtime-boundaries --root .
python3 tooling/scripts/check_social_runtime_boundaries_test.py

echo
echo "== Knowledge match =="
if [[ "$strict_knowledge" -eq 1 ]]; then
  tooling/scripts/review/knowledge-match.sh --range "$diff_range" --strict
else
  tooling/scripts/review/knowledge-match.sh --range "$diff_range"
fi

echo
echo "== Doc review cadence =="
if [[ "$strict_knowledge" -eq 1 ]]; then
  tooling/scripts/review/doc-review-cadence.sh
else
  tooling/scripts/review/doc-review-cadence.sh --warn-only
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
echo "review automation: pass"
