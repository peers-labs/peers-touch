#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: submit-pipeline.sh [--base <base-ref>] [--range <git-range>] [--skip-ci-gates]

Runs the submit-time review pipeline before creating or updating a PR/MR.
Default base: origin/master when available, otherwise master.
USAGE
}

base_ref=""
diff_range=""
skip_ci_gates=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      base_ref="${2:?missing --base value}"
      shift 2
      ;;
    --range)
      diff_range="${2:?missing --range value}"
      shift 2
      ;;
    --skip-ci-gates)
      skip_ci_gates=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "submit-pipeline: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ -z "$diff_range" ]]; then
  if [[ -z "$base_ref" ]]; then
    if git rev-parse --verify --quiet origin/master >/dev/null; then
      base_ref="origin/master"
    else
      base_ref="master"
    fi
  fi
  diff_range="${base_ref}...HEAD"
fi

if ! git diff --name-only "$diff_range" -- >/dev/null; then
  echo "submit-pipeline: invalid or unreadable git range: $diff_range" >&2
  exit 1
fi

echo "Submit-Time Review Pipeline"
echo "==========================="
echo "range: $diff_range"

echo
echo "== Quality evidence =="
make quality-evidence REVIEW_RANGE="$diff_range"

echo
echo "== Review framework =="
tooling/scripts/review/run.sh --range "$diff_range" --strict-knowledge

echo
echo "== Acceptance structure =="
make acceptance-validate
make acceptance-coverage-report
make acceptance-plan ACCEPTANCE_RANGE="$diff_range"

if [[ "$skip_ci_gates" -eq 1 ]]; then
  echo
  echo "== Acceptance CI gates =="
  echo "[SKIP] --skip-ci-gates was provided"
else
  echo
  echo "== Acceptance CI gates =="
  make acceptance-run-ci
  make acceptance-report
fi

echo
echo "== Acceptance gap detector =="
python3 tooling/scripts/acceptance-gap-detect.py \
  --claim "Change range $diff_range is ready for PR review" \
  --range "$diff_range"

echo
echo "submit-pipeline: pass"
echo "quality evidence: tooling/acceptance/reports/latest-quality-evidence.md"
echo "acceptance report: tooling/acceptance/reports/latest-report.md"
