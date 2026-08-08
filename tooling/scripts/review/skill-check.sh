#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

skill_file="tooling/skills/pt-github-review/SKILL.md"
pr_skill_file="tooling/skills/pt-github-pr/SKILL.md"
freshness_file="tooling/skills/pt-github-review/FRESHNESS.md"
fixtures_dir="tooling/review-fixtures"
pr_template=".github/PULL_REQUEST_TEMPLATE.md"
submit_pipeline="tooling/scripts/review/submit-pipeline.sh"

failures=0

fail() {
  failures=$((failures + 1))
  printf '[skill-check] %s\n' "$1"
}

require_file() {
  [[ -f "$1" ]] || fail "missing required file: $1"
}

require_file "$skill_file"
require_file "$pr_skill_file"
require_file "$freshness_file"
require_file "$pr_template"
require_file "$submit_pipeline"

required_sections=(
  "Review Philosophy"
  "Review Workflow"
  "Review Learning Check"
  "Review Profiles"
  "Script vs Skill Boundary"
  "Platform Review Playbooks"
  "Hard Rules"
  "Operational Knowledge"
  "Skill Freshness"
  "Self-Growth"
  "Severity Levels"
  "Review Output Format"
  "Framework Growth Opportunities"
  "Anti-Patterns"
)

for section in "${required_sections[@]}"; do
  if ! grep -q "$section" "$skill_file"; then
    fail "$skill_file missing required section or marker: $section"
  fi
done

required_rules=(
  "console.log"
  "fmt.Println"
  "println!"
  "debugPrint"
  "Proto-first"
  "No mock"
  "hardcoded secrets"
  "hardcoded-ui-string"
  "silent error"
  "generated"
  "runtime projection"
  "CODEOWNERS"
  "Proto Review"
  "Station Review"
  "Desktop Review"
  "Mobile Review"
  "Knowledge Review"
  "Review-System Review"
)

growth_decisions=(
  "knowledge_invariant"
  "knowledge_pitfall"
  "knowledge_playbook"
  "hard_rule"
  "review_fixture"
  "acceptance_contract"
  "acceptance_gate"
  "skill_update"
  "ci_tooling_update"
  "no_growth_needed"
)

for rule in "${required_rules[@]}"; do
  if ! grep -qi "$rule" "$skill_file"; then
    fail "$skill_file missing required rule reference: $rule"
  fi
done

for decision in "${growth_decisions[@]}"; do
  if ! grep -q "$decision" "$skill_file"; then
    fail "$skill_file missing growth decision: $decision"
  fi
done

submit_markers=(
  "Submit-Time Review Pipeline"
  "make review-submit"
  "Quality Evidence"
  "Framework Growth Opportunities"
)

for marker in "${submit_markers[@]}"; do
  if ! grep -q "$marker" "$pr_skill_file"; then
    fail "$pr_skill_file missing submit pipeline marker: $marker"
  fi
  if ! grep -q "$marker" "$pr_template"; then
    fail "$pr_template missing submit pipeline marker: $marker"
  fi
done

for marker in "make quality-evidence" "run.sh --range" "--strict-knowledge" "make acceptance-run-ci"; do
  if ! grep -q -- "$marker" "$submit_pipeline"; then
    fail "$submit_pipeline missing required command marker: $marker"
  fi
done

covered_docs=()
while IFS= read -r doc; do
  covered_docs+=("$doc")
done < <(awk '
  /^covered_docs:/ { in_list=1; next }
  in_list && /^[a-zA-Z_]+:/ { in_list=0 }
  in_list && /^[[:space:]]*-[[:space:]]*/ {
    line=$0
    sub(/^[[:space:]]*-[[:space:]]*/, "", line)
    print line
  }
' "$freshness_file")

if [[ ${#covered_docs[@]} -eq 0 ]]; then
  fail "$freshness_file has no covered_docs list"
fi

for doc in "${covered_docs[@]}"; do
  [[ -e "$doc" ]] || fail "$freshness_file references missing upstream doc: $doc"
done

expected_hash="$(awk -F': *' '/^covered_docs_hash:/ {print $2; exit}' "$freshness_file")"
if [[ -z "$expected_hash" ]]; then
  fail "$freshness_file missing covered_docs_hash"
else
  actual_hash="$(
    for doc in "${covered_docs[@]}"; do
      if [[ -f "$doc" ]]; then
        printf '### %s\n' "$doc"
        sed -n '1,260p' "$doc"
      elif [[ -d "$doc" ]]; then
        find "$doc" -type f -name '*.md' | sort | while IFS= read -r nested; do
          printf '### %s\n' "$nested"
          sed -n '1,220p' "$nested"
        done
      fi
    done | shasum -a 256 | awk '{print $1}'
  )"
  if [[ "$actual_hash" != "$expected_hash" ]]; then
    fail "upstream review rules drifted: expected $expected_hash but got $actual_hash"
  fi
fi

if [[ ! -d "$fixtures_dir" ]]; then
  fail "missing fixtures directory: $fixtures_dir"
else
  fixture_count="$(find "$fixtures_dir" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
  if [[ "$fixture_count" -lt 6 ]]; then
    fail "expected at least 6 review fixtures, found $fixture_count"
  fi

  while IFS= read -r expected; do
    fixture="$(dirname "$expected")"
    if ! grep -Eq '^expected_code:' "$expected"; then
      fail "$expected missing expected_code"
    fi
    if ! grep -Eq '^expected_severity:' "$expected"; then
      fail "$expected missing expected_severity"
    fi
    expected_code="$(awk -F': *' '/^expected_code:/ {print $2; exit}' "$expected")"
    if ! grep -qi "$expected_code" "$skill_file"; then
      fail "$fixture expected code '$expected_code' is not represented in $skill_file"
    fi
    fixture_output="$(tooling/scripts/review/hard-rules.sh --fixture-dir "$fixture" 2>&1 || true)"
    if ! grep -q "$expected_code" <<< "$fixture_output"; then
      fail "$fixture did not trigger expected hard-rule code '$expected_code'"
    fi
  done < <(find "$fixtures_dir" -name expected.yml | sort)

  debug_literal_fixture="$(mktemp -d)"
  printf "export const forbiddenMethod = 'console.logs.subscribe';\n" \
    > "$debug_literal_fixture/contract.ts"
  if ! tooling/scripts/review/hard-rules.sh \
    --fixture-dir "$debug_literal_fixture" >/tmp/pt-debug-literal.$$ 2>&1; then
    cat /tmp/pt-debug-literal.$$
    fail "hard-rules.sh must not treat console.log string data as an executable debug call"
  fi
  rm -rf "$debug_literal_fixture"
  rm -f /tmp/pt-debug-literal.$$

  growth_fixture_count="$(find "$fixtures_dir" -mindepth 1 -maxdepth 1 -type d -name 'growth-*' | wc -l | tr -d ' ')"
  if [[ "$growth_fixture_count" -lt 4 ]]; then
    fail "expected at least 4 growth fixtures, found $growth_fixture_count"
  fi

  while IFS= read -r growth; do
    fixture="$(dirname "$growth")"
    for field in scenario expected_growth_decision expected_asset proof; do
      if ! grep -Eq "^${field}:" "$growth"; then
        fail "$growth missing $field"
      fi
    done
    decision="$(awk -F': *' '/^expected_growth_decision:/ {print $2; exit}' "$growth")"
    found_decision=0
    for allowed in "${growth_decisions[@]}"; do
      if [[ "$decision" == "$allowed" ]]; then
        found_decision=1
        break
      fi
    done
    if [[ "$found_decision" -ne 1 ]]; then
      fail "$fixture has unknown growth decision: $decision"
    fi
    if ! grep -q "$decision" "$skill_file"; then
      fail "$fixture expected growth decision '$decision' is not represented in $skill_file"
    fi
  done < <(find "$fixtures_dir" -path '*/growth.yml' | sort)
fi

invalid_range="__pt_missing_review_range__"
if tooling/scripts/review/route-change.sh --range "$invalid_range" >/tmp/pt-route-invalid.$$ 2>&1; then
  fail "route-change.sh must fail closed on invalid git ranges"
fi
rm -f /tmp/pt-route-invalid.$$

if tooling/scripts/review/hard-rules.sh --range "$invalid_range" >/tmp/pt-hard-rules-invalid.$$ 2>&1; then
  fail "hard-rules.sh must fail closed on invalid git ranges"
fi
rm -f /tmp/pt-hard-rules-invalid.$$

if tooling/scripts/review/knowledge-match.sh --range "$invalid_range" >/tmp/pt-knowledge-invalid.$$ 2>&1; then
  fail "knowledge-match.sh must fail closed on invalid git ranges"
fi
rm -f /tmp/pt-knowledge-invalid.$$

knowledge_dir_output="$(
  tooling/scripts/review/knowledge-match.sh \
    --changed-file apps/station/frame/touch/federation/republisher/fixture.go \
    --strict 2>&1
)"
if ! grep -q "republisher-broadcast-spam" <<< "$knowledge_dir_output"; then
  fail "knowledge-match.sh must match owns directories with trailing slashes"
fi

quality_json="$(mktemp)"
quality_markdown="$(mktemp)"
if ! python3 tooling/scripts/quality-evidence.py --range HEAD --output "$quality_json" --markdown-output "$quality_markdown" >/tmp/pt-quality-evidence.$$ 2>&1; then
  cat /tmp/pt-quality-evidence.$$
  fail "quality-evidence.py must produce review-ready evidence for HEAD"
elif ! python3 - "$quality_json" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
required = {"range", "changed_paths", "route", "knowledge", "acceptance", "evidence_gaps", "ready_for_github_review"}
missing = sorted(required - set(data))
if missing:
    raise SystemExit(f"missing quality evidence keys: {missing}")
PY
then
  fail "quality-evidence.py JSON output is missing required keys"
fi
rm -f "$quality_json" "$quality_markdown" /tmp/pt-quality-evidence.$$

tier_run_json="$(mktemp)"
if ! python3 tooling/scripts/acceptance-run.py \
  --gate acceptance-plan-self \
  --gate chat-runtime-e2e \
  --tier ci-structure \
  --dry-run \
  --output "$tier_run_json" >/tmp/pt-acceptance-tier.$$ 2>&1; then
  cat /tmp/pt-acceptance-tier.$$
  fail "acceptance-run.py must support tier-filtered dry runs"
elif ! python3 - "$tier_run_json" <<'PY'
import json
import sys
from pathlib import Path

results = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")).get("results", [])
ids = [result.get("id") for result in results]
if ids != ["acceptance-plan-self"]:
    raise SystemExit(f"unexpected tier-filtered gates: {ids}")
PY
then
  fail "acceptance-run.py tier filtering selected the wrong gates"
fi
rm -f "$tier_run_json" /tmp/pt-acceptance-tier.$$

if rg -n 'ignore (previous|all) instructions|you are now|system:\s*override|curl .*\| *sh|rm -rf /' "$skill_file" "$freshness_file" >/tmp/pt-skill-danger.$$ 2>/dev/null; then
  cat /tmp/pt-skill-danger.$$
  rm -f /tmp/pt-skill-danger.$$
  fail "skill files contain dangerous instruction patterns"
fi
rm -f /tmp/pt-skill-danger.$$

if [[ "$failures" -gt 0 ]]; then
  echo "skill-check: $failures issue(s)" >&2
  exit 1
fi

echo "skill-check: pass"
