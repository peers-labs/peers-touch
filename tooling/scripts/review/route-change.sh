#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: route-change.sh [--range <git-range>] [--changed-file <path>] [--format text|github]

Maps changed files to Peers-Touch review profiles.
Default range: HEAD (staged + unstaged + committed diff against HEAD).
Use --changed-file for deterministic routing checks without a git diff.
USAGE
}

diff_range="HEAD"
format="text"
changed_file_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --range)
      diff_range="${2:?missing --range value}"
      shift 2
      ;;
    --changed-file)
      changed_file_args+=("${2:?missing --changed-file value}")
      shift 2
      ;;
    --format)
      format="${2:?missing --format value}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "route-change: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$format" in
  text|github) ;;
  *)
    echo "route-change: invalid format: $format" >&2
    usage >&2
    exit 2
    ;;
esac

repo_root="$(git rev-parse --show-toplevel)"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_classifier="$script_dir/../../skills/pt-code-structure-review/scripts/structure-signals.mjs"
cd "$repo_root"

if [[ ${#changed_file_args[@]} -gt 0 ]]; then
  changed_files="$(printf '%s\n' "${changed_file_args[@]}" | sed '/^$/d' | sort -u)"
else
  if ! changed_files="$(git diff --name-only "$diff_range" --)"; then
    echo "route-change: invalid or unreadable git range: $diff_range" >&2
    exit 1
  fi
  if [[ -z "$changed_files" && "$diff_range" == "HEAD" ]]; then
    changed_files="$(git diff --name-only --cached --)"
  fi
  if [[ "$diff_range" == "HEAD" ]]; then
    untracked_files="$(git ls-files --others --exclude-standard)"
    changed_files="$(printf '%s\n%s\n' "$changed_files" "$untracked_files" | sed '/^$/d' | sort -u)"
  else
    changed_files="$(printf '%s\n' "$changed_files" | sed '/^$/d' | sort -u)"
  fi
fi
changed_files="$(
  printf '%s\n' "$changed_files" |
    sed -E 's#^(\./)+##' |
    sed '/^$/d' |
    sort -u
)"
if rg -q '(^|/)\.\.(/|$)|^/' <<< "$changed_files"; then
  echo "route-change: changed files must be repository-relative paths" >&2
  exit 2
fi

tmp_profiles="$(mktemp)"
trap 'rm -f "$tmp_profiles"' EXIT

add_profile() {
  local profile="$1"
  local reason="$2"
  printf '%s|%s\n' "$profile" "$reason" >> "$tmp_profiles"
}

reviewable_source_files="$(
  printf '%s\n' "$changed_files" |
    node "$source_classifier" --classify-stdin
)"

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  if [[ -n "$reviewable_source_files" ]] &&
    rg -F -x -q -- "$file" <<< "$reviewable_source_files"; then
    add_profile "code-structure" "$file changes authored source structure"
  fi
  case "$file" in
    model/domain/*)
      add_profile "proto" "$file changes shared proto contracts"
      ;;
    apps/station/*)
      add_profile "station" "$file changes Station business or frame code"
      ;;
    apps/desktop/*)
      add_profile "desktop" "$file changes Desktop app, web, or Tauri runtime"
      ;;
    apps/mobile/*)
      add_profile "mobile" "$file changes Mobile Tauri/Web/native code"
      ;;
    packages/locales/*)
      add_profile "locales" "$file changes locale data"
      add_profile "packages" "$file changes workspace package content"
      ;;
    packages/*)
      add_profile "packages" "$file changes shared packages"
      ;;
    docs/knowledge/*)
      add_profile "knowledge" "$file changes operational knowledge"
      ;;
    tooling/scripts/quality-evidence.py)
      add_profile "acceptance" "$file changes product acceptance evidence aggregation"
      add_profile "review-system" "$file changes review framework infrastructure"
      add_profile "skill" "$file affects review skill verification"
      ;;
    tooling/acceptance/*|tooling/scripts/acceptance-*.py|tooling/make/acceptance.mk|docs/architecture/acceptance-framework/*)
      add_profile "acceptance" "$file changes product acceptance framework"
      ;;
    tooling/skills/*)
      add_profile "skill" "$file changes agent skill content"
      ;;
    tooling/scripts/review/*|tooling/review-fixtures/*|docs/global/code-review-framework.md)
      add_profile "review-system" "$file changes review framework infrastructure"
      add_profile "skill" "$file affects review skill verification"
      ;;
    .github/*)
      add_profile "ci" "$file changes GitHub review or CI automation"
      ;;
    docs/*)
      add_profile "docs" "$file changes project documentation"
      ;;
  esac
done <<< "$changed_files"

if [[ ! -s "$tmp_profiles" ]]; then
  add_profile "general" "no specialized profile matched"
fi

commands_for_profile() {
  case "$1" in
    proto) echo "./model/build.sh" ;;
    station) echo "cd apps/station/app && gofmt -l . && go test ./..." ;;
    desktop) echo "cd apps/desktop && pnpm run check && pnpm run test && pnpm run build" ;;
    mobile) echo "pnpm mobile:check" ;;
    packages) echo "pnpm -r --if-present run check" ;;
    knowledge) echo "tooling/scripts/review/knowledge-match.sh --range ${diff_range}" ;;
    acceptance) echo "make acceptance-validate && make acceptance-coverage-report && make acceptance-plan ACCEPTANCE_RANGE=${diff_range}" ;;
    skill) echo "tooling/scripts/review/skill-check.sh" ;;
    review-system) echo "tooling/scripts/review/run.sh --range ${diff_range}" ;;
    code-structure) echo "prepare pt-code-structure-review --range ${diff_range}; review the prepared scope; record findings with the same selector" ;;
    ci) echo "review workflow syntax check in GitHub Actions" ;;
    locales) echo "verify UI callers use locale keys and package checks pass" ;;
    docs) echo "verify docs source hierarchy and links" ;;
    general) echo "run relevant package or platform checks" ;;
  esac
}

if [[ "$format" == "github" ]]; then
  echo "## Review Profiles"
else
  echo "Review profiles for range: $diff_range"
fi

cut -d'|' -f1 "$tmp_profiles" | sort -u | while IFS= read -r profile; do
  echo
  echo "[$profile]"
  awk -F'|' -v p="$profile" '$1 == p { print "  - " $2 }' "$tmp_profiles"
  echo "  required: $(commands_for_profile "$profile")"
done
