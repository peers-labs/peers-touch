#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

skill_file="tooling/skills/pt-github-review/SKILL.md"
code_structure_fixture_validator="tooling/skills/pt-code-structure-review/scripts/validate-fixtures.mjs"
code_structure_decision_test="tooling/scripts/review/code_structure_decision_test.py"
pr_skill_file="tooling/skills/pt-github-pr/SKILL.md"
freshness_file="tooling/skills/pt-github-review/FRESHNESS.md"
fixtures_dir="tooling/review-fixtures"
pr_template=".github/PULL_REQUEST_TEMPLATE.md"
review_workflow=".github/workflows/review.yml"
pr_plan_input="tooling/scripts/review/pr-plan-input.py"
pr_plan_input_test="tooling/scripts/review/pr-plan-input-test.py"
execution_plan_test="tooling/scripts/execution-plan-test.py"
submit_pipeline="tooling/scripts/review/submit-pipeline.sh"
review_runner="tooling/scripts/review/run.sh"
gap_skill="tooling/skills/pt-acceptance-gap-detector/SKILL.md"
gap_procedures="tooling/skills/pt-acceptance-gap-detector/PROCEDURES.md"
gap_detector="tooling/scripts/acceptance-gap-detect.py"
pipeline_auditor_skill="tooling/skills/pt-acceptance-pipeline-auditor/SKILL.md"
pipeline_auditor="tooling/scripts/acceptance-pipeline-audit.py"
pipeline_auditor_test="tooling/scripts/acceptance-pipeline-audit-test.py"
plan_skill="tooling/skills/pt-plan-and-document/SKILL.md"
architecture_execution_skill="tooling/skills/pt-architecture-execution-methodology/SKILL.md"
dev_workflow_skill="tooling/skills/pt-dev-workflow/SKILL.md"
english_workflow_skill="tooling/skills/pt-ew/SKILL.md"
execution_guardian_skill="tooling/skills/pt-execution-plan-guardian/SKILL.md"
dev_workflow_skill="tooling/skills/pt-dev-workflow/SKILL.md"
dev_work_script="tooling/scripts/local-dev/dev-work.mjs"
dev_work_ledger="tooling/scripts/local-dev/dev-work-ledger.mjs"
dev_resource_plan="tooling/scripts/local-dev/dev-resource-plan.mjs"
dev_resource_plan_test="tooling/scripts/local-dev/dev-resource-plan.test.mjs"
dev_session_script="tooling/scripts/local-dev/dev-session.mjs"
dev_session_store="tooling/scripts/local-dev/dev-session-store.mjs"
dev_session_test="tooling/scripts/local-dev/dev-session.test.mjs"
planctl_script="tooling/scripts/plan/planctl.mjs"
acceptance_run="tooling/scripts/acceptance-run.py"
acceptance_registry="tooling/acceptance/registry.yaml"
local_dev_make="tooling/make/local-dev.mk"
ide_setup_script="tooling/scripts/ide-setup.sh"
setup_make="tooling/make/setup.mk"
agent_integration_audit="tooling/scripts/agent-integration-audit.py"
agent_installer="tooling/scripts/install-agent-integration.sh"
agent_integration_test="tooling/scripts/agent-integration-audit-test.py"
agent_integration_control="tooling/scripts/agent-integration-control.py"
agent_plugin="tooling/plugins/pt-ew-plugin/.codex-plugin/plugin.json"
agent_plugin_hooks="tooling/plugins/pt-ew-plugin/hooks.json"
agent_plugin_entry="tooling/plugins/pt-ew-plugin/scripts/hook-entry.mjs"
workflow_kernel="tooling/scripts/local-dev/workflow-kernel.mjs"
workflow_kernel_tests="tooling/scripts/local-dev/workflow-*.test.mjs"
skill_overlay_test="tooling/scripts/skill-overlay-control-test.py"
skill_overlay_control="tooling/scripts/skill-overlay-control.py"
context_anchor_skill="tooling/skills/pt-context-anchor/SKILL.md"
god_view_skill="tooling/skills/pt-god-view/SKILL.md"
goal_orchestrator_skill="tooling/skills/pt-goal-orchestrator/SKILL.md"
goal_template="tooling/skills/pt-goal-orchestrator/GOAL_TEMPLATE.md"
goal_review_rubric="tooling/skills/pt-goal-orchestrator/REVIEW_RUBRIC.md"
runtime_handoff_skill="tooling/skills/pt-dev-runtime-handoff/SKILL.md"
defect_closure_skill="tooling/skills/pt-defect-closure/SKILL.md"
local_dev_env_skill="tooling/skills/pt-local-dev-env/SKILL.md"
agent_development_skill="tooling/skills/pt-agent-development/SKILL.md"
agent_impact_policy="tooling/skills/pt-agent-development/impact-policy.json"
agent_impact_test="tooling/skills/pt-agent-development/scripts/test_impact.py"
trae_host_adapter="tooling/skills/pt-trae-host-adapter/SKILL.md"
cursor_host_adapter="tooling/skills/pt-cursor-host-adapter/SKILL.md"
codex_host_adapter="tooling/skills/pt-codex-host-adapter/SKILL.md"
workflow_architecture="docs/architecture/development-workflow/design.md"
global_workflow="docs/global/workflow.md"
agents_contract="AGENTS.md"
continuous_plan_invariant="docs/knowledge/invariants/continuous-plan-run.md"
host_neutral_invariant="docs/knowledge/invariants/host-neutral-agent-execution.md"
skill_overlay_invariant="docs/knowledge/invariants/user-skill-overlays-are-interaction-only.md"

failures=0

fail() {
  failures=$((failures + 1))
  printf '[skill-check] %s\n' "$1"
}

require_file() {
  [[ -f "$1" ]] || fail "missing required file: $1"
}

require_file "$skill_file"
require_file "$code_structure_fixture_validator"
require_file "$code_structure_decision_test"
require_file "$pr_skill_file"
require_file "$freshness_file"
require_file "$pr_template"
require_file "$review_workflow"
require_file "$pr_plan_input"
require_file "$pr_plan_input_test"
require_file "$execution_plan_test"
require_file "$submit_pipeline"
require_file "$review_runner"
require_file "$gap_skill"
require_file "$gap_procedures"
require_file "$gap_detector"
require_file "$pipeline_auditor_skill"
require_file "$pipeline_auditor"
require_file "$pipeline_auditor_test"
require_file "$plan_skill"
require_file "$architecture_execution_skill"
require_file "$dev_workflow_skill"
require_file "$english_workflow_skill"
require_file "$execution_guardian_skill"
require_file "$dev_workflow_skill"
require_file "$dev_work_script"
require_file "$dev_work_ledger"
require_file "$dev_resource_plan"
require_file "$dev_resource_plan_test"
require_file "$dev_session_script"
require_file "$dev_session_store"
require_file "$dev_session_test"
require_file "$planctl_script"
require_file "$acceptance_run"
require_file "$acceptance_registry"
require_file "$local_dev_make"
require_file "$ide_setup_script"
require_file "$setup_make"
require_file "$agent_integration_audit"
require_file "$agent_installer"
require_file "$agent_integration_test"
require_file "$agent_integration_control"
require_file "$agent_plugin"
require_file "$agent_plugin_hooks"
require_file "$agent_plugin_entry"
require_file "$workflow_kernel"
for kernel_test in $workflow_kernel_tests; do
  require_file "$kernel_test"
done
if [[ -e tooling/scripts/local-dev/workflow-guard.mjs ]] ||
  [[ -e tooling/scripts/local-dev/workflow-guard.test.mjs ]]; then
  fail "removed cwd-derived workflow guard still exists"
fi
require_file "$skill_overlay_test"
require_file "$skill_overlay_control"
require_file "$context_anchor_skill"
require_file "$god_view_skill"
require_file "$goal_orchestrator_skill"
require_file "$goal_template"
require_file "$goal_review_rubric"
require_file "$runtime_handoff_skill"
require_file "$defect_closure_skill"
require_file "$local_dev_env_skill"
require_file "$agent_development_skill"
require_file "$agent_impact_policy"
require_file "$agent_impact_test"
require_file "$trae_host_adapter"
require_file "$cursor_host_adapter"
require_file "$codex_host_adapter"
require_file "$workflow_architecture"
require_file "$global_workflow"

for marker in \
  "Expensive resources belong to Task or Suite scope." \
  "pt-acceptance-infra-engineering" \
  "pt-acceptance-engineering" \
  "PASS/SUPPORTING"; do
  if ! grep -Fq "$marker" "$pipeline_auditor_skill"; then
    fail "$pipeline_auditor_skill missing Suite Runtime audit marker: $marker"
  fi
done

for marker in \
  "RUNTIME_REUSE_CONTRACT_MISSING" \
  "validate_suite_runtime_report" \
  "acceptance-pipeline-audit"; do
  if ! grep -Fq "$marker" "$pipeline_auditor"; then
    fail "$pipeline_auditor missing executable audit marker: $marker"
  fi
done
require_file "$agents_contract"
require_file "$continuous_plan_invariant"
require_file "$host_neutral_invariant"
require_file "$skill_overlay_invariant"

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

for marker in \
  "Tracked PR" \
  "Standalone PR" \
  "--allow-untracked" \
  "Plan absence alone never forces a draft PR"; do
  if ! grep -Fq -- "$marker" "$pr_skill_file"; then
    fail "$pr_skill_file missing tracked/standalone PR marker: $marker"
  fi
done

for marker in \
  "Explicit standalone no-Plan work" \
  "planPolicy=standalone"; do
  if ! grep -Fq -- "$marker" "$dev_workflow_skill"; then
    fail "$dev_workflow_skill missing explicit no-Plan marker: $marker"
  fi
done

for marker in \
  "explicit user Plan policy" \
  "PLAN_POLICY_CONFLICT"; do
  if ! grep -Fq -- "$marker" "$god_view_skill"; then
    fail "$god_view_skill missing explicit no-Plan routing marker: $marker"
  fi
done

if ! grep -Fq "PLAN_PERSISTENCE_FORBIDDEN" "$plan_skill"; then
  fail "$plan_skill must reject explicit no-Plan persistence"
fi
if ! grep -Fq "Explicit standalone no-Plan work" "$global_workflow"; then
  fail "$global_workflow missing the human-facing no-Plan contract"
fi
if ! grep -Fq "explicit standalone no-Plan work" "$agents_contract"; then
  fail "$agents_contract missing the no-Plan stage-dispatch contract"
fi

retired_unapproved_plan="docs/architecture/development-workflow/execution-plans/20261004-nonblocking-agent-integration"
if [[ -e "$retired_unapproved_plan" ]]; then
  fail "unapproved execution Plan still exists: $retired_unapproved_plan"
fi
if rg -n \
  'DWF-NONBLOCKING-INTEGRATION-20261004|20261004-nonblocking-agent-integration|DWF-NBI0' \
  AGENTS.md docs tooling \
  --glob '!tooling/scripts/review/skill-check.sh' \
  >/tmp/pt-retired-unapproved-plan.$$; then
  cat /tmp/pt-retired-unapproved-plan.$$
  fail "live source still references the unapproved execution Plan"
fi
rm -f /tmp/pt-retired-unapproved-plan.$$

for marker in \
  "--allow-untracked" \
  "mode: " \
  "standalone PR has no Development Session"; do
  if ! grep -Fq -- "$marker" "$submit_pipeline"; then
    fail "$submit_pipeline missing standalone PR behavior: $marker"
  fi
done

for marker in \
  "Execution Plans / 执行计划" \
  "pr-plan-input.py" \
  "execution-plan.py"; do
  if ! grep -Fq "$marker" "$pr_template" "$review_workflow" "$pr_plan_input"; then
    fail "explicit PR Plan input is missing marker: $marker"
  fi
done

if ! python3 "$pr_plan_input_test" >/tmp/pt-pr-plan-input-test.$$ 2>&1; then
  cat /tmp/pt-pr-plan-input-test.$$
  fail "$pr_plan_input_test failed"
fi
rm -f /tmp/pt-pr-plan-input-test.$$

if ! python3 "$execution_plan_test" >/tmp/pt-execution-plan-test.$$ 2>&1; then
  cat /tmp/pt-execution-plan-test.$$
  fail "$execution_plan_test failed"
fi
rm -f /tmp/pt-execution-plan-test.$$

if ! grep -Fq "blocked handoff requires a BLOCKED Session with a failure record" "$planctl_script"; then
  fail "$planctl_script must permit only evidence-backed blocked Task handoff"
fi

for marker in \
  "GLOBAL_WORKFLOW_NOT_IDLE" \
  "INSTALLING" \
  "BLOCKED" \
  "INSTALLED"; do
  if ! grep -Fq "$marker" "$agent_integration_control"; then
    fail "$agent_integration_control missing integration lifecycle marker: $marker"
  fi
done

for marker in \
  "functional-result" \
  "commitFunctionalResult" \
  "runDevelopmentClosure" \
  "development-run-manifest" \
  "gateIds" \
  "development-functional-evidence-bundle" \
  "functional result may commit only from FUNCTIONAL_RUNNING" \
  "source changed between Development evidence validation and Session commit" \
  "SESSION_EVIDENCE_OUT_OF_SEQUENCE"; do
  if ! grep -Fq "$marker" "$dev_session_script"; then
    fail "$dev_session_script missing functional result commit marker: $marker"
  fi
done

for marker in \
  "HOST_CAPABILITY_UNAVAILABLE" \
  "HOST_CAPABILITY_AVAILABLE" \
  "HOST_CLEANUP_QUARANTINED" \
  "HOST_CLEANUP_RELEASED" \
  "HOST_CLEANUP_ESCALATION_REQUIRED" \
  "repeated BLOCKED transition is not a legal host observation update"; do
  if ! grep -Fq "$marker" tooling/scripts/local-dev/dev-session-schema.mjs; then
    fail "tooling/scripts/local-dev/dev-session-schema.mjs missing durable host observation marker: $marker"
  fi
done

for marker in \
  "--development-manifest-out" \
  "finalize_development_run" \
  "gate_run.finalize" \
  "development-run-manifest"; do
  if ! grep -Fq -- "$marker" "$acceptance_run"; then
    fail "$acceptance_run missing runner provenance marker: $marker"
  fi
done

if grep -Fq -- "--result-file" "$dev_session_script"; then
  fail "$dev_session_script still accepts caller-authored functional result files"
fi

if ! python3 -m unittest "$agent_integration_test" >/tmp/pt-agent-integration-test.$$ 2>&1; then
  cat /tmp/pt-agent-integration-test.$$
  fail "$agent_integration_test failed"
fi
rm -f /tmp/pt-agent-integration-test.$$

if ! node --test $workflow_kernel_tests \
  "tooling/plugins/pt-ew-plugin/scripts/hook-entry.test.mjs" \
  >/tmp/pt-agent-hook-test.$$ 2>&1; then
  cat /tmp/pt-agent-hook-test.$$
  fail "conversation-bound workflow kernel tests failed"
fi
rm -f /tmp/pt-agent-hook-test.$$

for marker in \
  "CROSS_WORKTREE_WRITE_DENIED" \
  "OBSERVE_ONLY" \
  "CONTEXT_ANCHOR_REQUIRED" \
  "releaseWorkflowOwner"; do
  if ! grep -Fq "$marker" "$workflow_kernel"; then
    fail "$workflow_kernel missing owner-rooted enforcement marker: $marker"
  fi
done

if ! python3 -m unittest "$skill_overlay_test" >/tmp/pt-skill-overlay-test.$$ 2>&1; then
  cat /tmp/pt-skill-overlay-test.$$
  fail "$skill_overlay_test failed"
fi
rm -f /tmp/pt-skill-overlay-test.$$

for marker in \
  "transitionSessionSequenceStore" \
  "writeDurableFileAtomic" \
  "linkSync(temp, file)"; do
  if ! grep -Fq "$marker" "$dev_session_store"; then
    fail "$dev_session_store missing durable result commit marker: $marker"
  fi
done

for marker in "declared_incomplete" 'standardized["proofStatus"] = "UNPROVEN"'; do
  if ! grep -Fq "$marker" "$acceptance_run"; then
    fail "$acceptance_run missing incomplete Development result marker: $marker"
  fi
done

for marker in "dev-functional-result:" "RUNTIME_CELL"; do
  if ! grep -Fq "$marker" "$local_dev_make"; then
    fail "$local_dev_make missing functional result command marker: $marker"
  fi
done
if grep -Fq "RESULT_FILE" "$local_dev_make"; then
  fail "$local_dev_make still accepts caller-authored functional result files"
fi

for setup_file in "$ide_setup_script" "$setup_make"; do
  for marker in "trae" "cursor" "codex"; do
    if ! grep -Fqi "$marker" "$setup_file"; then
      fail "$setup_file missing supported host marker: $marker"
    fi
  done
done
if ! grep -Fq ".agents" "$agent_integration_control"; then
  fail "$agent_integration_control must project Codex integration through .agents"
fi
for marker in \
  'IDE_NAME="$(IDE)"' \
  "agent-integration-audit:"; do
  if ! grep -Fq "$marker" "$setup_make"; then
    fail "$setup_make missing non-interactive integration marker: $marker"
  fi
done
for marker in \
  "retired-project-skills" \
  "pt-trae-goal-orchestrator" \
  "pt-ew-plugin" \
  "planned_cursor_hooks" \
  '"failClosed": True' \
  "project pt-* skills under"; do
  if ! grep -Fq "$marker" "$agent_integration_control"; then
    fail "$agent_integration_control missing install marker: $marker"
  fi
done

for marker in \
  "missingCanonicalSkills" \
  "canonicalSourceFindings" \
  "legacyReferences" \
  "hostProjectionFindings" \
  "workflowIdentity" \
  "planMount" \
  "currentTaskId" \
  "planLegacyClaims" \
  "declarationLegacyClaims" \
  "acceptanceRegistry" \
  "missingCanonicalMatchers" \
  "canonicalIntegrationCatalog" \
  "integrationReceipt"; do
  if ! grep -Fq "$marker" "$agent_integration_audit"; then
    fail "$agent_integration_audit missing integration audit marker: $marker"
  fi
done

for marker in \
  "plan-mount-canonical-invalid" \
  "declaration-plan-locator-missing" \
  "declaration-current-task-mismatch" \
  "registry-missing" \
  "integration-branch-mismatch" \
  'findings.append(f"{field}-mismatch")' \
  "integration-callback-proof-invalid" \
  "wrong-project-skill-target"; do
  if ! grep -Fq "$marker" "$agent_integration_audit"; then
    fail "$agent_integration_audit missing fail-closed audit marker: $marker"
  fi
done

for marker in \
  "staleRecoveryPath" \
  "claimAndRemoveStaleLock" \
  "readRecoveryMetadata" \
  "clearStaleRecovery" \
  "lstatSync"; do
  if ! grep -Fq "$marker" "$dev_work_ledger"; then
    fail "$dev_work_ledger missing inode-safe stale lock recovery marker: $marker"
  fi
done

for marker in \
  "acceptance-workflow-contract" \
  "tooling/skills/pt-goal-orchestrator/**" \
  "tooling/skills/pt-trae-host-adapter/**" \
  "tooling/skills/pt-cursor-host-adapter/**" \
  "tooling/skills/pt-codex-host-adapter/**"; do
  if ! grep -Fq "$marker" "$acceptance_registry"; then
    fail "$acceptance_registry missing canonical host-neutral matcher: $marker"
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

overlay_host_markers=(
  "shared overlay host"
  "skill-overlay-control.py resolve --target pt-ew"
  "No enabled overlays means passthrough"
  "pt-god-view"
  "Never execute scripts"
)

for marker in "${overlay_host_markers[@]}"; do
  if ! grep -Fq "$marker" "$english_workflow_skill"; then
    fail "$english_workflow_skill missing required Overlay host behavior: $marker"
  fi
done

if rg -q "Chinese input:|English input:|Default response language: English" "$english_workflow_skill"; then
  fail "$english_workflow_skill must not embed a user-specific language policy"
fi
if ! grep -Fq "^(tooling/skills/|" "$review_runner"; then
  fail "$review_runner must run skill-check for every canonical project skill change"
fi

for marker in \
  "Mandatory Concurrency Decision" \
  "Host Capability Projection" \
  "HOST_PARALLELISM_UNAVAILABLE" \
  "exclusive write sets are disjoint" \
  "Reserve every write path before spawning." \
  "SUBAGENT_REGISTRY_STALE" \
  "host-neutral scheduler"; do
  if ! grep -Fq "$marker" "$goal_orchestrator_skill"; then
    fail "$goal_orchestrator_skill missing scheduler marker: $marker"
  fi
done

for marker in \
  "read-only policy guard" \
  "May this specific proposed action run now?" \
  "ACTION_ALLOWED" \
  "The Guardian does not perform the amendment" \
  "already-authorized operations execute directly" \
  "accepted Plan's explicit" \
  "actual external permission" \
  "outside every explicit grant"; do
  if ! grep -Fq "$marker" "$execution_guardian_skill"; then
    fail "$execution_guardian_skill missing policy-boundary marker: $marker"
  fi
done

if grep -Fq "Self-amend and continue" "$execution_guardian_skill" ||
  grep -Fq "Mandatory Concurrency Decision" "$execution_guardian_skill"; then
  fail "$execution_guardian_skill must not own plan mutation or scheduling"
fi

if grep -Fq "infer authorization from a plan" "$execution_guardian_skill"; then
  fail "$execution_guardian_skill must distinguish explicit Plan authorization from mere Plan existence"
fi

for marker in \
  "single entry point" \
  "Plan Run Authorization" \
  "Already-authorized operations execute directly" \
  "actual external" \
  "out-of-envelope" \
  "Agent Review Loop" \
  "dependency-ready successor" \
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

for contract in \
  docs/global/workflow.md \
  docs/knowledge/invariants/continuous-plan-run.md \
  docs/architecture/development-workflow/design.md; do
  if ! grep -Fiq "already-authorized operations execute directly" "$contract"; then
    fail "$contract missing authorization-reuse invariant"
  fi
done

for marker in \
  "authorization.runtime.deployProfiles" \
  "destructiveResetScopes" \
  "another approval prompt." \
  "never converted into another user confirmation"; do
  if ! grep -Fq "$marker" "$local_dev_env_skill"; then
    fail "$local_dev_env_skill missing authorization-reuse marker: $marker"
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
  "Completed delta" \
  "Next Progress Slice" \
  "Projected progress after Next" \
  "Expected progress effect" \
  "Plan Run queue" \
  "Execution mandate" \
  "Autonomous horizon" \
  "Stop conditions" \
  "Remaining frontier" \
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
  "Only live, addressable workers" \
  "SUBAGENT_REGISTRY_STALE" \
  "HOST_PARALLELISM_UNAVAILABLE" \
  "GOAL_SOURCE_UNRESOLVED"; do
  if ! grep -Fq "$marker" "$goal_orchestrator_skill"; then
    fail "$goal_orchestrator_skill missing agent reconciliation marker: $marker"
  fi
done

for marker in \
  "scheduling and recovery unit inside a Plan Run" \
  "without user confirmation"; do
  if ! grep -Fq "$marker" "$goal_orchestrator_skill"; then
    fail "$goal_orchestrator_skill missing continuous Plan Run marker: $marker"
  fi
done

for marker in \
  "Concurrency Decision" \
  "Progress Contract" \
  "Expected delta" \
  "Reporting boundary" \
  "Exclusive write-set owners" \
  "Shared runtime resources" \
  "Integration order and rollback boundary" \
  "Existing-worker reconciliation" \
  "Host capability request" \
  "Host adapter"; do
  if ! grep -Fq "$marker" "$goal_template"; then
    fail "$goal_template missing parallel tracking marker: $marker"
  fi
done

for marker in \
  "Concurrency decision" \
  "Worker reconciliation" \
  "Host neutrality" \
  "Adapter boundary"; do
  if ! grep -Fq "$marker" "$goal_review_rubric"; then
    fail "$goal_review_rubric missing parallel review marker: $marker"
  fi
done

if ! grep -Fq "merely to print the Anchor" "$god_view_skill"; then
  fail "$god_view_skill must not let resume-time Anchor projection pause execution"
fi

for marker in \
  "continuous Plan Run across dependency-ready Tasks" \
  "Never end a Context Anchor or successful" \
  "full authorized Plan Run"; do
  if ! grep -Fq "$marker" "$english_workflow_skill"; then
    fail "$english_workflow_skill missing continuous execution marker: $marker"
  fi
done

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
  fail "$god_view_skill must not embed Plan Version implementation details"
fi

plan_version_contract_files=(
  "$architecture_execution_skill"
  "$plan_skill"
  "$dev_workflow_skill"
  "$execution_guardian_skill"
  "$context_anchor_skill"
  "$goal_orchestrator_skill"
  "$agents_contract"
)

for contract_file in "${plan_version_contract_files[@]}"; do
  if ! grep -Fq "Plan Version" "$contract_file"; then
    fail "$contract_file missing Plan Version contract marker"
  fi
done

tracked_locator_files=(
  "$dev_workflow_skill"
  "$context_anchor_skill"
)

for contract_file in "${tracked_locator_files[@]}"; do
  for marker in "currentTaskId" "currentTaskPath" "devState"; do
    if ! grep -Fq "$marker" "$contract_file"; then
      fail "$contract_file missing tracked locator marker: $marker"
    fi
  done
done

for marker in \
  "Workspace active-work record" \
  "Plan/Task locator" \
  "devState"; do
  if ! grep -Fq "$marker" "$agents_contract"; then
    fail "$agents_contract missing workspace active-work marker: $marker"
  fi
done

for marker in \
  "Frozen Plan Version 没有 current Task" \
  "make active-work-sync WORK_ITEM=<id>" \
  "不创建 active-work"; do
  if ! grep -Fq "$marker" "$plan_skill"; then
    fail "$plan_skill missing deferred active-work registration marker: $marker"
  fi
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
  "frozen" \
  "Acceptance Execution"; do
  if ! grep -Fq "$marker" "$plan_skill"; then
    fail "$plan_skill missing package authoring marker: $marker"
  fi
done

if rg -q '\| id \| plan \| stage \| current_step \|' \
  "${plan_version_contract_files[@]}"; then
  fail "workflow contracts still publish the legacy active_work current_step schema"
fi

for marker in "Task lifecycle" "current Task" "Development Session"; do
  if ! grep -Fq "$marker" "$workflow_architecture"; then
    fail "$workflow_architecture missing workflow ownership marker: $marker"
  fi
done

for marker in \
  "Continuous Plan Run" \
  "The user is not the default reviewer." \
  "Do not ask \`Continue?\`"; do
  if ! grep -Fq "$marker" "$agents_contract"; then
    fail "$agents_contract missing Plan Run governance marker: $marker"
  fi
done

for marker in \
  "continuous Plan Run over its accepted scope" \
  "Review MUST be agent-led by default" \
  "fixed-point exhaustion"; do
  if ! grep -Fq "$marker" "$continuous_plan_invariant"; then
    fail "$continuous_plan_invariant missing invariant marker: $marker"
  fi
done

for marker in \
  "Repository-owned Make targets" \
  "Host Capability Need" \
  "HOST_CAPABILITY_UNAVAILABLE" \
  "Functional Result Commit" \
  "SESSION_PROJECTION_STALE" \
  "SESSION_EVIDENCE_OUT_OF_SEQUENCE" \
  "\`--idle 0\` is forbidden"; do
  if ! grep -Fq "$marker" "$runtime_handoff_skill"; then
    fail "$runtime_handoff_skill missing host-neutral runtime marker: $marker"
  fi
done
if ! grep -Fq "sole request projector" "$goal_orchestrator_skill"; then
  fail "$goal_orchestrator_skill must own Host Capability Request projection"
fi
if grep -Fq "projects a Host Capability Request" "$runtime_handoff_skill"; then
  fail "$runtime_handoff_skill must not duplicate Host Capability Request ownership"
fi

for marker in \
  "Host Transport Failure Loop" \
  "HOST_TOOL_CALL_FAILED" \
  "retryable" \
  "recompute serial/hybrid" \
  "zero-progress retry loop"; do
  if ! grep -Fq "$marker" "$dev_workflow_skill"; then
    fail "$dev_workflow_skill missing host failure closure marker: $marker"
  fi
done

for marker in \
  "HOST_DIAGNOSTIC_RETAINED" \
  "blocksPlanRun=false" \
  "cleanup=retained-bounded" \
  "leaseExpiresAt" \
  "Session transition" \
  "Task closure" \
  "before any host cleanup follow-up" \
  "never write the transient envelope to Session" \
  "never wait for its confirmation workflow"; do
  if ! grep -Fq "$marker" "$dev_workflow_skill"; then
    fail "$dev_workflow_skill missing non-blocking diagnostic marker: $marker"
  fi
done

for marker in \
  "diagnostic sidecar" \
  "Never enter a host debugger workflow in this owner turn" \
  "Commit the deterministic project result and Session transition" \
  "Task progression remains with" \
  "After that commit, remove runtime-owned instrumentation" \
  "HOST_DIAGNOSTIC_RETAINED" \
  "blocksPlanRun=false" \
  "cleanup=retained-bounded" \
  "leaseExpiresAt" \
  "Return to Dev Workflow immediately"; do
  if ! grep -Fq "$marker" "$runtime_handoff_skill"; then
    fail "$runtime_handoff_skill missing diagnostic sidecar boundary: $marker"
  fi
done

if grep -Fq 'use `TRAE-debugger` workflow' "$defect_closure_skill"; then
  fail "$defect_closure_skill must not require a TRAE-specific debugger"
fi
for marker in \
  "host-neutral evidence loop" \
  "pt-dev-runtime-handoff" \
  "FUNCTIONAL_PASS"; do
  if ! grep -Fq "$marker" "$defect_closure_skill"; then
    fail "$defect_closure_skill missing host-neutral defect marker: $marker"
  fi
done

for adapter in "$trae_host_adapter" "$cursor_host_adapter" "$codex_host_adapter"; do
  for marker in \
    "owns no product semantics" \
    'Invoked only by `pt-dev-workflow` after `ACTION_ALLOWED`' \
    "HOST_CAPABILITY_UNAVAILABLE" \
    "HOST_CLEANUP_QUARANTINED" \
    "HOST_CLEANUP_ESCALATION_REQUIRED" \
    "operation=inspect-quarantine" \
    "current tool registry" \
    "requestId" \
    "actionId" \
    "adapterAttempted=true" \
    "resourceId" \
    "cleanupAttempt=1" \
    "cleanupHandle" \
    "host-neutral"; do
    if ! grep -Fq "$marker" "$adapter"; then
      fail "$adapter missing host adapter boundary: $marker"
    fi
  done
done

for marker in \
  "isolated diagnostic sidecar" \
  "workflow in the Dev Workflow or Runtime Handoff owner turn" \
  "return to Dev Workflow immediately" \
  "HOST_DIAGNOSTIC_RETAINED" \
  "blocksPlanRun=false" \
  "cleanup=retained-bounded" \
  "leaseExpiresAt"; do
  if ! grep -Fq "$marker" "$trae_host_adapter"; then
    fail "$trae_host_adapter missing isolated diagnostic contract: $marker"
  fi
done

for marker in \
  "WorkLedgerLock" \
  "RELEASING" \
  "INSTALLING" \
  "INSTALLED" \
  "callbackProof" \
  "integrationDigest" \
  "integrationStatusDigest" \
  "validated_work_ledger" \
  "HOST_PROJECTION_ESCAPE"; do
  if ! grep -Fq "$marker" "$agent_integration_control"; then
    fail "$agent_integration_control missing fail-closed integration marker: $marker"
  fi
done
if grep -Fq "schemaVersion" "$agent_integration_control"; then
  fail "$agent_integration_control must not publish a integration format version"
fi
for marker in \
  "peers-touch-skill-overlay-registry" \
  "OVERLAY_NAME_CONFLICT" \
  "OVERLAY_STORE_INVALID" \
  "SUPPORTED_TARGETS" \
  "source must not contain symlinks"; do
  if ! grep -Fq "$marker" "$skill_overlay_control"; then
    fail "$skill_overlay_control missing fail-closed Overlay marker: $marker"
  fi
done
if grep -Fq "schemaVersion" "$skill_overlay_control"; then
  fail "$skill_overlay_control must not publish an Overlay format version"
fi
for marker in \
  "skill-overlay-install:" \
  "skill-overlay-list:" \
  "skill-overlay-enable:" \
  "skill-overlay-disable:" \
  "skill-overlay-uninstall:" \
  "skill-overlay-resolve:"; do
  if ! grep -Fq "$marker" "$setup_make"; then
    fail "$setup_make missing Overlay control marker: $marker"
  fi
done
for marker in \
  "interaction policy only" \
  "immutable installed copy" \
  "Canonical project agent integration"; do
  if ! grep -Fq "$marker" "$skill_overlay_invariant"; then
    fail "$skill_overlay_invariant missing Overlay boundary marker: $marker"
  fi
done
if rg -n '^> \*\*Version\*\*:' docs/architecture/development-workflow \
  >/tmp/pt-workflow-version-labels.$$; then
  cat /tmp/pt-workflow-version-labels.$$
  fail "Development Workflow documents must not publish version labels"
fi
rm -f /tmp/pt-workflow-version-labels.$$
if ! grep -Fq "No Invented Development Workflow Versions" "$agents_contract"; then
  fail "$agents_contract must define the unversioned internal workflow rule"
fi
while IFS= read -r plan_doc; do
  if grep -Fq '"schemaVersion"' "$plan_doc"; then
    fail "$plan_doc contains a versioned Plan/Task contract"
  fi
done < <(
  rg -l \
    'peers-touch-plan-package|peers-touch-task-slice' \
    docs/architecture \
    --glob '**/execution-plans/**/*.md'
)

if rg -n \
  'HOST_UI_ADAPTER_UNAVAILABLE|`pt-goal-orchestrator` needs|`pt-dev-runtime-handoff` needs|actual .*project-native fallback used|the project.s Playwright path' \
  "$runtime_handoff_skill" "$trae_host_adapter" "$cursor_host_adapter" \
  "$codex_host_adapter" >/tmp/pt-host-adapter-bypass.$$; then
  cat /tmp/pt-host-adapter-bypass.$$
  fail "host adapter contracts contain an unowned entrypoint or status alias"
fi
rm -f /tmp/pt-host-adapter-bypass.$$

if grep -Fq -- "-> optional detected pt-*-host-adapter" "$runtime_handoff_skill"; then
  fail "$runtime_handoff_skill still models direct Host Adapter invocation"
fi

if rg -n \
  'pt-trae-goal-orchestrator|use `TRAE-debugger` workflow' \
  AGENTS.md docs/global tooling/skills tooling/scripts/review \
  --glob '!tooling/scripts/review/skill-check.sh' >/tmp/pt-host-coupling.$$; then
  cat /tmp/pt-host-coupling.$$
  fail "live workflow contracts still depend on the retired TRAE-specific owner"
fi
rm -f /tmp/pt-host-coupling.$$

if rg -n 'TRAE-debugger' \
  "$dev_workflow_skill" "$runtime_handoff_skill" \
  >/tmp/pt-parent-debugger-coupling.$$; then
  cat /tmp/pt-parent-debugger-coupling.$$
  fail "Dev Workflow and Runtime Handoff must not enter a host debugger directly"
fi
rm -f /tmp/pt-parent-debugger-coupling.$$

for marker in \
  "Peers-Touch owns scheduling, authorization, product Journeys" \
  "HOST_CAPABILITY_UNAVAILABLE" \
  "SESSION_PROJECTION_STALE" \
  "isolated diagnostic sidecar" \
  "blocksPlanRun=false" \
  "cleanup=retained-bounded" \
  "leaseExpiresAt"; do
  if ! grep -Fq "$marker" "$host_neutral_invariant"; then
    fail "$host_neutral_invariant missing invariant marker: $marker"
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
        find "$doc" -type f -name '*.md' ! -path '*/execution-plans/*' | LC_ALL=C sort | while IFS= read -r nested; do
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

if ! node "$code_structure_fixture_validator" \
  >/tmp/pt-code-structure-fixtures.$$ 2>&1; then
  cat /tmp/pt-code-structure-fixtures.$$
  fail "$code_structure_fixture_validator failed"
fi
rm -f /tmp/pt-code-structure-fixtures.$$

if ! node --test \
  tooling/skills/pt-code-structure-review/scripts/structure-signals.test.mjs \
  >/tmp/pt-code-structure-signals.$$ 2>&1; then
  cat /tmp/pt-code-structure-signals.$$
  fail "code structure signal tests failed"
fi
rm -f /tmp/pt-code-structure-signals.$$

if ! python3 "$code_structure_decision_test" \
  >/tmp/pt-code-structure-decision.$$ 2>&1; then
  cat /tmp/pt-code-structure-decision.$$
  fail "code structure decision tests failed"
fi
rm -f /tmp/pt-code-structure-decision.$$

if ! node --test "$dev_resource_plan_test" \
  >/tmp/pt-dev-resource-plan.$$ 2>&1; then
  cat /tmp/pt-dev-resource-plan.$$
  fail "Development resource-plan tests failed"
fi
rm -f /tmp/pt-dev-resource-plan.$$

if ! python3 "$agent_impact_test" \
  >/tmp/pt-agent-impact.$$ 2>&1; then
  cat /tmp/pt-agent-impact.$$
  fail "Agent ModuleImpact tests failed"
fi
rm -f /tmp/pt-agent-impact.$$

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

architecture_context_output="$(
  tooling/scripts/review/knowledge-match.sh \
    --changed-file tooling/scripts/plan/plan-package.mjs \
    --strict 2>&1
)"
if ! grep -q '"architecture-module-governance"' <<< "$architecture_context_output"; then
  fail "knowledge-match.sh must delegate changed paths to architecture governance"
fi

if tooling/scripts/review/knowledge-match.sh \
  --changed-file docs/architecture/unregistered/design.md \
  >/tmp/pt-architecture-unregistered.$$ 2>&1; then
  fail "knowledge-match.sh must reject changed unregistered architecture modules"
fi
rm -f /tmp/pt-architecture-unregistered.$$

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
