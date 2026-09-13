# Local Dev Control Plane - Architecture Decisions

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-13 | **Updated**: 2026-09-13
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/`

---

## Decision Index

| ID | Decision | Status |
|----|----------|--------|
| LDCP-D01 | Use `~/.peers-touch/dev/` as machine control-plane root | accepted |
| LDCP-D02 | Key worktree bindings by canonical `workspaceId` | accepted |
| LDCP-D03 | Separate environment definition from machine allocation | accepted |
| LDCP-D04 | Allocate local slots per workspace, not per profile | accepted |
| LDCP-D05 | Split Station connect, deploy, and reset capabilities | accepted |
| LDCP-D06 | Bootstrap with a non-authoritative observed snapshot | accepted |
| LDCP-D07 | Place Acceptance Evidence under the machine Dev root | accepted |
| LDCP-D08 | Registration is explicit and activity is runtime-derived | accepted |
| LDCP-D09 | Require human authorization for environment creation | accepted |

## LDCP-D01: Machine Control-Plane Root

**Status**: accepted
**Date**: 2026-09-13

### Context

The machine has no global development configuration owner. Existing worktrees
hold private `.local` directories despite documentation claiming a shared root.
`~/.peers-touch` already exists as the Peers Touch user-level data root.

### Decision

Create `~/.peers-touch/dev/` as the machine-global development control-plane
root.

### Rationale

It is user-scoped, outside every worktree, survives branch/worktree deletion,
and does not require choosing one repository clone as the machine owner.

### Alternatives Considered

- `~/Library/Application Support/PeersTouch/acceptance`: rejected because the
  Application Support namespace is reserved for formal product data.
- A primary worktree `.local`: rejected because deleting or switching that
  worktree would remove the machine authority.
- The `env` repository: rejected because environment topology is reviewable
  source, while worktree/process allocation is machine-local mutable state.

### Consequences

The root needs one platform resolver and explicit separation from product data.

## LDCP-D02: Canonical Workspace Identity

**Status**: accepted
**Date**: 2026-09-13

### Decision

Bind profile and slot by `workspaceId = sha256(realpath(root))[0:16]`.

### Rationale

Worktree basename and branch are mutable and non-unique. Canonical path identity
matches existing worktree and Acceptance isolation conventions.

### Consequences

Moving a worktree creates a new machine identity and requires explicit
re-registration. The old record remains stale until cleaned.

## LDCP-D03: Definition And Allocation Separation

**Status**: accepted
**Date**: 2026-09-13

### Decision

The sibling `env` repository owns deployable topology definitions.
`~/.peers-touch/dev/` owns local worktree bindings, slot allocation, leases and
observed runtime state.

### Rationale

Environment definitions are shared and reviewable; machine allocations are
mutable and private to one developer machine.

### Consequences

Commands must resolve both sources and reject dirty/untracked definitions for
deployment authority.

## LDCP-D04: Workspace-Owned Local Slot

**Status**: accepted
**Date**: 2026-09-13

### Context

Profiles currently carry `PT_DEV_SLOT`, and several distinct profiles reuse the
same slot. A remote Station profile and local client port allocation are
independent concerns.

### Decision

Allocate slot per workspace in the machine registry. Treat profile
`PT_DEV_SLOT` as legacy migration metadata only.

### Rationale

Two worktrees may connect to the same Station while requiring different local
Desktop/Mobile ports.

### Consequences

Port computation moves behind machine binding resolution. Existing profile
files must eventually stop declaring authoritative slots.

## LDCP-D05: Station Capability Classes

**Status**: accepted
**Date**: 2026-09-13

### Decision

Represent Station use as:

- shared `station.connect`;
- exclusive `station.deploy`;
- exclusive `station.reset`.

### Rationale

Connecting a client is not equivalent to replacing Station source or
destructively resetting fixtures. One generic profile lock cannot express the
risk boundary.

### Consequences

Deployment and reset commands require stronger leases and explicit owner
identity. Read-only client work may share a Station safely.

## LDCP-D06: Diagnostic Bootstrap

**Status**: accepted
**Date**: 2026-09-13

### Context

The current machine state must be inventoried before architecture implementation
or migration.

### Decision

Create `~/.peers-touch/dev/registry.json` with
`authority: observed-snapshot`. Existing runtime scripts do not read it.

### Rationale

This gives one visible ledger immediately without changing active profile,
process, deploy, or reset behavior before architecture review.

### Consequences

The snapshot can become stale and must not authorize runtime actions. Promotion
to authority requires a reviewed implementation and atomic migration.

## LDCP-D07: Acceptance Evidence Belongs To Dev Control

**Status**: accepted
**Date**: 2026-09-13

### Context

D-11 correctly moved runtime evidence outside the repository, but selected
`~/Library/Application Support/PeersTouch/acceptance` on macOS. That separates
evidence from source while still placing development artifacts inside the
formal product namespace.

### Decision

The local developer default becomes:

```text
~/.peers-touch/dev/acceptance
```

The old Application Support path is a legacy migration source only.

### Rationale

Acceptance evidence is generated by development, CI, and validation workflows.
It belongs beside machine-level development registry and leases, while retaining
its own immutable child namespace and lifecycle.

### Alternatives Considered

- Keep the Application Support path: rejected because it pollutes product data
  ownership and makes product cleanup/accounting ambiguous.
- Use `~/.peers-touch/acceptance`: rejected because it does not identify the
  data as part of the development control plane.
- Create a separate `~/.peers-touch-acceptance`: rejected because it creates a
  second machine-level development root.
- Symlink the old product path to the new root: rejected because path
  ownership, cleanup, and resolver behavior remain split.

### Consequences

- The Evidence Store resolver default and platform tests must change.
- Existing evidence must be moved and verified before the old root is removed.
- `PT_ACCEPTANCE_ARTIFACT_ROOT` remains available for CI and isolated tests.
- Machine-global leases remain independent of artifact-root override.
- No dual-read, dual-write, fallback, or compatibility symlink is permitted.
- Every current Git worktree must prove the canonical resolver contract before
  cutover or be removed from the Git worktree registry.
- The migration state, legacy-root registry fields, and active migration
  instructions are deleted after closure; `legacy-removed` is not a permanent
  runtime state.
- Only a closed ADR and an inert completion receipt retain historical context.

## LDCP-D08: Explicit Registration And Derived Activity

**Status**: accepted
**Date**: 2026-09-13

### Context

`git worktree list` exposes every retained worktree, including abandoned,
detached, experimental, and inactive paths. Existing profile pointers may also
be stale. Treating either source as registration or activity overstates actual
environment use.

### Decision

Only an explicit Owner-approved registration enrolls a worktree in the machine
control plane. Activity is derived from a matching live process/listener or
lease identity.

### Rationale

Discovery answers what exists. Registration answers what is managed. Activity
answers what currently consumes resources. They are different facts and must
not share one status field.

### Alternatives Considered

- Register every Git worktree: rejected because retained worktrees are not
  evidence of current ownership or intended environment use.
- Treat an active profile pointer as active use: rejected because pointers
  survive after processes and tasks stop.
- Use repository `active_work`: rejected because project delivery status is
  not machine runtime allocation evidence.
- Use filesystem mtime or recent commit date: rejected because both are
  indirect and nondeterministic.

### Consequences

- The initial cohort must be supplied by the Owner.
- Unregistered observations cannot acquire managed slots or Station mutation
  capabilities.
- A registered worktree with no live resource is reported as `idle`.
- Migration audits may inspect every Git worktree without registering it.

## LDCP-D09: Human-Authorized Environment Creation

**Status**: accepted
**Date**: 2026-09-13

### Context

Agent workflows could previously interpret a missing profile as permission to
run `make profile-init`, create an `env/peers-touch/<name>/` definition, or
retain a local-only `.local` fallback. That silently created topology and
destructive-operation authority outside developer review.

### Decision

An AI agent may inspect or select an existing approved environment, but may not
create, copy, derive, or register a profile or deploy environment without
explicit human developer approval for the exact environment name and target.
Missing topology fails closed and is reported as a blocker.

For machine-local compose profiles, approval is represented by a short-lived
machine grant bound to the exact `workspaceId + profile + mode + slot` tuple.
`profile-init` consumes it once and stores a receipt bound to the generated
profile digest. The grant command is human-only; an Agent may not mint approval.

### Rationale

An environment definition controls hosts, ports, databases, compose projects,
deployment, restart, and reset behavior. Creating one is an infrastructure
ownership decision, not an implementation convenience.

### Alternatives Considered

- Let agents create distinctly named environments: rejected because a unique
  name does not prove host ownership or operational approval.
- Allow local-only profiles: rejected because they bypass the reviewable env
  repository and create hidden machine state.
- Infer approval from an Acceptance plan or available host: rejected because
  neither grants topology mutation authority.

### Consequences

- `make profile-authorize` is human-only and requires interactive exact-tuple
  confirmation.
- `make profile-init` fails without a matching unexpired grant and never
  overwrites an existing profile.
- Untracked env-repository definitions and unauthorized local definitions
  cannot authorize selection, deployment, restart, or reset.
- Agent workflows stop and report the missing environment instead of creating
  one.
