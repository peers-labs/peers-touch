#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
cd "$repo_root"

fail() {
  printf 'skill-check: %s\n' "$*" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || fail "required file is missing: $1"
}

required_files=(
  AGENTS.md
  docs/global/workflow.md
  docs/knowledge/invariants/acceptance-scope-is-runner-owned.md
  tooling/scripts/local-dev/task-progress-store.mjs
  tooling/scripts/local-dev/dev-work.mjs
  tooling/scripts/local-dev/development-close.mjs
  tooling/scripts/local-dev/completion-review.mjs
  tooling/scripts/local-dev/workflow-kernel.mjs
  tooling/scripts/local-dev/workflow-host-adapters.mjs
  tooling/scripts/local-dev/workflow-snapshot.mjs
  tooling/scripts/local-dev/workflow-doctor.mjs
  tooling/scripts/local-dev/development-flow-residue.mjs
  tooling/scripts/plan/planctl.mjs
  tooling/scripts/acceptance-run.py
  tooling/scripts/acceptance-gap-detect.py
  tooling/scripts/agent-integration-control.py
  tooling/scripts/agent-integration-audit.py
  tooling/plugins/pt-ew-plugin/scripts/hook-entry.mjs
  tooling/skills/pt-dev-workflow/SKILL.md
  tooling/skills/pt-context-anchor/SKILL.md
  tooling/skills/pt-completion-auditor/SKILL.md
  tooling/skills/pt-execution-plan-guardian/SKILL.md
  tooling/skills/pt-github-review/SKILL.md
  tooling/skills/pt-github-review/FRESHNESS.md
  tooling/skills/pt-code-structure-review/scripts/validate-fixtures.mjs
)

for file in "${required_files[@]}"; do
  require_file "$file"
done

for skill in tooling/skills/pt-*/SKILL.md; do
  grep -Eq '^name: "?pt-[a-z0-9-]+"?$' "$skill" \
    || fail "Skill name frontmatter is invalid: $skill"
  grep -Eq '^description: .+' "$skill" \
    || fail "Skill description frontmatter is missing: $skill"
done

if git ls-files '.trae/skills/pt-*/SKILL.md' '.cursor/skills/pt-*/SKILL.md' \
  '.agents/skills/pt-*/SKILL.md' | grep -q .; then
  fail "host-private Skill projections must not be tracked"
fi

grep -Fq 'North Star' tooling/skills/pt-dev-workflow/SKILL.md \
  || fail "pt-dev-workflow must preserve the North Star contract"
grep -Fq 'Plans and task progress are optional inputs' \
  tooling/skills/pt-dev-workflow/SKILL.md \
  || fail "pt-dev-workflow must keep Plan and task progress optional"
grep -Fq 'Hook context is advisory' tooling/skills/pt-dev-workflow/SKILL.md \
  || fail "pt-dev-workflow must keep Hook context advisory"
grep -Fq 'must never invent, forge, or relabel' \
  tooling/skills/pt-completion-auditor/SKILL.md \
  || fail "completion review must state the trusted Agent honesty rule"

merge_preservation_markers=(
  "Cross-Branch Preservation Review"
  "prospective merge tree"
  "PRESERVED"
  "INTENTIONALLY_SUPERSEDED"
  "UNPROVEN"
  "coverage loss"
  "false kill"
  "git range-diff"
  "pt-branch-conflict-guardian"
)
for marker in "${merge_preservation_markers[@]}"; do
  grep -Fq "$marker" tooling/skills/pt-github-review/SKILL.md \
    || fail "review skill missing cross-branch preservation marker: $marker"
done

for marker in \
  'plan-inspect:' \
  'plan-task:' \
  'dev-start:' \
  'dev-update:' \
  'dev-status:' \
  'dev-status-all:' \
  'dev-close:' \
  'completion-review-prepare:' \
  'completion-review-assess:'; do
  grep -Fq "$marker" tooling/make/local-dev.mk \
    || fail "local-dev Make contract is missing $marker"
done

for retired in \
  'plan-mount:' \
  'active-work-sync:' \
  'dev-session-start:' \
  'dev-check:' \
  'dev-heartbeat:' \
  'dev-release:' \
  'skills-hard-cut:' \
  'skills-gc:'; do
  if grep -Fq "$retired" tooling/make/local-dev.mk tooling/make/setup.mk; then
    fail "retired Make entrypoint remains: $retired"
  fi
done

node --check tooling/scripts/local-dev/task-progress-store.mjs
node --check tooling/scripts/local-dev/dev-work.mjs
node --check tooling/scripts/local-dev/development-close.mjs
node --check tooling/scripts/local-dev/completion-review.mjs
node --check tooling/scripts/local-dev/workflow-kernel.mjs
node --check tooling/scripts/local-dev/workflow-host-adapters.mjs
node --check tooling/scripts/local-dev/workflow-snapshot.mjs
node --check tooling/scripts/local-dev/workflow-doctor.mjs
node --check tooling/scripts/local-dev/development-flow-residue.mjs
node --check tooling/scripts/plan/planctl.mjs
python3 -m py_compile \
  tooling/scripts/acceptance-run.py \
  tooling/scripts/acceptance-gap-detect.py \
  tooling/scripts/agent-integration-control.py \
  tooling/scripts/agent-integration-audit.py

node tooling/scripts/local-dev/development-flow-residue.mjs --repo-root .
node tooling/scripts/architecture/module-governance.mjs validate

freshness_file='tooling/skills/pt-github-review/FRESHNESS.md'
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

[[ ${#covered_docs[@]} -gt 0 ]] \
  || fail "$freshness_file has no covered_docs list"
for doc in "${covered_docs[@]}"; do
  [[ -e "$doc" ]] || fail "$freshness_file references missing upstream doc: $doc"
done

expected_hash="$(awk -F': *' '/^covered_docs_hash:/ {print $2; exit}' "$freshness_file")"
[[ -n "$expected_hash" ]] || fail "$freshness_file missing covered_docs_hash"
if command -v shasum >/dev/null 2>&1; then
  hash_command=(shasum -a 256)
elif command -v sha256sum >/dev/null 2>&1; then
  hash_command=(sha256sum)
else
  fail "neither shasum nor sha256sum is available"
fi
actual_hash="$(
  for doc in "${covered_docs[@]}"; do
    if [[ -f "$doc" ]]; then
      printf '### %s\n' "$doc"
      cat "$doc"
    else
      find "$doc" -type f -name '*.md' ! -path '*/execution-plans/*' \
        | LC_ALL=C sort \
        | while IFS= read -r nested; do
            printf '### %s\n' "$nested"
            cat "$nested"
          done
    fi
  done | "${hash_command[@]}" | awk '{print $1}'
)"
[[ "$actual_hash" == "$expected_hash" ]] \
  || fail "upstream review rules drifted: expected $expected_hash but got $actual_hash"

fixtures_dir='tooling/review-fixtures'
[[ -d "$fixtures_dir" ]] || fail "missing fixtures directory: $fixtures_dir"
fixture_count="$(find "$fixtures_dir" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
[[ "$fixture_count" -ge 6 ]] \
  || fail "expected at least 6 review fixtures, found $fixture_count"

while IFS= read -r expected; do
  fixture="$(dirname "$expected")"
  grep -Eq '^expected_code:' "$expected" \
    || fail "$expected missing expected_code"
  grep -Eq '^expected_severity:' "$expected" \
    || fail "$expected missing expected_severity"
  expected_code="$(awk -F': *' '/^expected_code:/ {print $2; exit}' "$expected")"
  grep -qi "$expected_code" tooling/skills/pt-github-review/SKILL.md \
    || fail "$fixture expected code '$expected_code' is absent from review policy"
  fixture_output="$(tooling/scripts/review/hard-rules.sh --fixture-dir "$fixture" 2>&1 || true)"
  grep -q "$expected_code" <<< "$fixture_output" \
    || fail "$fixture did not trigger '$expected_code'"
done < <(find "$fixtures_dir" -name expected.yml | sort)

for growth in "$fixtures_dir"/growth-*/growth.yml; do
  for field in scenario expected_growth_decision expected_asset proof; do
    grep -Eq "^${field}:" "$growth" || fail "$growth missing $field"
  done
  decision="$(awk -F': *' '/^expected_growth_decision:/ {print $2; exit}' "$growth")"
  case "$decision" in
    acceptance_contract|hard_rule|knowledge_pitfall|skill_update) ;;
    *) fail "$growth has unknown growth decision: $decision" ;;
  esac
  grep -q "$decision" tooling/skills/pt-github-review/SKILL.md \
    || fail "$growth decision '$decision' is absent from review policy"
done

node tooling/skills/pt-code-structure-review/scripts/validate-fixtures.mjs
node --test tooling/skills/pt-code-structure-review/scripts/structure-signals.test.mjs
python3 tooling/scripts/review/code_structure_decision_test.py

if rg -n \
  'ignore (previous|all) instructions|you are now|system:\s*override|curl .*\| *sh|rm -rf /' \
  tooling/skills/pt-github-review/SKILL.md "$freshness_file"; then
  fail "review Skill contains a dangerous instruction"
fi

printf 'skill-check: PASS\n'
