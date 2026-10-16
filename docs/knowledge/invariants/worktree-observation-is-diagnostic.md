---
kind: invariant
title: Worktree observation is diagnostic, never authority
status: active
owns:
  - tooling/plugins/pt-ew-plugin/
  - tooling/scripts/local-dev/worktree-observation-store.mjs
  - tooling/scripts/local-dev/worktree-observe.mjs
  - tooling/make/local-dev.mk
referenced-by:
  - docs/architecture/engineering/local-dev/decisions.md
related:
  - docs/knowledge/invariants/workspace-active-work-is-local.md
  - docs/knowledge/invariants/conversation-bound-workflow-kernel.md
detected: 2026-09-23
---

# Worktree observation is diagnostic, never authority

## What must hold

Each worktree may write only
`~/.peers-touch/dev/workspaces/<workspaceId>/observations/worktree.json`, where
`workspaceId` is derived from its own canonical root. Observation may describe
branch, HEAD, dirty state, reporter event, and report time.

Observation and `git worktree list` discovery MUST NOT register a workspace,
allocate profile/slot, assert runtime activity, grant authorization, select a
Plan, advance a Session, rewrite active-work, or count as Acceptance evidence.

Workflow Snapshot is a read-only union projection. Current Git discovery owns the row's
branch and HEAD. Registration, declaration, active-work, observation, and
snapshot check times remain separate clocks.

## Why this is non-negotiable

A shared report table would recreate cross-workspace write contention.
Treating recent telemetry as authority would let an IDE hook acquire resources
or hide stale workflow state. Separating push freshness from pull
reconciliation provides visibility without changing control-plane ownership.

## How to verify

- `node --test tooling/scripts/local-dev/worktree-observation-store.test.mjs`
  proves disjoint workspace paths, atomic records, monotonic time, and corrupt
  record isolation.
- `node --test tooling/scripts/local-dev/workflow-snapshot.test.mjs` proves
  stale Owner identity cannot override Git branch/HEAD.
- Public snapshot tests assert canonical roots never appear.
- `rg -n 'reportWorktreeObservation' tooling/plugins/pt-ew-plugin
  tooling/scripts/local-dev` finds only the reporter and thin hook adapter.

## Crosswalks

- LDCP-D08 separates discovery, registration, and runtime activity.
- LDCP-D19 retires the browser dashboard and keeps the CLI projection read-only.
- LDCP-D15 combines opportunity reports with periodic reconciliation.
