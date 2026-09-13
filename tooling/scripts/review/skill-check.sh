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
review_runner="tooling/scripts/review/run.sh"
gap_skill="tooling/skills/pt-acceptance-gap-detector/SKILL.md"
gap_procedures="tooling/skills/pt-acceptance-gap-detector/PROCEDURES.md"
gap_detector="tooling/scripts/acceptance-gap-detect.py"
plan_skill="tooling/skills/pt-plan-and-document/SKILL.md"
english_workflow_skill="tooling/skills/pt-ew/SKILL.md"
execution_guardian_skill="tooling/skills/pt-execution-plan-guardian/SKILL.md"
context_anchor_skill="tooling/skills/pt-context-anchor/SKILL.md"
god_view_skill="tooling/skills/pt-god-view/SKILL.md"
goal_orchestrator_skill="tooling/skills/pt-trae-goal-orchestrator/SKILL.md"
goal_template="tooling/skills/pt-trae-goal-orchestrator/GOAL_TEMPLATE.md"
goal_review_rubric="tooling/skills/pt-trae-goal-orchestrator/REVIEW_RUBRIC.md"

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
require_file "$review_runner"
require_file "$gap_skill"
require_file "$gap_procedures"
require_file "$gap_detector"
require_file "$plan_skill"
require_file "$english_workflow_skill"
require_file "$execution_guardian_skill"
require_file "$context_anchor_skill"
require_file "$god_view_skill"
require_file "$goal_orchestrator_skill"
require_file "$goal_template"
require_file "$goal_review_rubric"

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
  "user-home-absolute-path"
  "silent error"
  "generated"
  "runtime projection"
  "CODEOWNERS"
  "repository-debug-artifact"
  "station-profile-bypass"
  "unauthorized-environment-creation"
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

for marker in "make quality-evidence" "run.sh --range" "--strict-knowledge" "make acceptance-run-ci" "acceptance-gap-detect.py"; do
  if ! grep -q -- "$marker" "$submit_pipeline"; then
    fail "$submit_pipeline missing required command marker: $marker"
  fi
done

if grep -Fq 'Every tracked execution plan must include exactly one `## Context Anchor`' "$plan_skill"; then
  fail "$plan_skill must not require Context Anchor sections in execution plans"
fi
if ! grep -Fq 'Execution plans MUST NOT contain a `## Context Anchor` section.' "$plan_skill"; then
  fail "$plan_skill missing the canonical Context Anchor ownership boundary"
fi

english_workflow_markers=(
  "Chinese input: translate the complete intent"
  "English input: preserve the original sentence"
  "Mixed Chinese and English: produce one complete natural English version"
  "Default response language: English."
  "Chinese input does not deactivate the skill"
)

for marker in "${english_workflow_markers[@]}"; do
  if ! grep -Fq "$marker" "$english_workflow_skill"; then
    fail "$english_workflow_skill missing required language behavior: $marker"
  fi
done

if grep -Fq "User writes only Chinese | Skip English check" "$english_workflow_skill"; then
  fail "$english_workflow_skill must translate Chinese input instead of disabling coaching"
fi
if grep -Fq "User can deactivate by switching to Chinese" "$english_workflow_skill"; then
  fail "$english_workflow_skill must require explicit English-mode deactivation"
fi
if ! grep -Fq "^(tooling/skills/|" "$review_runner"; then
  fail "$review_runner must run skill-check for every canonical project skill change"
fi

for marker in \
  "Mandatory Concurrency Decision" \
  "exclusive write sets are disjoint" \
  "Reserve every write path before spawning." \
  "SUBAGENT_REGISTRY_STALE" \
  "SUBAGENT_RUNTIME_UNAVAILABLE"; do
  if ! grep -Fq "$marker" "$execution_guardian_skill"; then
    fail "$execution_guardian_skill missing parallel execution marker: $marker"
  fi
done

for marker in \
  "Completed since previous anchor" \
  "Ready queue" \
  "Execution mode / lanes" \
  "Conflict controls" \
  "Critical path / ETA"; do
  if ! grep -Fq "$marker" "$context_anchor_skill"; then
    fail "$context_anchor_skill missing progress projection field: $marker"
  fi
done

for marker in \
  "Existing-Agent Reconciliation" \
  "SUBAGENT_REGISTRY_STALE" \
  "SUBAGENT_RUNTIME_UNAVAILABLE" \
  "GOAL_REPLACEMENT_REQUIRED"; do
  if ! grep -Fq "$marker" "$goal_orchestrator_skill"; then
    fail "$goal_orchestrator_skill missing agent reconciliation marker: $marker"
  fi
done

for marker in \
  "Concurrency Decision" \
  "Exclusive write-set owners" \
  "Shared runtime resources" \
  "Integration order and rollback boundary" \
  "Existing-agent reconciliation" \
  "Context Anchor, when tracked: include completed delta, ready queue, execution" \
  "conflict controls" \
  "Critical path"; do
  if ! grep -Fq "$marker" "$goal_template"; then
    fail "$goal_template missing parallel tracking marker: $marker"
  fi
done

for marker in \
  "Concurrency decision" \
  "Agent reconciliation" \
  "stale entries cannot create a blanket spawn ban"; do
  if ! grep -Fq "$marker" "$goal_review_rubric"; then
    fail "$goal_review_rubric missing parallel review marker: $marker"
  fi
done

if ! grep -Fq "merely to print the Anchor" "$god_view_skill"; then
  fail "$god_view_skill must not let resume-time Anchor projection pause execution"
fi

if rg -q \
  'Four stale legacy agent entries.*do not spawn|do not spawn subagents while they remain visible' \
  tooling/skills AGENTS.md; then
  fail "canonical workflow contains a blanket stale-agent spawn prohibition"
fi

if ! grep -Fq "^(tooling/skills/|" "$review_runner"; then
  fail "$review_runner must run skill-check for every canonical project skill change"
fi

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
        cat "$doc"
      elif [[ -d "$doc" ]]; then
        find "$doc" -type f -name '*.md' | sort | while IFS= read -r nested; do
          printf '### %s\n' "$nested"
          cat "$nested"
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

  cargo_directive_fixture="$(mktemp -d)"
  printf 'fn main() { println!("cargo:rerun-if-changed={}", "model.proto"); }\n' \
    > "$cargo_directive_fixture/build.rs"
  if ! tooling/scripts/review/hard-rules.sh \
    --fixture-dir "$cargo_directive_fixture" >/tmp/pt-cargo-directive.$$ 2>&1; then
    cat /tmp/pt-cargo-directive.$$
    fail "hard-rules.sh must not treat Cargo build directives as debug statements"
  fi
  rm -rf "$cargo_directive_fixture"
  rm -f /tmp/pt-cargo-directive.$$

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

quality_root="$(mktemp -d)"
set +e
PT_ACCEPTANCE_ARTIFACT_ROOT="$quality_root" \
  python3 tooling/scripts/quality-evidence.py \
    --range HEAD >/tmp/pt-quality-evidence.$$ 2>&1
quality_status=$?
set -e
if [[ "$quality_status" -ne 0 && "$quality_status" -ne 1 ]]; then
  cat /tmp/pt-quality-evidence.$$
  fail "quality-evidence.py must produce review-ready evidence for HEAD"
else
  if ! quality_json="$(
    PT_ACCEPTANCE_ARTIFACT_ROOT="$quality_root" \
      python3 tooling/scripts/acceptance-artifact.py latest \
        --gate quality-evidence \
        --role quality-json
  )"; then
    fail "quality-evidence.py did not publish quality-json"
  fi
fi
if [[ -n "${quality_json:-}" ]] && ! python3 - "$quality_json" <<'PY'
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
rm -rf "$quality_root"
rm -f /tmp/pt-quality-evidence.$$

tier_run_root="$(mktemp -d)"
set +e
PT_ACCEPTANCE_ARTIFACT_ROOT="$tier_run_root" \
  python3 tooling/scripts/acceptance-run.py \
  --gate acceptance-plan-self \
  --gate chat-desktop-gateway-e2e \
  --tier ci-structure \
  --dry-run >/tmp/pt-acceptance-tier.$$ 2>&1
tier_run_status=$?
set -e
if [[ "$tier_run_status" -ne 1 ]]; then
  cat /tmp/pt-acceptance-tier.$$
  fail "acceptance-run.py dry runs must select gates but remain unproven with exit 1"
else
  if ! tier_run_json="$(
    PT_ACCEPTANCE_ARTIFACT_ROOT="$tier_run_root" \
      python3 tooling/scripts/acceptance-artifact.py latest \
        --gate acceptance-run \
        --role run
  )"; then
    fail "acceptance-run.py did not publish the aggregate run"
  fi
fi
if [[ -n "${tier_run_json:-}" ]] && ! python3 - "$tier_run_json" <<'PY'
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
rm -rf "$tier_run_root"
rm -f /tmp/pt-acceptance-tier.$$

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
