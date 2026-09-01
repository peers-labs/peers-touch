# GitHub Review Skill Freshness

status: active
owner: architecture
last_verified_at: 2026-08-29
covered_docs_hash: 224378519df36821ec75cb94bca5d78a31e6864a6f4c2e5feb898e7059ae64d3

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
## 2026-08-29 Review

`AGENTS.md` added the fail-closed Execution Worktree Binding contract. Local
review target establishment now verifies that persisted binding and stops on
identity drift. No fixture or knowledge entry is required because the
executable verifier and its dedicated contract tests own deterministic
coverage.

The Mobile agent-entry link cleanup removes developer-home absolute paths
without changing review behavior.
