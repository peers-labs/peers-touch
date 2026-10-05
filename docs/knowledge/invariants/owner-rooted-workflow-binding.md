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
  - docs/architecture/engineering/development-workflow/decisions.md
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

Every hook, Action Receipt, status, readiness, handoff, Stop, and worker result
consumes one canonical `BindingProjection`. The projection includes role,
lineage, binding/release state, immutable `executionRoot`, and per-event
subject/tool/target roots.

Cross-worktree reads remain allowed. Every lineage member may write only
inside the OWNER execution root and the active declaration's source claims.
Dynamic or unparseable shell structure fails closed.

Completion Review is outside the IDE write-authorization boundary. Under
DWF-D37 it binds immutable review requests to successful Development Session
contexts and delegates through a repository-native reviewer capability. It
does not consume Workflow Bindings or Action Receipts. Schema-v3 records use
only `completion-reviews-v3`; earlier namespaces are not read or migrated.

`PreCompact` writes one bounded receipt keyed by the current binding digest.
`PostCompact` must re-resolve that exact binding, root, parent, assignment,
Development Session, workspace, and execution root before context is restored.
Concurrent OWNER, WORKER, and REVIEWER compactions never share a receipt slot.

TRAE multi-root installations expose equivalent canonical Hook entries in the
selected source root, descriptor bootstrap root, and descriptor roots with an
existing real `.trae` directory. Their locations are not authority hints, and
the entries are not parallel authorities. They dispatch to the same selected
source integration and one host-neutral Kernel. The first mutating tool event
must name one declared task root or have all mutation targets resolve to one
workspace root; otherwise it fails with `WORKTREE_SELECTION_REQUIRED`.
Descriptor roots without `.trae` remain untouched.
Projection and cleanup are separate actions. Ordinary `skills` consumes one
machine-lock-serialized, strictly validated projection path and does not
depend on a grant from the Hook it installs. It may update the selected host
projection while unrelated worktrees remain active and never deletes workflow
state.
`skills-hard-cut` is the only legacy conversation/action-store reset owner, and
`skills-gc` is the only retired-projection cleanup owner. Each consumes its own
exact create-once OWNER grant and proves global idle before deletion. No legacy
reader, importer, alias, or dual writer is allowed. Fallible
path/workspace/catalog planning completes before grant consumption. After
consumption, each command persists its operation state and records `BLOCKED`
if its bounded mutation fails.

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
- Twenty stale child records cannot affect Completion Review preparation or
  submission.
- Pre-hard-cut Completion Review records cannot block current status or review.
- Compact restoration fails when any persisted lineage field differs.
- Concurrent lineage compactions preserve independent receipts.
- A missing, seeded, wrong-label, or already-consumed control action has no
  projection or cleanup authority.
- Ordinary install succeeds without a Hook-issued grant while an unrelated
  declaration remains active and does not remove legacy stores.
- Hard cut and GC reject unrelated live work and leave a `BLOCKED` operation
  receipt on failure.
- BeforePrompt injects role, lineage, release, execution, subject, tool, and
  target roots; wrong-binding status/final claims fail closed.
- Sibling-worktree reads pass and writes fail with
  `CROSS_WORKTREE_WRITE_DENIED`.
- Every participating root in the active multi-root workspace contains exactly
  one managed TRAE Hook per supported event; untouched roots remain untouched.
- Active-editor mismatch and explicit New Task target fixtures bind the
  selected worktree or fail `WORKTREE_SELECTION_REQUIRED`; folder order never
  decides authority.
- Explicit hard cut removes the old conversation/action stores; ordinary
  install does not. Tree-wide search finds no runtime import of
  `workflow-conversation-binding.mjs`.

## Crosswalks

- DWF-D21 keeps project execution semantics independent of host transport.
- DWF-D22 keeps mutable workflow owner state in each consuming worktree.
- DWF-D33 defines OWNER/child lineage, exact claim selection, and hard-cut
  rollout.
- DWF-D35 defines participating-root Hook projection without multiplying owner
  authority.
- DWF-D36 removes the ordinary projection's circular Hook-grant dependency
  while preserving exact grants for destructive cleanup.
- DWF-D37 removes Completion Review from host binding authorization while
  preserving request-scoped delegated assessment provenance; independent
  reviewer launch remains a Dev Workflow obligation.
