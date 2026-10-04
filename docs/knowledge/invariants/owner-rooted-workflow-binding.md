---
kind: invariant
title: Workflow authority is rooted in one owner binding
status: active
owns:
  - tooling/plugins/pt-ew-plugin/
  - tooling/scripts/agent-integration-control.py
  - tooling/scripts/agent-integration-audit.py
  - tooling/scripts/install-agent-integration.sh
  - tooling/scripts/local-dev/workflow-*.mjs
  - tooling/make/setup.mk
referenced-by:
  - docs/architecture/development-workflow/decisions.md
related:
  - docs/knowledge/invariants/host-neutral-agent-execution.md
  - docs/knowledge/invariants/workspace-active-work-is-local.md
  - docs/knowledge/invariants/worktree-observation-is-diagnostic.md
detected: 2026-10-01
---

# Workflow authority is rooted in one owner binding

## What must hold

One visible development chat creates exactly one immutable OWNER binding.
TRAE derives that root only from `chat_session_id`; an internal `session_id`
never creates peer owner authority. Cursor and Codex use only their documented
host-specific root fields. Missing root identity is `OBSERVE_ONLY`; aliases and
process-global identity fallbacks are forbidden.

WORKER and REVIEWER sessions exist only through a create-once assignment that
records role, root and parent binding digests, Development Session identity,
operation identity, and lease. Assignment creation validates the exact current
active-work and Development Session records. Child claim atomically publishes
one assignment-keyed owner record before the child binding; only its winning
execution-session hash may retry or use the assignment. Child liveness comes
from assignment, lease, and terminal receipts. OWNER liveness never comes from
a generic TTL.

Every hook, Action Receipt, status, readiness, handoff, Stop, worker result,
and Completion Review consumes one canonical `BindingProjection`. The
projection includes role, lineage, binding/release state, immutable
`executionRoot`, and per-event subject/tool/target roots.

Cross-worktree reads remain allowed. Every lineage member may write only
inside the OWNER execution root and the active declaration's source claims.
Dynamic or unparseable shell structure fails closed.

Completion Review selects the exact OWNER or assigned REVIEWER from the
latest receipt for the current owner-command action ID. A FINISHED receipt
invalidates earlier STARTED and HEARTBEAT receipts. It never enumerates every
unreleased binding for a worktree and never treats stale child history as
ownership. Schema-v2 requests and receipts use only
`completion-reviews-v2`; the pre-hard-cut namespace is not read or migrated.

`PreCompact` writes one bounded receipt keyed by the current binding digest.
`PostCompact` must re-resolve that exact binding, root, parent, assignment,
Development Session, workspace, and execution root before context is restored.
Concurrent OWNER, WORKER, and REVIEWER compactions never share a receipt slot.

TRAE multi-root installations expose one descriptor-selected workspace
bootstrap. Its location is not an authority hint. The first mutating tool event
must name one declared task root or have all mutation targets resolve to one
workspace root; otherwise it fails with `WORKTREE_SELECTION_REQUIRED`.
Managed per-worktree hook entries are not parallel authorities.
Rollout atomically replaces the current integration after proving no child
assignment, workflow action, or Action Store lock is in flight. A live
Development declaration is not execution liveness and does not block the
replacement. Prior conversation and workflow-action stores are deleted only
when declarations are quiescent; otherwise they remain inert until a later
declaration-free installation. No legacy reader, importer, alias, or dual
writer is allowed.
The sole live OWNER `skills` action is admissible only with its create-once
Kernel grant, which the installer atomically consumes exactly once. A
declaration-free installation requires that grant because it deletes legacy
state. A concurrent installation that preserves legacy state may bootstrap
with zero live actions when an old integration cannot issue the grant; any
other live action remains a blocker. Fallible path/workspace/catalog planning
completes before grant consumption. After authorization, the installer
immediately persists `INSTALLING` before replacement and records `BLOCKED` if
the operation fails.

## Why this is non-negotiable

A host execution session is not a user authorization boundary. Treating
reviewer, retry, or subtask IDs as peer owners creates permanent false locks
when those sessions end without an owner release.

Identity must be explicit and role-aware. Liveness is meaningful only for
bounded children; a top-level development conversation must not silently lose
authority because a timer elapsed.

## How to verify

- `node --test tooling/scripts/local-dev/workflow-*.test.mjs
  tooling/plugins/pt-ew-plugin/scripts/hook-entry.test.mjs` passes.
- TRAE accepts `chat_session_id`, never `session_id` alone as OWNER identity.
- One OWNER plus WORKER and REVIEWER children retain exact root/parent lineage.
- Concurrent execution sessions cannot claim the same assignment.
- Assignment creation rejects a missing or non-current Development Session.
- Interrupted and concurrent OWNER publication leaves one valid immutable file.
- Expired and terminal children are excluded from current projections.
- Twenty stale child records do not block exact Completion Review resolution.
- A FINISHED review action cannot authorize work through an older receipt.
- Pre-hard-cut Completion Review records cannot block current status or review.
- Compact restoration fails when any persisted lineage field differs.
- Concurrent lineage compactions preserve independent receipts.
- A missing, seeded, or already-consumed installer action has no rollout
  authority for declaration-free legacy cleanup.
- A live declaration plus zero live actions permits only the non-destructive
  replacement path and preserves legacy stores.
- Failed destructive reset leaves a `BLOCKED` installation receipt.
- BeforePrompt injects role, lineage, release, execution, subject, tool, and
  target roots; wrong-binding status/final claims fail closed.
- Sibling-worktree reads pass and writes fail with
  `CROSS_WORKTREE_WRITE_DENIED`.
- The active multi-root workspace contains exactly one managed TRAE bootstrap.
- Active-editor mismatch and explicit New Task target fixtures bind the
  selected worktree or fail `WORKTREE_SELECTION_REQUIRED`; folder order never
  decides authority.
- Declaration-free rollout removes the old conversation/action stores;
  concurrent-declaration rollout preserves them as inert history. Tree-wide
  search finds no runtime import of `workflow-conversation-binding.mjs`.

## Crosswalks

- DWF-D21 keeps project execution semantics independent of host transport.
- DWF-D22 keeps mutable workflow owner state in each consuming worktree.
- DWF-D33 defines OWNER/child lineage, exact claim selection, and hard-cut
  rollout.
