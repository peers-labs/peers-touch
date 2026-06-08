#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

skill_file="tooling/skills/github-review/SKILL.md"
freshness_file="tooling/skills/github-review/FRESHNESS.md"
fixtures_dir="tooling/review-fixtures"

failures=0

fail() {
  failures=$((failures + 1))
  printf '[skill-check] %s\n' "$1"
}

require_file() {
  [[ -f "$1" ]] || fail "missing required file: $1"
}

require_file "$skill_file"
require_file "$freshness_file"

required_sections=(
  "Review Philosophy"
  "Review Workflow"
  "Review Profiles"
  "Script vs Skill Boundary"
  "Platform Review Playbooks"
  "Hard Rules"
  "Operational Knowledge"
  "Skill Freshness"
  "Self-Growth"
  "Severity Levels"
  "Review Output Format"
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

for rule in "${required_rules[@]}"; do
  if ! grep -qi "$rule" "$skill_file"; then
    fail "$skill_file missing required rule reference: $rule"
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
