#!/usr/bin/env bash
set -euo pipefail

dirs=("$@")
if [ ${#dirs[@]} -eq 0 ]; then
  dirs=("station/app" "station/frame/core" "station/domain")
fi

single_return_regex='^[[:space:]]*func[^{]+\{[[:space:]]*return[^}]*[[:space:]]*\}$'
violations=0

# Ensure golangci-lint available
if ! command -v golangci-lint >/dev/null 2>&1; then
  go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest || true
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

check_file() {
  local file="$1"
  local skip_doc=0
  [[ "$file" == *"/pkg/"* || "$file" == *"/peers/config/"* ]] && skip_doc=1

  # 1) 禁止单行 return 函数体
  if grep -nE "$single_return_regex" "$file" >/dev/null; then
    echo "$file"
    grep -nE "$single_return_regex" "$file"
    violations=$((violations+1))
  fi

  # 2) 函数之间必须有空行（检测顶层的 `}` 后紧跟非空行）
  awk -v f="$file" '
    BEGIN { prev=""; line=0 }
    { line++; cur=$0 }
    {
      if (prev ~ /^}$/ && cur !~ /^[[:space:]]*$/) {
        # 立即下一行不是空行，疑似函数间缺少空行
        print f ":" line ":missing blank line after top-level }";
        exit_code=1;
      }
      prev=cur;
    }
    END { if (exit_code==1) exit 3 }
  ' "$file" || violations=$((violations+1))

  # 3) 导出函数必须有文档注释（上一非空行需是 // 注释）
  if [ "$skip_doc" -eq 0 ]; then
  awk -v f="$file" '
    function trim(s){ sub(/^\s+/,"",s); sub(/\s+$/,"",s); return s }
    BEGIN { prev_nonempty=""; line=0; err=0 }
    {
      line++;
      cur=$0;
      t=trim(cur);

      if (cur ~ /^func[[:space:]]+[A-Z][A-Za-z0-9_]*\(/ || cur ~ /^func[[:space:]]+\([^)]*\)[[:space:]]+[A-Z][A-Za-z0-9_]*\(/) {
        if (prev_nonempty !~ /^\/\//) {
          print f ":" line ":missing doc comment above exported function";
          err=1;
        }
      }

      if (t != "") prev_nonempty=t;
    }
    END { if (err==1) exit 4 }
  ' "$file" || violations=$((violations+1))
  fi
}

for d in "${dirs[@]}"; do
  [ -d "$d" ] || continue
  while IFS= read -r file; do
    check_file "$file"
  done < <(find "$d" -type f -name '*.go' \
    -not -path '*/logrus/*' \
    -not -path '*/lumberjack.v2/*' \
    -not -path '*/touch/activitypub/*')
done

# Run golangci-lint within each module under target dirs if available
run_lint() {
  local ran=0
  for d in "${dirs[@]}"; do
    [ -d "$d" ] || continue
    while IFS= read -r moddir; do
      ran=1
      ( cd "$moddir" && golangci-lint run \
        --skip-dirs ".*/logrus/.*" \
        --skip-dirs ".*/lumberjack\\.v2/.*" \
        --skip-dirs ".*/touch/activitypub/.*" \
        --skip-files ".*_test\\.go$" \
        --config "$repo_root/.golangci.yml" ) || return 1
    done < <(find "$d" -type f -name 'go.mod' -print0 | xargs -0 -n1 dirname | sort -u)
  done
  # If no modules found and repo root has go.mod, try at repo root
  if [ "$ran" -eq 0 ] && command -v golangci-lint >/dev/null 2>&1 && [ -f "$repo_root/go.mod" ]; then
    golangci-lint run \
      --skip-dirs ".*/logrus/.*" \
      --skip-dirs ".*/lumberjack\\.v2/.*" \
      --skip-dirs ".*/touch/activitypub/.*" \
      --skip-files ".*_test\\.go$" \
      --config "$repo_root/.golangci.yml" || return 1
  fi
  return 0
}

if command -v golangci-lint >/dev/null 2>&1; then
  run_lint || violations=$((violations+1))
fi

if [ "$violations" -gt 0 ]; then
  exit 1
fi

echo "OK"
