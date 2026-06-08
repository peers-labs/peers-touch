# GitHub Review Skill Freshness

status: active
owner: architecture
last_verified_at: 2026-06-07
covered_docs_hash: 4184da79daab6acb040ec6300a8a0c209344f08379c730814fb2ac883f3e7295

covered_docs:
  - AGENTS.md
  - docs/README.md
  - docs/global/code-review-framework.md
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
