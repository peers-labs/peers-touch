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
architecture_execution_skill="tooling/skills/pt-architecture-execution-methodology/SKILL.md"
dev_workflow_skill="tooling/skills/pt-dev-workflow/SKILL.md"
english_workflow_skill="tooling/skills/pt-ew/SKILL.md"
execution_guardian_skill="tooling/skills/pt-execution-plan-guardian/SKILL.md"
dev_workflow_skill="tooling/skills/pt-dev-workflow/SKILL.md"
dev_work_script="tooling/scripts/local-dev/dev-work.mjs"
context_anchor_skill="tooling/skills/pt-context-anchor/SKILL.md"
god_view_skill="tooling/skills/pt-god-view/SKILL.md"
goal_orchestrator_skill="tooling/skills/pt-trae-goal-orchestrator/SKILL.md"
goal_template="tooling/skills/pt-trae-goal-orchestrator/GOAL_TEMPLATE.md"
goal_review_rubric="tooling/skills/pt-trae-goal-orchestrator/REVIEW_RUBRIC.md"
workflow_architecture="docs/architecture/development-workflow/design.md"
agents_contract="AGENTS.md"

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
require_file "$architecture_execution_skill"
require_file "$dev_workflow_skill"
require_file "$english_workflow_skill"
require_file "$execution_guardian_skill"
require_file "$dev_workflow_skill"
require_file "$dev_work_script"
require_file "$context_anchor_skill"
require_file "$god_view_skill"
require_file "$goal_orchestrator_skill"
require_file "$goal_template"
require_file "$goal_review_rubric"
require_file "$workflow_architecture"
require_file "$agents_contract"

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
  if ! grep -Fq "$marker" "$goal_orchestrator_skill"; then
    fail "$goal_orchestrator_skill missing scheduler marker: $marker"
  fi
done

for marker in \
  "read-only policy guard" \
  "May this specific proposed action run now?" \
  "ACTION_ALLOWED" \
  "The Guardian does not perform the amendment"; do
  if ! grep -Fq "$marker" "$execution_guardian_skill"; then
    fail "$execution_guardian_skill missing policy-boundary marker: $marker"
  fi
done

if grep -Fq "Self-amend and continue" "$execution_guardian_skill" ||
  grep -Fq "Mandatory Concurrency Decision" "$execution_guardian_skill"; then
  fail "$execution_guardian_skill must not own plan mutation or scheduling"
fi

for marker in \
  "single entry point" \
  "make dev-start" \
  "make dev-check" \
  "make dev-release" \
  "FUNCTIONAL_PASS" \
  "first actionable failure" \
  "Acceptance Promotion" \
  "PROVEN"; do
  if ! grep -Fq "$marker" "$dev_workflow_skill"; then
    fail "$dev_workflow_skill missing Development Workflow marker: $marker"
  fi
done

workflow_entry_files="$(
  (rg -l -F \
    "This is the single entry point for non-trivial Peers-Touch development." \
    tooling/skills/pt-*/SKILL.md || true) | sort
)"
workflow_entry_count="$(
  printf '%s\n' "$workflow_entry_files" | sed '/^$/d' | wc -l | tr -d ' '
)"
if [[ "$workflow_entry_count" -ne 1 || "$workflow_entry_files" != "$dev_workflow_skill" ]]; then
  fail "Development Workflow must have exactly one complete-development entry point"
fi

for marker in \
  "RESOURCE_DECLARATION_CONFLICT" \
  "MACHINE_WORK_LEDGER_INVALID" \
  "startOrUpdateDeclaration" \
  "releaseDeclaration"; do
  if ! grep -Fq "$marker" tooling/scripts/local-dev/dev-work-*.mjs; then
    fail "Development work ledger implementation missing marker: $marker"
  fi
done

if find . -path './node_modules' -prune -o -path './.git' -prune -o \
  -name work.json -print | grep -q .; then
  fail "repository contains a Development work ledger; use ~/.peers-touch/dev/work.json"
fi

if rg -n \
  '\.local[^[:space:]`"]*work\.json|workspaces/[^[:space:]`"]*/work\.json' \
  tooling/scripts tooling/skills AGENTS.md docs/global \
  docs/architecture/development-workflow \
  docs/architecture/local-dev-control-plane >/tmp/pt-private-work-ledger.$$; then
  cat /tmp/pt-private-work-ledger.$$
  fail "Development work declarations must not use a private worktree path"
fi
rm -f /tmp/pt-private-work-ledger.$$

if rg -n \
  'PT_ACCEPTANCE_ARTIFACT_ROOT|acceptance-artifact|evidence_store|dev/acceptance|Application Support/PeersTouch' \
  tooling/scripts/local-dev/dev-work-*.mjs >/tmp/pt-dev-work-acceptance-writer.$$; then
  cat /tmp/pt-dev-work-acceptance-writer.$$
  fail "Development work ledger code must not write Acceptance evidence"
fi
rm -f /tmp/pt-dev-work-acceptance-writer.$$

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
  "read-only projection adapter" \
  "It does not synchronize, repair, or write durable state." \
  "CONTEXT_PROJECTION_STALE"; do
  if ! grep -Fq "$marker" "$context_anchor_skill"; then
    fail "$context_anchor_skill missing read-only projection marker: $marker"
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

for marker in \
  "methodology facade" \
  "It does not perform that owner's work." \
  "does not:" \
  "pt-dev-workflow"; do
  if ! grep -Fq "$marker" "$god_view_skill"; then
    fail "$god_view_skill missing thin-facade marker: $marker"
  fi
done

if grep -Fq "planctl validate" "$god_view_skill" ||
  grep -Fq "current_task_id" "$god_view_skill" ||
  grep -Fq "dev_state" "$god_view_skill"; then
  fail "$god_view_skill must not embed Plan Package implementation details"
fi

plan_package_contract_files=(
  "$architecture_execution_skill"
  "$plan_skill"
  "$dev_workflow_skill"
  "$execution_guardian_skill"
  "$context_anchor_skill"
  "$goal_orchestrator_skill"
  "$agents_contract"
)

for contract_file in "${plan_package_contract_files[@]}"; do
  if ! grep -Fq "Plan Package" "$contract_file"; then
    fail "$contract_file missing Plan Package contract marker"
  fi
done

tracked_locator_files=(
  "$plan_skill"
  "$dev_workflow_skill"
  "$context_anchor_skill"
  "$agents_contract"
)

for contract_file in "${tracked_locator_files[@]}"; do
  for marker in "current_task_id" "current_task_path" "dev_state"; do
    if ! grep -Fq "$marker" "$contract_file"; then
      fail "$contract_file missing tracked locator marker: $marker"
    fi
  done
done

for marker in \
  "vertical execution model" \
  "risk-based" \
  "Do not require a canned"; do
  if ! grep -Fq "$marker" "$architecture_execution_skill"; then
    fail "$architecture_execution_skill missing vertical/risk planning marker: $marker"
  fi
done

for marker in \
  "planctl validate" \
  "Task Slice" \
  "prepared" \
  "Acceptance Execution"; do
  if ! grep -Fq "$marker" "$plan_skill"; then
    fail "$plan_skill missing package authoring marker: $marker"
  fi
done

if rg -q '\| id \| plan \| stage \| current_step \|' \
  "${plan_package_contract_files[@]}"; then
  fail "workflow contracts still publish the legacy active_work current_step schema"
fi

for marker in "Task lifecycle" "current Task" "Development Session"; do
  if ! grep -Fq "$marker" "$workflow_architecture"; then
    fail "$workflow_architecture missing workflow ownership marker: $marker"
  fi
done

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
  if command -v shasum >/dev/null 2>&1; then
    hash_command=(shasum -a 256)
  elif command -v sha256sum >/dev/null 2>&1; then
    hash_command=(sha256sum)
  else
    fail "neither shasum nor sha256sum is available"
    hash_command=(false)
  fi
  actual_hash="$(
    for doc in "${covered_docs[@]}"; do
      if [[ -f "$doc" ]]; then
        printf '### %s\n' "$doc"
        cat "$doc"
      elif [[ -d "$doc" ]]; then
        find "$doc" -type f -name '*.md' | LC_ALL=C sort | while IFS= read -r nested; do
          printf '### %s\n' "$nested"
          cat "$nested"
        done
      fi
    done | "${hash_command[@]}" | awk '{print $1}'
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
