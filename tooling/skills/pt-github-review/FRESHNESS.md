# GitHub Review Skill Freshness

status: active
owner: architecture
last_verified_at: 2026-08-30
covered_docs_hash: 4b225df0490da847920c86477896f8de6afb5cce819a3e900aae3e7ed1619424

covered_docs:
  - AGENTS.md
  - docs/README.md
  - docs/global/code-review-framework.md
  - docs/architecture/quality-framework
  - docs/architecture/acceptance-framework
  - docs/global/architecture.md
  - docs/client/desktop/base.md
  - docs/client/desktop/runtime-projections.md
  - docs/client/mobile/base.md
  - docs/station/base.md
  - docs/global/coding-guide/common
  - docs/global/coding-guide/desktop
  - docs/global/coding-guide/mobile
  - docs/global/coding-guide/station
  - docs/knowledge/README.md

## Freshness Contract

`tooling/scripts/review/skill-check.sh` recomputes `covered_docs_hash` from the paths above. If any upstream rule changes, the hash changes and the check fails until this skill is reviewed.

Updating this file is a review act, not bookkeeping. The PR must explain whether the upstream change required a `SKILL.md` update, new fixture, or knowledge entry.

The 2026-08-29 refresh covers execution-status and evidence updates under the
Acceptance framework. It does not change review behavior, so no `SKILL.md`
change or additional review fixture is required.

The 2026-08-30 refresh covers the exact-source Native Desktop evidence rules
and Mobile OAuth foundation merged through PRs #100 and #101. The corresponding
runtime identity requirements are present in `pt-github-review/SKILL.md`; no
additional review fixture is required.
