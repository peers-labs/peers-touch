#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: knowledge-match.sh [--range <git-range>] [--changed-file <path> ...] [--strict]

Lists docs/knowledge entries whose frontmatter owns changed paths.
With --strict, also validates knowledge frontmatter and active owns paths.
USAGE
}

diff_range="HEAD"
strict=0
manual_files=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --range)
      diff_range="${2:?missing --range value}"
      shift 2
      ;;
    --changed-file)
      manual_files+=("${2:?missing --changed-file value}")
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
      echo "knowledge-match: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

tmp_changed="$(mktemp)"
tmp_owns="$(mktemp)"
trap 'rm -f "$tmp_changed" "$tmp_owns"' EXIT

if [[ ${#manual_files[@]} -gt 0 ]]; then
  printf '%s\n' "${manual_files[@]}" > "$tmp_changed"
else
  if ! git diff --name-only "$diff_range" -- > "$tmp_changed"; then
    echo "knowledge-match: invalid or unreadable git range: $diff_range" >&2
    exit 1
  fi
  if [[ ! -s "$tmp_changed" ]]; then
    git diff --name-only --cached -- > "$tmp_changed"
  fi
  git ls-files --others --exclude-standard >> "$tmp_changed"
  sort -u "$tmp_changed" -o "$tmp_changed"
fi

knowledge_files="$(find docs/knowledge/invariants docs/knowledge/pitfalls docs/knowledge/playbooks -type f -name '*.md' 2>/dev/null | sort)"

validate_entry() {
  local file="$1"
  local content
  content="$(sed -n '1,80p' "$file")"

  for field in kind title status owns detected; do
    if ! grep -Eq "^${field}:" <<< "$content"; then
      echo "[knowledge-schema] $file missing frontmatter field: $field"
      return 1
    fi
  done

  local kind
  kind="$(awk -F': *' '/^kind:/ {print $2; exit}' "$file")"
  case "$kind" in
    invariant)
      grep -qi 'How to verify' "$file" || {
        echo "[knowledge-freshness] $file invariant missing How to verify"
        return 1
      }
      ;;
    pitfall)
      grep -Eqi 'detect.*recurrence|recurrence.*detect|How to detect' "$file" || {
        echo "[knowledge-freshness] $file pitfall missing recurrence detection"
        return 1
      }
      ;;
    playbook)
      grep -Eq '(^- \[ \]|^## Steps|^## [0-9]+\.|^### [0-9]+\.)' "$file" || {
        echo "[knowledge-freshness] $file playbook missing checklist or ordered procedure"
        return 1
      }
      ;;
    *)
      echo "[knowledge-schema] $file has invalid kind: $kind"
      return 1
      ;;
  esac
}

extract_owns() {
  local file="$1"
  awk '
    BEGIN { in_front=0; in_owns=0 }
    NR == 1 && $0 == "---" { in_front=1; next }
    in_front && $0 == "---" { exit }
    in_front && /^owns:/ { in_owns=1; next }
    in_front && /^[A-Za-z_-]+:/ { in_owns=0 }
    in_front && in_owns && /^[[:space:]]*-[[:space:]]*/ {
      line=$0
      sub(/^[[:space:]]*-[[:space:]]*/, "", line)
      print line
    }
  ' "$file"
}

failures=0
matches=0

while IFS= read -r knowledge_file; do
  [[ -z "$knowledge_file" ]] && continue
  if [[ "$strict" -eq 1 ]]; then
    if ! validate_entry "$knowledge_file"; then
      failures=$((failures + 1))
    fi
  fi

  while IFS= read -r owns_path; do
    [[ -z "$owns_path" ]] && continue
    normalized_owns="${owns_path%/}"
    if [[ "$strict" -eq 1 ]]; then
      if [[ ! -e "$owns_path" && ! -d "$normalized_owns" ]]; then
        case "$owns_path" in
          */)
            echo "[knowledge-owns] $knowledge_file owns missing directory: $owns_path"
            failures=$((failures + 1))
            ;;
          *)
            if ! compgen -G "$owns_path*" >/dev/null; then
              echo "[knowledge-owns] $knowledge_file owns missing path or prefix: $owns_path"
              failures=$((failures + 1))
            fi
            ;;
        esac
      fi
    fi

    while IFS= read -r changed; do
      [[ -z "$changed" ]] && continue
      case "$changed" in
        "$normalized_owns"|"$normalized_owns"/*)
          if [[ "$matches" -eq 0 ]]; then
            echo "Matched operational knowledge:"
          fi
          echo "- $knowledge_file owns $owns_path and matches $changed"
          matches=$((matches + 1))
          ;;
      esac
    done < "$tmp_changed"
  done < <(extract_owns "$knowledge_file")
done <<< "$knowledge_files"

if [[ "$matches" -eq 0 ]]; then
  echo "Matched operational knowledge: none"
fi

if [[ "$failures" -gt 0 ]]; then
  echo "knowledge-match: $failures freshness issue(s)" >&2
  exit 1
fi

echo "knowledge-match: pass"
