#!/usr/bin/env bash
set -euo pipefail

# Enforces the client-contract documentation review cadence defined in
# docs/client/common/ui-identity/README.md ("Doc metadata and review cadence").
#
# Every in-scope contract document carries YAML frontmatter:
#   status: active | draft | superseded-by:<path>
#   owner: <team>
#   updated: YYYY-MM-DD
#   review-cadence: quarterly | semiannual | annual | on-change
#   next-review: YYYY-MM-DD   (required unless cadence is on-change)
#
# A document whose next-review date has passed is stale and must be
# re-read, corrected if it has drifted, and have its metadata bumped.

usage() {
  cat <<'USAGE'
Usage: doc-review-cadence.sh [--warn-only] [--as-of YYYY-MM-DD]

Exits non-zero when an in-scope contract document is missing required
frontmatter, has an invalid cadence/date, or is past its next-review date.
--warn-only prints findings but exits zero (for advisory runs).
USAGE
}

warn_only=0
as_of="$(date +%F)"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --warn-only) warn_only=1; shift ;;
    --as-of) as_of="${2:?missing --as-of value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "doc-review-cadence: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

docs=()
while IFS= read -r f; do docs+=("$f"); done < <(
  {
    find docs/client/common/ui-identity -type f -name '*.md' 2>/dev/null
    find docs/client/common -maxdepth 1 -type f -name '*.md' 2>/dev/null
  } | sort -u
)

valid_cadence='^(quarterly|semiannual|annual|on-change)$'
valid_date='^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
failures=0
stale=0

front_field() {
  # $1 file, $2 field — reads only the leading YAML frontmatter block.
  awk -v key="$2" '
    NR==1 && $0=="---" { infront=1; next }
    infront && $0=="---" { exit }
    infront {
      line=$0
      if (line ~ "^"key":") {
        sub("^"key":[[:space:]]*", "", line)
        print line
        exit
      }
    }
  ' "$1"
}

for doc in "${docs[@]}"; do
  [[ -f "$doc" ]] || continue

  if [[ "$(head -n1 "$doc")" != "---" ]]; then
    echo "[doc-metadata] $doc missing YAML frontmatter"
    failures=$((failures + 1))
    continue
  fi

  status="$(front_field "$doc" status)"
  owner="$(front_field "$doc" owner)"
  updated="$(front_field "$doc" updated)"
  cadence="$(front_field "$doc" review-cadence)"
  next_review="$(front_field "$doc" next-review)"

  [[ -n "$status" ]]   || { echo "[doc-metadata] $doc missing 'status'"; failures=$((failures + 1)); }
  [[ -n "$owner" ]]    || { echo "[doc-metadata] $doc missing 'owner'"; failures=$((failures + 1)); }

  if [[ -z "$updated" || ! "$updated" =~ $valid_date ]]; then
    echo "[doc-metadata] $doc missing valid 'updated' (YYYY-MM-DD)"
    failures=$((failures + 1))
  fi

  if [[ -z "$cadence" || ! "$cadence" =~ $valid_cadence ]]; then
    echo "[doc-metadata] $doc missing valid 'review-cadence' (quarterly|semiannual|annual|on-change)"
    failures=$((failures + 1))
    continue
  fi

  # Superseded documents are historical and not on a review cycle.
  [[ "$status" == superseded-by:* ]] && continue

  if [[ "$cadence" == "on-change" ]]; then
    continue
  fi

  if [[ -z "$next_review" || ! "$next_review" =~ $valid_date ]]; then
    echo "[doc-metadata] $doc cadence '$cadence' requires a valid 'next-review' date"
    failures=$((failures + 1))
    continue
  fi

  if [[ -n "$updated" && "$updated" =~ $valid_date && "$next_review" < "$updated" ]]; then
    echo "[doc-metadata] $doc next-review ($next_review) predates updated ($updated)"
    failures=$((failures + 1))
  fi

  if [[ "$next_review" < "$as_of" ]]; then
    echo "[doc-stale] $doc past review date $next_review (cadence: $cadence)"
    stale=$((stale + 1))
    failures=$((failures + 1))
  fi
done

if [[ $failures -gt 0 ]]; then
  echo "doc-review-cadence: $failures issue(s) across ${#docs[@]} contract docs (${stale} stale)" >&2
  if [[ $warn_only -eq 1 ]]; then
    exit 0
  fi
  exit 1
fi

echo "doc-review-cadence: pass (${#docs[@]} contract docs, none past review)"
