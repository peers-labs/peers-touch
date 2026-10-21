# Local Dev Control Plane - Decisions

> **Status**: active
> **Version**: v2.0
> **Updated**: 2026-10-21
> **Owner**: Platform Team

## Decision Index

| ID | Decision | Status |
|---|---|---|
| LDCP-D01 | Use one machine development root | accepted |
| LDCP-D02 | Identify worktrees by canonical path | accepted |
| LDCP-D03 | Separate topology from machine allocation | accepted |
| LDCP-D04 | Allocate local slots per workspace | accepted |
| LDCP-D05 | Split Station capabilities | accepted |
| LDCP-D06 | Keep diagnostic bootstrap non-authoritative | accepted |
| LDCP-D07 | Keep Acceptance evidence under the dev root | accepted |
| LDCP-D08 | Make registration explicit and activity observed | accepted |
| LDCP-D13 | Separate task progress from environment health | accepted |
| LDCP-D16 | Let Profile selection bootstrap registration | accepted |
| LDCP-D17 | Separate durable binding from current Git HEAD | accepted |
| LDCP-D19 | Keep workflow status read-only and non-resident | accepted |
| LDCP-D21 | Let reviewed Profiles authorize bounded operations | accepted |

## LDCP-D01: One Machine Development Root

**Status**: accepted
**Date**: 2026-09-13

### Context

Worktree-local state cannot coordinate allocation shared by several worktrees.
Product data roots must not become development storage.

### Decision

Machine-local allocation and runtime coordination live under
`~/.peers-touch/dev/`.

### Rationale

The root is user-scoped, survives worktree deletion, and is independent of
product data.

### Alternatives Considered

A primary worktree, the environment repository, and product Application
Support were rejected because each has the wrong lifecycle or owner.

### Consequences

One platform resolver owns the logical root and its registry, lease, runtime,
debug, and Acceptance child namespaces.

## LDCP-D02: Canonical Workspace Identity

**Status**: accepted
**Date**: 2026-09-13

### Context

Worktree names and branches can change or collide.

### Decision

`workspaceId` is the first 16 hex characters of the SHA-256 digest of the
canonical worktree path.

### Rationale

Canonical path identifies the actual machine workspace without relying on
mutable labels.

### Alternatives Considered

Branch, basename, and editor workspace order were rejected as non-unique.

### Consequences

Moving a worktree creates a new identity and requires explicit registration.

## LDCP-D03: Topology And Allocation Are Separate

**Status**: accepted
**Date**: 2026-09-13

### Context

Reviewed topology and one machine's mutable allocation have different review
and lifecycle boundaries.

### Decision

The environment repository or private local Profile owns topology. The machine
registry owns worktree binding, slot, and capabilities.

### Rationale

Shared source should not contain private machine occupancy.

### Alternatives Considered

Storing worktree allocation in the Profile or environment repository was
rejected.

### Consequences

Runtime resolves both sources and rejects missing, ambiguous, or dirty remote
topology.

## LDCP-D04: Workspace-Owned Local Slot

**Status**: accepted
**Date**: 2026-09-13

### Context

Different worktrees may use the same remote Profile while needing isolated
local ports.

### Decision

The registry allocates one slot per workspace. Profile slot values are
bootstrap defaults only.

### Rationale

Port isolation is a machine allocation concern, not remote topology.

### Alternatives Considered

Profile-owned slots were rejected because they collide across worktrees.

### Consequences

Effective Station and client ports are derived from the registered slot.

## LDCP-D05: Station Capability Classes

**Status**: accepted
**Date**: 2026-09-13

### Context

Connecting, deploying, and resetting have different risk and exclusivity.

### Decision

Use separate `station.connect`, `station.deploy`, and `station.reset`
capabilities.

### Rationale

Read-only client use should not gain mutation authority or serialize behind a
generic Station lock.

### Alternatives Considered

One Station permission and one generic lock were rejected.

### Consequences

Deploy and reset require normalized targets, explicit capabilities, and
exclusive leases.

## LDCP-D06: Non-Authoritative Diagnostic Bootstrap

**Status**: accepted
**Date**: 2026-09-13

### Context

A machine inventory is useful before a workspace is enrolled, but observations
may be stale or incomplete.

### Decision

Inventory may use `authority: observed-snapshot`. Runtime requires
`authority: machine-control-plane`.

### Rationale

Visibility should not silently create permission or allocation.

### Alternatives Considered

Promoting the first scan directly to authority was rejected.

### Consequences

Only explicit registration or Profile selection can create authoritative
machine state.

## LDCP-D07: Acceptance Evidence Uses The Dev Root

**Status**: accepted
**Date**: 2026-09-13

### Context

Acceptance artifacts are development evidence, not formal product data.

### Decision

Local evidence defaults to `~/.peers-touch/dev/acceptance/`.

### Rationale

The location preserves source-tree and product-data boundaries while keeping
machine development state together.

### Alternatives Considered

Repository paths, product Application Support, a sibling machine root, and a
compatibility symlink were rejected.

### Consequences

CI may override the artifact root. Evidence remains separate from registry,
leases, and runtime state.

## LDCP-D08: Explicit Registration And Observed Activity

**Status**: accepted
**Date**: 2026-09-13

### Context

Git discovery, Profile files, and editor activity do not prove intended
resource ownership.

### Decision

Only Profile selection or `env-register` enrolls a workspace. Activity is
derived from binding validity and live OS-held leases.

### Rationale

Discovery, registration, and live resource use answer different questions.

### Alternatives Considered

Automatic Git worktree enrollment, pointer-based activity, task state, and
mtime were rejected.

### Consequences

Status distinguishes active, idle, stale, and unregistered observations.

## LDCP-D13: Task Progress Is Not Environment Health

**Status**: accepted
**Date**: 2026-09-17

### Context

Work progress and machine runtime state have different owners and failure
semantics.

### Decision

Development Workflow owns optional task progress. Local Dev owns binding,
capabilities, and leases. Read-only projections may display both without
joining their authority.

### Rationale

A corrupt or missing task record must not block a healthy environment, and a
healthy environment must not imply task completion.

### Alternatives Considered

Embedding task state in the registry or deriving runtime permission from task
progress was rejected.

### Consequences

Status reports preserve unknown, unverified, and unavailable states by owner.

## LDCP-D16: Profile Selection Bootstraps Registration

**Status**: accepted
**Date**: 2026-09-28

### Context

Requiring every contributor to learn low-level registration fields before
selecting a Profile made first use unnecessarily complex.

### Decision

`make profile <name>` registers an unbound canonical worktree, allocates the
lowest free slot, and grants the Profile's minimum capabilities.

### Rationale

Explicit selection is sufficient intent for the normal safe binding.

### Alternatives Considered

A mandatory separate `env-register` step and ambient auto-registration were
rejected.

### Consequences

`env-register` remains available for advanced explicit allocation. Reset is
never granted by first selection.

## LDCP-D17: Binding Is Stable, Source Is Live

**Status**: accepted
**Date**: 2026-09-28

### Context

Persisting Git HEAD made every normal commit, pull, merge, or rebase stale the
workspace registration.

### Decision

The registry stores canonical root and registered branch but not HEAD. Every
operation reads current source and lease admission revalidates it after lock.

### Rationale

Workspace identity and advancing source identity change independently.

### Alternatives Considered

Command-specific HEAD refresh, ignoring stale stored HEAD, and compatibility
schemas were rejected.

### Consequences

Same-branch source changes need no registry write. Root or branch drift still
fails closed.

## LDCP-D19: Workflow Status Is Read-Only

**Status**: accepted
**Date**: 2026-10-04

### Context

A machine-wide browser service and fixed port added runtime conflict to a
read-only status question.

### Decision

Workflow status is a one-shot CLI or library projection. It starts no server,
browser, listener, or lease and writes no state.

### Rationale

A projection does not justify a resident product or another authority.

### Alternatives Considered

A dynamic-port dashboard, optional fixed service, and Desktop embedding were
rejected.

### Consequences

Development Workflow owns the projection contract even when implementation
files share the local-dev script directory.

## LDCP-D21: Reviewed Profiles Authorize Bounded Operations

**Status**: accepted
**Date**: 2026-10-15

### Context

Duplicate human receipts repeated authority already expressed by reviewed
Profile topology and binding capabilities.

### Decision

A reviewed Profile plus the binding authorizes covered development operations.
Local Profile bootstrap is allowed. Reset protection comes only from a
case-insensitive terminal `stable` suffix.

### Rationale

One visible Profile contract avoids policy split while capabilities, source
identity, exact scope, and leases retain operational safety.

### Alternatives Considered

A second control-mode field, per-operation chat approval, substring matching,
and universal reset were rejected.

### Consequences

Stable selection grants connect only; stable reset always fails. Non-stable
reset still requires explicit capability, exact scope, current source,
reviewed topology, and lease.
