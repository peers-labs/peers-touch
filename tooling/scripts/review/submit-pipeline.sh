#!/usr/bin/env bash
set -euo pipefail

if ! command -v make >/dev/null 2>&1; then
  if command -v gmake >/dev/null 2>&1; then
    make() {
      gmake "$@"
    }
  else
    echo "submit-pipeline: GNU Make is required" >&2
    exit 127
  fi
fi

usage() {
  cat <<'USAGE'
Usage: submit-pipeline.sh --session <session.json> [--base <base-ref>] [--range <git-range>] [--skip-ci-gates]

Runs the submit-time review pipeline before creating or updating a PR/MR.
Default base: origin/master when available, otherwise master.
USAGE
}

base_ref=""
diff_range=""
skip_ci_gates=0
session_path=""

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
    --session)
      session_path="${2:?missing --session value}"
      shift 2
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

if [[ -z "$session_path" ]]; then
  echo "submit-pipeline: ACCEPTANCE_SESSION_REQUIRED" >&2
  exit 2
fi

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

scope_plan="$(mktemp)"
trap 'rm -f "$scope_plan"' EXIT
python3 tooling/scripts/acceptance-plan.py \
  --root tooling/acceptance \
  --active-plan \
  --completion \
  --output "$scope_plan" >/dev/null
infra_only="$(
  python3 - "$scope_plan" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    plan = json.load(handle)
features = set(plan.get("impacted_features", []))
print("1" if features == {"acceptance-framework"} else "0")
PY
)"

echo "Submit-Time Review Pipeline"
echo "==========================="
echo "range: $diff_range"
echo "acceptance_scope: $([[ "$infra_only" == "1" ]] && echo infra || echo business-or-mixed)"

echo
echo "== Execution plan completion =="
python3 tooling/scripts/execution-plan.py --require-complete

echo
echo "== Quality evidence =="
make quality-evidence REVIEW_RANGE="$diff_range"

echo
echo "== Review framework =="
tooling/scripts/review/run.sh --range "$diff_range" --strict-knowledge

echo
echo "== Acceptance structure =="
if [[ "$infra_only" == "1" ]]; then
  make acceptance-infra-validate
else
  make acceptance-validate
fi
make acceptance-coverage-report
python3 tooling/scripts/acceptance-plan.py \
  --active-plan \
  --completion

if [[ "$skip_ci_gates" -eq 1 ]]; then
  echo
  echo "== Acceptance CI gates =="
  echo "[SKIP] --skip-ci-gates was provided"
else
  echo
  echo "== Acceptance CI gates =="
  make acceptance-run-ci PLAN="$scope_plan" SESSION="$session_path"
  make acceptance-report
fi

echo
echo "== Acceptance gap detector =="
python3 tooling/scripts/acceptance-gap-detect.py \
  --claim "Change range $diff_range is ready for PR review" \
  --range "$diff_range" \
  --plan "$scope_plan" \
  --session "$session_path"

echo
echo "submit-pipeline: pass"
echo "quality evidence: gate=quality-evidence role=quality-markdown"
echo "quality evidence inspect: python3 tooling/scripts/acceptance-artifact.py cat --gate quality-evidence --role quality-markdown"
if [[ "$skip_ci_gates" -eq 1 ]]; then
  echo "acceptance report: NOT RUN/UNPROVEN (--skip-ci-gates; no artifact from this invocation)"
else
  echo "acceptance report: gate=acceptance-report role=report"
  echo "acceptance report inspect: python3 tooling/scripts/acceptance-artifact.py cat --gate acceptance-report --role report"
fi
