#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: hard-rules.sh [--range <git-range>] [--fixture-dir <dir>]

Runs blocking Peers-Touch hard-rule checks against changed files.
Use --fixture-dir to scan a fixture tree instead of git diff files.
USAGE
}

diff_range="HEAD"
fixture_dir=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --range)
      diff_range="${2:?missing --range value}"
      shift 2
      ;;
    --fixture-dir)
      fixture_dir="${2:?missing --fixture-dir value}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "hard-rules: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

tmp_files="$(mktemp)"
trap 'rm -f "$tmp_files"' EXIT

if [[ -n "$fixture_dir" ]]; then
  find "$fixture_dir" -type f | sed "s#^\./##" > "$tmp_files"
else
  git diff --name-only "$diff_range" -- > "$tmp_files" || true
  if [[ ! -s "$tmp_files" ]]; then
    git diff --name-only --cached -- > "$tmp_files" || true
  fi
  git ls-files --others --exclude-standard >> "$tmp_files"
  sort -u "$tmp_files" -o "$tmp_files"
fi

failures=0

report_failure() {
  local code="$1"
  local message="$2"
  failures=$((failures + 1))
  printf '[%s] %s\n' "$code" "$message"
}

is_source_file() {
  case "$1" in
    *.go|*.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.rs|*.kt|*.kts|*.swift|*.java|*.sh) return 0 ;;
    *) return 1 ;;
  esac
}

is_ui_file() {
  case "$1" in
    apps/desktop/src/*.tsx|apps/desktop/src/**/*.tsx|apps/mobile/src/*.tsx|apps/mobile/src/**/*.tsx|packages/ui/**/*.tsx|*/apps/desktop/src/*.tsx|*/apps/desktop/src/**/*.tsx|*/apps/mobile/src/*.tsx|*/apps/mobile/src/**/*.tsx|*/packages/ui/**/*.tsx) return 0 ;;
    *) return 1 ;;
  esac
}

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  [[ ! -f "$file" ]] && continue
  if [[ -z "$fixture_dir" ]]; then
    case "$file" in
      tooling/review-fixtures/*|tooling/scripts/review/*|tooling/skills/*) continue ;;
    esac
  fi

  case "$file" in
    *.pb.go|*.pb.dart|*.pb.rs|*/gen/proto/*|*/src/gen/proto/*)
      report_failure "generated-file-edit" "$file appears to be generated; update proto source and regenerate instead"
      ;;
  esac

  if is_source_file "$file"; then
    if rg -n 'console\.log|fmt\.Println|println!|debugPrint|(^|[^[:alnum:]_])print\(' "$file" >/tmp/pt-review-match.$$ 2>/dev/null; then
      while IFS= read -r line; do
        report_failure "debug-statement" "$file:$line"
      done < /tmp/pt-review-match.$$
      rm -f /tmp/pt-review-match.$$
    fi

    if rg -n 'catch\s*\([^)]*\)\s*\{\s*\}|if\s+err\s*!=\s*nil\s*\{\s*return\s*\}|_\s*=\s*err' "$file" >/tmp/pt-review-match.$$ 2>/dev/null; then
      while IFS= read -r line; do
        report_failure "silent-error" "$file:$line"
      done < /tmp/pt-review-match.$$
      rm -f /tmp/pt-review-match.$$
    fi

    if rg -n '(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9]{32,}|api[_-]?key\s*[:=]\s*["'\''][^"'\'']+|secret\s*[:=]\s*["'\''][^"'\'']+|password\s*[:=]\s*["'\''][^"'\'']+)' "$file" >/tmp/pt-review-match.$$ 2>/dev/null; then
      while IFS= read -r line; do
        report_failure "secret-exposure" "$file:$line"
      done < /tmp/pt-review-match.$$
      rm -f /tmp/pt-review-match.$$
    fi
  fi

  case "$file" in
    apps/desktop/src/**|apps/mobile/src/**|packages/**|*/apps/desktop/src/**|*/apps/mobile/src/**|*/packages/**)
      if rg -n '(mock[A-Z_]|Mock[A-Z_]|mockData|fake[A-Z_]|fixture[A-Z_]).*(api|Api|station|Station|backend|Backend)' "$file" >/tmp/pt-review-match.$$ 2>/dev/null; then
        while IFS= read -r line; do
          report_failure "mock-api" "$file:$line"
        done < /tmp/pt-review-match.$$
        rm -f /tmp/pt-review-match.$$
      fi
      ;;
  esac

  if is_ui_file "$file"; then
    if rg -n '<[^>]*>[[:space:]]*[A-Za-z\u4e00-\u9fff][^<{]*[[:space:]]*</|title=["'\''][A-Za-z\u4e00-\u9fff]|placeholder=["'\''][A-Za-z\u4e00-\u9fff]' "$file" >/tmp/pt-review-match.$$ 2>/dev/null; then
      while IFS= read -r line; do
        report_failure "hardcoded-ui-string" "$file:$line"
      done < /tmp/pt-review-match.$$
      rm -f /tmp/pt-review-match.$$
    fi
  fi
done < "$tmp_files"

rm -f /tmp/pt-review-match.$$

if [[ "$failures" -gt 0 ]]; then
  echo "hard-rules: $failures blocking finding(s)" >&2
  exit 1
fi

echo "hard-rules: pass"
