---
kind: invariant
title: Worktree observation is diagnostic, never authority
status: active
owns:
  - tooling/plugins/pt-ew-plugin/
  - tooling/scripts/local-dev/worktree-observation-store.mjs
  - tooling/scripts/local-dev/skill-invocation-store.mjs
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

Each worktree is the sole writer of its own observation files under its
gitignored local state directory:

```text
<worktree-root>/.dev-workflow/observations/worktree.json
<worktree-root>/.dev-workflow/observations/worktree.lock
<worktree-root>/.dev-workflow/observations/skill-events.jsonl
```

The worktree never pushes observations into the machine control plane
(`~/.peers-touch/dev/`). Observation may describe branch, HEAD, dirty state,
reporter event, report time, and verbatim tool/skill invocation traces.

Cross-worktree visibility is a read-only pull. Collectors enumerate worktree
roots from explicit caller-supplied roots or the machine registry
(`registeredCanonicalRoots`) and read each worktree's local files; they never
write back, and one unresolvable root or corrupt record is isolated into an
error list instead of masking healthy worktrees.

The Hook installed in one worktree reports only events resolved to that same
installation root. It never writes an observation for a sibling worktree, and
an ambiguous multi-root event produces no observation.

Observation and `git worktree list` discovery MUST NOT register a workspace,
allocate profile/slot, assert runtime activity, grant authorization, select a
Plan or task, update task progress, or count as Acceptance evidence.

Workflow Snapshot is a read-only projection. Current Git owns branch and HEAD.
Registration, observation, optional task progress, and snapshot check times
remain separate clocks.

## Why this is non-negotiable

Host hook subprocesses run inside a filesystem sandbox that only guarantees
writes within the executing worktree; a machine-central push path fails
deterministically for command-execution tool hooks. Keeping observation files
worktree-local makes every write stay inside the sandbox boundary while the
unsandboxed CLI tooling retains machine-wide visibility through pulling.

A shared report table would recreate cross-worktree write contention.
Treating recent telemetry as authority would let an IDE hook acquire resources
or hide stale workflow state. Separating local writes from pull
reconciliation provides visibility without changing control-plane ownership.

## How to verify

- `node --test tooling/scripts/local-dev/worktree-observation-store.test.mjs`
  proves disjoint worktree-local records, atomic writes, monotonic time,
  pull-based collection, and corrupt record isolation.
- `node --test tooling/scripts/local-dev/skill-invocation-store.test.mjs`
  proves worktree-local append-only traces and cross-worktree collection with
  workspaceId attribution.
- `node --test tooling/scripts/local-dev/workflow-snapshot.test.mjs` proves
  stale observations cannot override Git branch/HEAD.
- `rg -n 'reportWorktreeObservation' tooling/plugins/pt-ew-plugin
  tooling/scripts/local-dev` finds only the reporter and thin hook adapter.
- Multi-root Hook tests prove sibling-root and ambiguous events leave the
  observation reporter untouched.

## Crosswalks

- LDCP-D08 separates discovery, registration, and runtime activity.
- LDCP-D19 retires the browser dashboard and keeps the CLI projection read-only.
- LDCP-D15 combines opportunity reports with periodic reconciliation.
