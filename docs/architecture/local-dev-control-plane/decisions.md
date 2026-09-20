# Local Dev Control Plane - Architecture Decisions

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-09-13 | **Updated**: 2026-09-18
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
| LDCP-D10 | Declare Agent control mode in each profile | accepted |
| LDCP-D11 | Provide one read-only Development Control Plane dashboard | accepted |
| LDCP-D12 | Run one machine-wide Peers Dev application | accepted |
| LDCP-D13 | Project Plan progress separately from environment health | accepted |
| LDCP-D14 | Reserve immutable workspace Plan ownership under the machine Dev root | accepted |

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

## LDCP-D10: Profile-Declared Agent Control

**Status**: accepted
**Date**: 2026-09-17

### Context

The current model knows a workspace's allowed Station capabilities but does not
say whether a reviewed profile is intended for autonomous Agent operation.
Agents therefore repeatedly ask for profile selection, registration, deploy,
restart, or reset approval even when the environment was created specifically
for automated development.

### Decision

Every profile must declare:

```env
PT_AGENT_CONTROL_MODE=human-gated|managed|disposable
```

- `human-gated` requires human approval for binding changes and Station
  mutation.
- `managed` authorizes Agent registration, binding, deploy, restart and cleanup
  within the existing declaration/capability/lease envelope.
- `disposable` additionally authorizes exact-scope reset when the work
  declaration, workspace capability and reset lease all agree.

The field is a maximum policy. It never grants a lease, expands a declaration,
creates topology, supplies credentials, authorizes history rewrite, or bypasses
source identity.

### Rationale

One reviewed profile policy is safer and less disruptive than repeating
operation-by-operation prompts that do not change the underlying authority.

### Alternatives Considered

- A boolean `agentManaged`: rejected because it cannot distinguish deploy from
  destructive reset.
- Infer policy from profile names such as `disposable`: rejected because names
  are not authority.
- Keep all operations human-gated: rejected because it makes long-running
  development non-progressing administrative work.

### Consequences

- Every profile must be updated atomically; missing mode fails closed.
- Skills may proceed without repeated prompts only within the declared mode.
- Changing a profile's control mode remains a reviewed human action.

## LDCP-D11: Read-Only Development Control Plane Dashboard

**Status**: accepted
**Date**: 2026-09-17

### Context

Environment topology, machine registrations, development declarations and
leases are separately queryable. There is no single view showing which
requirements and Journeys each worktree is executing together with the
profiles, slots, Stations, Relays, databases, fixtures and leases they use.

### Decision

Add a lightweight application under `apps/dev/`. Its server joins redacted
profile definitions with registry, declaration and live lease projections and
serves the Peers Dev UI locally.

The primary projection is worktree-centric: one row groups a workspace's active
requirements and Journeys with its declared and held runtime resources. Profile
occupancy remains a secondary capacity view. Unregistered declaration owners
remain visible by `workspaceId` and branch instead of being silently dropped.

The dashboard is read-only and has no mutation controls.

### Rationale

Operators and Agents need one current development picture without making the
env repository or UI a second workflow or allocation authority.

### Alternatives Considered

- Store occupancy in the env repository: rejected because occupancy is
  machine-local mutable state.
- Build a separate worktree/project board: rejected because it would split
  delivery intent and runtime-resource truth into two operator surfaces.
- Build a full management application: rejected as unnecessary for the current
  operational need.
- Show only `registry.json`: rejected because it omits work intent, live leases
  and profile trust/policy.

### Consequences

- The dashboard can disappear without affecting runtime authority.
- Status generation must redact secrets by selecting fields, not by returning
  raw profile contents.
- Runtime claims may identify Relay and database intent for visibility, but
  adding those claim kinds does not create lease or mutation authority.
- Any future write action requires a separate accepted control-plane decision.

## LDCP-D12: One Machine-Wide Peers Dev Application

**Status**: accepted
**Date**: 2026-09-17

### Context

Every worktree contains the same launch command. Without a machine-wide
exclusivity contract, concurrent starts can create duplicate servers, bind
different ports, or silently replace the source instance that other worktrees
are observing.

### Decision

Peers Dev has one fixed endpoint: `http://127.0.0.1:4177`. The operating
system's exclusive TCP listener is the live ownership authority.

`make dev-ui` follows one idempotent ensure protocol:

1. Probe `GET /api/server`.
2. If a compatible Peers Dev server responds, report its source identity and
   exit successfully without starting another process.
3. If no listener exists, bind `127.0.0.1:4177`.
4. If a concurrent start wins the bind race, re-probe and accept only a
   compatible Peers Dev identity.
5. If any unrelated or incompatible listener owns the port, fail with
   `DEV_SERVER_PORT_CONFLICT`.

The server projects `workspaceId`, branch, source HEAD, and whether the serving
worktree is dirty, but never its canonical filesystem root or changed paths.
There is no host or port override in the public launcher.

### Rationale

TCP bind exclusivity is kernel-enforced, atomic and tied to the real process
lifetime. It cannot become stale like PID or lock metadata. The identity probe
makes repeat launches idempotent while rejecting unrelated listeners.

### Alternatives Considered

- PID or lock file: rejected because stale metadata cannot prove a live owner.
- One port per worktree: rejected because it creates multiple competing
  management surfaces.
- Kill and replace the existing process: rejected because a worktree must not
  steal machine-global ownership implicitly.
- Dynamic fallback ports: rejected because they violate the single-entry-point
  contract.

### Consequences

- The first compatible process owns the server until it exits.
- Other worktrees reuse that process and can see which source identity owns it.
- Switching the serving source requires an explicit stop followed by a start.
- `apps/dev/` is the only app implementation; the env-repository UI and
  tooling-local server are deleted in the same cutover.

## LDCP-D13: Plan-Aware Work And Independent Environment Health

**Status**: accepted
**Date**: 2026-09-17

### Context

Peers Dev currently filters the ledger to live declarations, shows no Plan
progress, and derives one worktree state from registration, profile, slot,
declaration, and lease conditions. An expired heartbeat can make in-progress
work disappear, while an unreviewed profile can label valid source execution as
blocked.

### Decision

Peers Dev projects two independent dimensions:

- `workState`: declaration lifecycle plus resolved Plan/Task lifecycle;
- `environmentHealth`: registration, profile, slot, lease, and source-identity
  diagnostics.

Active declarations are primary. The newest stale declaration for a work item
remains visible as historical operational state but never authorizes mutation
or possession. Tracked declarations resolve their repository-relative
`planPath` under the registered canonical root and use the canonical Plan
Package parser. Missing, legacy, invalid, mismatched, or inaccessible plans are
typed progress states.

The public snapshot selects safe fields and never returns a canonical root or
absolute Plan path.

### Rationale

Task progress and environment readiness answer different questions. Collapsing
them loses causal information: dirty topology can block deployment without
making source work fail, and an expired declaration can be an observability
problem without erasing the task.

### Alternatives Considered

- Keep one aggregate `blocked` state: rejected because it misclassifies task
  execution and hides the actionable environment cause.
- Hide stale declarations: rejected because heartbeat failure then removes
  active work from the operator surface.
- Parse legacy Markdown heuristically: rejected because it creates a second
  plan model and unreviewable percentages.

### Consequences

- The dashboard displays task progress and environment warnings together but
  does not merge their semantics.
- Stale work is visible and clearly non-live.
- Legacy or unsynchronized worktrees remain visible with typed unavailable
  progress until they adopt the declaration and Plan Package contracts.

## LDCP-D14: Reserve Immutable Workspace Plan Ownership Under The Machine Dev Root

**Status**: accepted
**Date**: 2026-09-18

### Context

Profile/slot registration and Development declarations are mutable for valid
operational reasons, while Plan ownership must not change when another
worktree's commits are synchronized into the same repository or PR branch.

### Decision

Development Workflow owns one immutable
`workspaces/<workspaceId>/workflow/plan-binding.json` record under the machine
Dev root. Local Dev supplies the workspace-scoped namespace but does not infer,
replace, or mutate the Plan binding. Profile, slot, capability, branch and HEAD
refreshes leave it unchanged.

### Rationale

The machine Dev root is the only workspace-keyed state namespace shared across
all synchronized source versions. Keeping Plan ownership separate from the
mutable environment registry preserves both concerns' lifecycle.

### Alternatives Considered

- Add Plan fields to the environment registration: rejected because profile and
  source refreshes are mutable and must not gain Plan-rebind semantics.
- Store the binding in the repository: rejected because synchronized files are
  shared content, not machine workspace identity.

### Consequences

- Removing a worktree's machine state is the only way to retire its Plan
  binding; no normal command rebinding path exists.
- Local Dev status may project the binding but cannot use it as environment or
  runtime authority.
