#!/usr/bin/env bash
set -euo pipefail

script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# The launcher keeps argument/exit semantics; one implementation owns matching.
# Git paths remain unquoted through `git -c core.quotePath=false` in that owner.
exec "${PT_ACCEPTANCE_PYTHON:-python3}" "$script_root/knowledge_match.py" "$@"
