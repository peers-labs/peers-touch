#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: check-frontend-runtime-registry.sh [--range <git-range>] [--strict]

Checks the Frontend Runtime registry for required lifecycle/evidence fields.
Default diff-range mode warns when UI runtime files change without registry updates.
Use --strict to make that diff-range warning blocking.
USAGE
}

diff_range=""
strict=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --range)
      diff_range="${2:?missing --range value}"
      shift 2
      ;;
    --strict)
      strict=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "frontend runtime registry: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

registry="docs/client/common/ui-identity/frontend-component-tree-registry.md"

required_files=(
  "$registry"
  "docs/architecture/frontend-runtime/README.md"
  "docs/architecture/frontend-runtime/data-model.md"
  "apps/desktop/src/kernel/frontendRuntimeProfiler.ts"
  "apps/desktop/src/kernel/SectionHost.tsx"
  "apps/desktop/src/applet/AppletContainerShell.tsx"
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "frontend runtime registry: missing required file: $file" >&2
    exit 1
  fi
done

required_headers=(
  "Feature / Surface"
  "Owner Layer"
  "Alive Category"
  "Cache Policy"
  "Runtime / Store Owner"
  "Status"
  "Evidence"
  "Review Owner"
)

for header in "${required_headers[@]}"; do
  if ! grep -Fq "$header" "$registry"; then
    echo "frontend runtime registry: missing header: $header" >&2
    exit 1
  fi
done

awk '
function trim(value) {
  gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
  return value
}

function has_allowed_alive(value) {
  return value ~ /`eager \+ forever`|`idle \+ forever`|`on-visit \+ lru`|`on-visit \+ none`|`lazy section`|`virtualized content`/
}

BEGIN {
  fail = 0
}

/^\|/ {
  if ($0 ~ /^\|[[:space:]-]+\|/) next
  n = split($0, cols, "|")
  if (n < 11) next

  feature = trim(cols[2])
  if (feature == "Feature / Surface") next

  owner = trim(cols[3])
  alive = trim(cols[4])
  trigger = trim(cols[5])
  cache = trim(cols[6])
  runtime = trim(cols[7])
  status = trim(cols[8])
  evidence = trim(cols[9])
  review_owner = trim(cols[10])

  if (feature == "" || owner == "" || trigger == "" || cache == "" || runtime == "" || status == "" || evidence == "" || review_owner == "") {
    printf("frontend runtime registry: row has empty required field: %s\n", $0) > "/dev/stderr"
    fail = 1
  }

  if (!has_allowed_alive(alive)) {
    printf("frontend runtime registry: invalid alive category for %s: %s\n", feature, alive) > "/dev/stderr"
    fail = 1
  }

  if (status !~ /^(alive|lazy|lru|not alive|needs audit|deprecated)$/) {
    printf("frontend runtime registry: invalid status for %s: %s\n", feature, status) > "/dev/stderr"
    fail = 1
  }

  if (status == "needs audit" && review_owner == "") {
    printf("frontend runtime registry: needs audit row missing review owner: %s\n", feature) > "/dev/stderr"
    fail = 1
  }

  if (status == "needs audit" && evidence !~ /audit|verify|Target|not yet|unproven|needs|must|should/) {
    printf("frontend runtime registry: needs audit row lacks revisit/evidence wording: %s\n", feature) > "/dev/stderr"
    fail = 1
  }
}

END {
  exit fail
}
' "$registry"

if [[ -n "$diff_range" ]]; then
  if ! changed="$(git diff --name-only "$diff_range" --)"; then
    echo "frontend runtime registry: invalid or unreadable git range: $diff_range" >&2
    exit 1
  fi
  changed="$(printf '%s\n%s\n' "$changed" "$(git ls-files --others --exclude-standard)" | sed '/^$/d' | sort -u)"
  if rg -q '^(apps/desktop/src/(kernel|pages|components/settings|applet|runtimes|services)/|apps/mobile/src/)' <<< "$changed"; then
    if ! rg -q '^docs/client/common/ui-identity/frontend-component-tree-registry\.md$|^docs/architecture/frontend-runtime/' <<< "$changed"; then
      message="frontend runtime registry: UI runtime files changed without registry/runtime architecture doc update"
      if [[ "$strict" -eq 1 ]]; then
        echo "$message" >&2
        exit 1
      fi
      echo "warning: $message" >&2
    fi
  fi
fi

echo "Frontend runtime registry OK."
