# Local Dev Control Plane - Module Layout

> **Status**: active
> **Version**: v2.1
> **Updated**: 2026-11-15
> **Owner**: Platform Team

## Directory Tree

```text
tooling/scripts/local-dev/
├── machine-dev-registry.mjs
├── machine-dev-lease.py
├── machine-dev.mjs
├── machine-dev-resource-contract.mjs
├── machine-dev-resource-store.mjs
├── machine-dev-ios-provider.mjs
├── workflow-snapshot.mjs
├── workflow-doctor.mjs
├── worktree-observation-store.mjs
├── task-progress-store.mjs
├── dev-work.mjs
├── development-close.mjs
└── development-flow-residue.mjs

tooling/scripts/plan/
├── plan-package.mjs
└── planctl.mjs
```

## Responsibilities

- `machine-dev-registry.mjs`: authoritative workspace binding, Profile,
  capability, current-source, operation target Profile, and lease admission.
- `machine-dev-lease.py`: OS-held resource exclusivity and bounded child
  lifetime.
- `machine-dev.mjs`: runtime command composition.
- `machine-dev-resource-contract.mjs`: requirement projection delegated by the
  original Profile parser, resource encoding and identity validation.
- `machine-dev-resource-store.mjs`: assignments, readable discovery, preparation
  recovery and exact operation decisions under the original machine fence.
- `machine-dev-ios-provider.mjs`: subordinate simctl adapter and independent
  installation/deletion readback.
- `tooling/devctl/profile.mjs`: target/binding projection without registry mutation.
- `tooling/devctl/station.mjs`: Station reuse, exact-source deployment and readback.
- `tooling/acceptance/provisioners/station_equipment.py`: shared Acceptance caller
  of canonical Local Dev readiness; no separate deploy or source-sync implementation.
- `tooling/acceptance/provisioners/mobile_ios_resources.py`: explicit Profile/
  readable-selector caller retaining canonical physical descriptors; no
  allocation, adoption, uninstall, reset or device cleanup owner.
- `tooling/acceptance/provisioners/profile_ios_fixture.py`: task-owned native
  Fixture caller of that same owner; exact Fixture decisions and Keychain row
  observations never adopt or delete historical devices.
- `tooling/acceptance/gates/mobile/resource_dependencies_functional.py`:
  development native Journey using the original selected iOS Provisioner.
  `resource_dependencies_e2e.py` selects the two clean-source formal journeys.
- `workflow-snapshot.mjs`: one-shot read-only projection of current source,
  optional task records, and supplied runtime status.
- `workflow-doctor.mjs`: independent source and optional integration
  diagnostics.
- `task-progress-store.mjs`: one task-local atomic snapshot with checksum,
  corruption isolation, source invalidation, and revision/CAS.
- `dev-work.mjs`: optional task-progress CLI.
- `development-close.mjs`: close one explicitly selected task and settle only
  its owned resources.
- `development-flow-residue.mjs`: executable negative inventory for retired
  workflow authority modules and entrypoints.
- `planctl.mjs`: direct `validate`, `inspect`, and `task` reads for one explicit
  frozen Plan Version.

## Dependency Direction

```text
runtime command
  -> machine-dev.mjs
  -> machine-dev-registry.mjs + machine-dev-lease.py

optional task recovery
  -> dev-work.mjs
  -> task-progress-store.mjs
  -> .dev-workflow/tasks/<taskId>/

explicit Plan read
  -> planctl.mjs
  -> plan-package.mjs
```

Local Dev never reads optional task progress, Hook state, host identity, or a
formal Plan to grant or deny runtime operations. Snapshot and Doctor never
repair source, task, registry, or lease state.

## Resource Extension Ownership

LDCP-D23/D25/D26/D27 govern the resource owner and its subordinate modules.
The owner implementation is distinct from complete consumer cutover and native
proof; neither the directory tree nor logic tests establish those obligations.

Resource admission/instances belong inside the existing Local Dev module;
provider adapters are subordinate to that owner. They cannot create a new
top-level simulator controller, Profile schema owner or cleanup service.
The [data model](./data-model.md#12-resource-dependency-contract) is the
conceptual contract; Node and Python consume one validated projection.

```text
Make / Mobile launch / Acceptance
  -> existing machine-dev request composition
  -> existing Profile admission + user ID assignments + physical lease
  -> platform adapter -> provider observation
```

`mobile_simulator.py` owns product preparation, Fixtures and evidence, not
physical device allocation. Its selected/layout variants use the same resource
owner. Both Mobile shell entrypoints consume a held binding. Downstream Skills
reference the canonical architecture; operational knowledge injects the
invariant before edits without becoming another schema or allocator.

Profile-to-ID assignments and current instance contents have one machine
owner. Reverse shared-Profile lists are derived. The same owner prepares an
operation-specific overwrite notice, consumes the user's force/decline decision,
rechecks state under lock and projects the resulting writer to every Profile.
Neither a launcher nor a cleanup Skill may create a blanket force policy.

Discovery/selection projection belongs to the same owner. The Agent presents
readable observed devices and resolves count/purpose/name/list choices to IDs;
it cannot move UUID discovery or memorization work onto the user.

`machine-dev-primitives.mjs` owns the shared pure error and canonicalization
vocabulary. The resource contract validates and reads the canonical resource
document without importing the registry or mutation owner. The registry and
resource store depend on this contract; the store alone changes resource state
through the registry's existing transaction fence. Provider adapters depend on
the contract and primitives. This direction has no registry/store import cycle.

`fixtures/resource-native-boundary.mjs` is a native test driver. It uses the
production admission, persistence and provider, exits only its child at an
explicit boundary, and accepts only the exact task-owned preparation. It is
never loaded by a production resource entry.
