# Local Dev Control Plane - Data Model

> **Status**: active
> **Version**: v2.1
> **Created**: 2026-09-13 | **Updated**: 2026-11-15
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/`

---

## 1. Machine Registry

The machine registry is stored at:

```text
~/.peers-touch/dev/registry.json
```

Bootstrap audit state may use:

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-machine-dev-registry",
  "authority": "observed-snapshot"
}
```

`observed-snapshot` means the file is diagnostic only. Future implementation
does not read those registrations as authority. The first explicit
`env-register` atomically promotes the document to:

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-machine-dev-registry",
  "authority": "machine-control-plane",
  "updatedAt": "2026-09-13T00:00:00.000Z",
  "registrations": []
}
```

Bootstrap audit and D07 evidence-migration fields may remain as diagnostic
fields during their owning migration. Runtime resolution consumes only the
closed authoritative registration schema. Unknown authoritative fields,
duplicate workspace IDs, duplicate slots, malformed timestamps, and identity
mismatches fail closed.

The root projection distinguishes target and legacy evidence locations:

```ts
interface MachineRoots {
  machineDevRoot: '~/.peers-touch/dev';
  acceptanceEvidence: '~/.peers-touch/dev/acceptance';
  legacyAcceptanceEvidence?: '~/Library/Application Support/PeersTouch/acceptance';
}
```

## 2. Workspace Identity

```text
canonicalRoot = realpath(worktree root)
workspaceId   = lower_hex(sha256(canonicalRoot))[0:16]
```

The registry key is `workspaceId`. `name` is display metadata and must not be a
lookup key because two worktrees may have the same basename.

```ts
interface WorkspaceRecord {
  workspaceId: string;
  canonicalRoot: string;
  name: string;
  branch: string;
  profile: string;
  slot: number;
  allowedCapabilities: StationCapability[];
  purpose: string;
  owner: string;
  registeredAt: string;
  updatedAt: string;
  updatedBy: string;
}
```

An `observed-snapshot` may contain additional diagnostic projections. An
authoritative registration persists and re-verifies canonical root, workspace
ID, and registered branch before every resolved command. Current Git HEAD is
captured from the worktree at operation time and is never persisted in the
registration. A root or branch mismatch makes the registration `stale`;
ordinary commits, merges, rebases, and pulls do not.

Schema v1 authoritative registrations exclude `WorkspaceRecord.head`. This is
a development-stage hard correction, not a version migration. Runtime has no
compatibility reader for head-bearing registrations or alternate schema
versions; incompatible files fail closed and must be corrected explicitly.

## 3. Profile Definition

Profile definitions remain references to the sibling environment repository:

`checkWorkspace({targetProfile})` returns the original `binding` and a reviewed
target `profile`. `profile` remains the binding assertion; it is not the
operation target. `prepareLease` freezes `targetProfile` alongside the current
source and exact resource ID. CLI `--target-profile` and the contained
`PT_DEV_TARGET_PROFILE` projection carry that target through command resolution.
The lease projects `PT_MACHINE_LEASE_TARGET_PROFILE`; inherited lease
verification rejects a different requested target and revalidates the frozen
target. No registry or lease-metadata schema version is added.

```ts
interface ProfileDefinition {
  name: string;
  resetPolicy: 'stable-protected' | 'agent-resettable';
  stationMode: 'local' | 'compose' | 'remote';
  stationUrl: string;
  stationDeployEnvironment?: string;
  relayUrl?: string;
  relayDeployEnvironment?: string;
  sourceCommit?: string;
  sourceState:
    | 'tracked'
    | 'tracked-clean'
    | 'tracked-dirty'
    | 'untracked'
    | 'local';
}
```

`resetPolicy` is not stored in the profile. The reader first requires the
profile directory name and `PT_DEV_PROFILE` to match exactly, then applies
`lowercase(profileId).endsWith("stable")`:

- `stable-protected`: autonomous `station.reset` is denied with
  `PROFILE_RESET_PROTECTED`;
- `agent-resettable`: the Agent may choose reset without human involvement
  when the workspace capability, exact scope, current source identity, remote
  topology, and OS lease all match.

The derived policy is projected into status but is not copied into
`WorkspaceRecord`. No environment variable, Station mode, or legacy cache may
override it.

Target state removes machine-local slot authority from profile definitions.
During migration, an observed legacy `PT_DEV_SLOT` may be reported as
`legacySlot`, but it cannot override the machine allocation.

## 4. Workspace Binding

```ts
interface WorkspaceBinding {
  workspaceId: string;
  canonicalRoot: string;
  profile: string;
  slot: number;
  allowedCapabilities: StationCapability[];
  purpose: string;
  owner: string;
  updatedAt: string;
  updatedBy: string;
}

type StationCapability =
  | 'station.connect'
  | 'station.deploy'
  | 'station.reset';
```

Rules:

- One workspace has at most one active profile binding.
- Registration is created only by the canonical `profile` or `env-register`
  action; discovery never writes a `WorkspaceBinding`.
- Slot is allocated independently of profile.
- `station.connect` does not imply deploy or reset.
- A reviewed non-stable remote Profile receives `station.deploy` on canonical
  first selection and may use it without another Plan or chat grant.
- A stable Profile receives only `station.connect` by default. A user-directed
  explicit capability binding may add `station.deploy`; reset remains
  forbidden.
- `station.reset` may be added by the Agent for an `agent-resettable` Profile.
  It still requires an exact command scope and OS-held lease.
- `station.reset` cannot be added for a `stable-protected` Profile.
- Missing capability is `WORKSPACE_CAPABILITY_MISSING`, not an authorization
  request.

### 4.1 Optional Task Progress

Task recovery state is repository-local and explicitly selected:

```text
.dev-workflow/tasks/<taskId>/
└── task.json
```

It is not part of `WorkspaceRecord`, does not occupy the workspace, and is not
read by runtime admission. The checksum-protected snapshot is the only task
record. Revision/CAS protects concurrent updates and source changes invalidate
stale evidence.

Activity is derived and not manually asserted:

```ts
type WorkspaceActivity = 'active' | 'idle' | 'stale';
```

- `active`: at least one live runtime process/listener or lease matches
  `workspaceId`, PID, and process-start identity.
- `idle`: registration is valid but no runtime resource is live.
- `stale`: the registered canonical root or branch no longer matches.

An unregistered discovered worktree has no `WorkspaceActivity`; it is simply
outside the managed cohort.

## 5. Worktree-Local Profile

`make profile-init PROFILE=<name> SLOT=<n>` creates one local compose Profile
under `.local/dev/profiles/`. It never overwrites an existing Profile and its
identity must match the selected name. Runtime accepts it only when it is a
non-symlink regular file directly inside that worktree-local directory, owned
by the current user, inaccessible to group/other users, and composed only of
shell-safe literal `KEY=VALUE` assignments. Machine resolution parses those
values and emits shell-quoted exports; normal development never executes the
local Profile with `source`.

Git-tracked, clean environment-repository Profiles remain canonical for remote
deployment. A local Profile cannot authorize remote deploy or reset because it
has no tracked deploy definition. `PT_DEV_PROFILE_FILE` remains reserved for
run-scoped Acceptance composition and must declare
`acceptance-runtime-manifest` authority plus an absolute profile root
containing the owned regular file.

## 6. Lease Record

```ts
interface LeaseRecord {
  leaseId: string;
  resourceKind: 'local.slot' | 'station.deploy' | 'station.reset' | 'runtime.profile';
  resourceId: string;
  workspaceId: string;
  ownerPid: number;
  ownerProcessStart: string;
  acquiredAt: string;
  expiresAt?: string;
}
```

The lock is enforced by `flock(2)` through
`tooling/scripts/local-dev/machine-dev-lease.py`. The holder owns the file
descriptor while its child process group executes. It forwards termination
signals, enforces the declared budget, terminates the process group on timeout,
and clears metadata before unlocking on success, command failure, signal, or
timeout. The mutation child inherits the locked descriptor, so supervisor
`SIGKILL` cannot release exclusivity while the child continues. After acquiring
the resource lock and before launching the mutation, the holder revalidates the
registry binding, prepared Git source identity, capability, reviewed Profile,
target, reset policy, and exact scope under the registry lock; binding updates
inspect leases under the same lock order.

JSON metadata is diagnostic and cannot establish a held lease without the live
OS lock and matching PID/process-start identity. Metadata left by `SIGKILL` or
machine failure is stale: status reports it separately, and the next successful
OS lock acquisition replaces it.

## 7. Runtime Observation

```ts
interface RuntimeObservation {
  observedAt: string;
  listeners: Array<{
    port: number;
    pid: number;
    processStart: string;
    executable: string;
    cwd?: string;
    workspaceId?: string;
  }>;
  activeLeases: LeaseRecord[];
}
```

Declared and observed state must remain separate. A declared slot with no
listener is allocated but idle; a listener without a matching binding is an
unowned runtime conflict.

## 7.1 Workflow Snapshot Projection

```ts
interface DevelopmentWorkflowSnapshot {
  observedAt: string;
  worktrees: Array<{
    workspaceId: string;
    canonicalRoot: string;
    source: CurrentGitSource;
    tasks: TaskProgress[];
    taskErrors: TaskProgressError[];
  }>;
  errors: SnapshotError[];
  runtime: unknown | null;
  digest: string;
}
```

`workflow-snapshot.mjs` generates this object on request and never persists it.
One corrupt task or unavailable workspace becomes a local typed finding and
does not hide other rows. The CLI has no listener, browser, PID, refresh loop,
or runtime lifecycle.

## 8. Conflict Model

```ts
interface RegistryConflict {
  kind:
    | 'worktree-profile-sharing'
    | 'slot-reuse'
    | 'local-slot-live-conflict'
    | 'station-capability-conflict'
    | 'isolated-local-roots'
    | 'untracked-environment-definitions'
    | 'stale-worktree-profile-binding'
    | 'runtime-identity-mismatch';
  severity: 'low' | 'medium' | 'high' | 'blocking';
  resource?: string;
  workspaceIds?: string[];
  detail?: string;
}
```

Static slot reuse is reported during migration. It becomes blocking when two
workspaces attempt to run local clients on the same slot.

## 9. Runtime Admission Boundary

Runtime admission reads the authoritative workspace binding, reviewed Profile,
normalized target, current Git source, stable protection, operation-specific
authorization, and OS-held lease. Optional task records, Plans, and Hook
context neither grant nor block acquisition. Live leases and process
observation determine actual resource possession. Secrets and raw handles are
invalid in registry and lease metadata.

## 10. Atomicity

Registry mutation must:

1. Acquire the machine registry lock.
2. Read and validate the complete current document.
3. Reconcile live leases and process identity.
4. Apply one closed mutation.
5. Write a same-directory temporary file.
6. Flush and atomically replace `registry.json`.
7. Flush the containing directory where supported.

Unknown schema versions or unknown mutation variants fail closed.

Optional task snapshots belong to Development Workflow and do not participate
in registry atomicity or resource admission. Formal Plans are explicit inputs,
not machine registrations or mounts (DWF-D46).

## 11. Acceptance Evidence Root

The local developer default is:

```text
~/.peers-touch/dev/acceptance
```

The Evidence Store layout remains:

```text
<acceptance-root>/<workspaceId>/<gateId>/<runId>/
```

`ArtifactRef` remains root-relative and does not persist the physical root.
Therefore a verified whole-root relocation preserves logical references.

Migration state is explicit:

```ts
type AcceptanceRootMigrationState =
  | 'legacy'
  | 'quiescing'
  | 'quiesced'
  | 'copying'
  | 'verified'
  | 'cut-over'
  | 'removing';
```

`cut-over` is legal only when no writer or live run exists and the target root
passes manifest, latest-pointer, content-hash, file-count, and byte-count
verification. There is no dual-read state.

Worktree readiness is explicit in the run-scoped migration manifest:

```ts
type AcceptanceRootContractStatus =
  | 'unknown'
  | 'legacy-capable'
  | 'canonical-ready';

interface AcceptanceRootWorktreeReadiness {
  workspaceId: string;
  status: AcceptanceRootContractStatus;
  sourceCommit?: string;
  verifiedAt?: string;
}
```

`canonical-ready` requires source evidence that the worktree's resolver:

- defaults to `~/.peers-touch/dev/acceptance`;
- rejects the product Application Support namespace;
- has no legacy fallback, dual-read, or dual-write;
- keeps machine-global leases independent from artifact-root override.

The migration command dynamically reads `git worktree list`; it does not
auto-register the result. Every discovered worktree must either prove
`canonical-ready` or be physically removed from the Git worktree registry
before `cut-over`. The readiness matrix belongs to the migration manifest, not
the long-lived machine registry.

### 11.1 Terminal State

Migration has no persistent terminal `legacy-removed` state. After the old
directory is removed and absence is verified:

1. Write an immutable completion receipt under
   `~/.peers-touch/dev/migrations/acceptance-root-relocation-v1.json`.
2. Remove `legacyAcceptanceEvidence` from `roots`.
3. Remove the complete `acceptanceEvidenceMigration` object.
4. Remove operational legacy-path branches from active docs and tooling.

The completion receipt is historical evidence only. Runtime resolvers, status
commands, and allocation logic must not read it.

## 12. Resource Dependency Contract

The conceptual contract below governs the concrete encoding in section 12.7.
Consumer cutover and native proof remain separate completion obligations.
The existing Profile parser must be the single projection owner; a second
resource-specific Profile file or a separately maintained Python schema is forbidden.

| Fact | Owner | Content |
|------|-------|---------|
| ResourceRequirement | Profile definition | Logical kind, requested operations, runtime/device compatibility and data requirement |
| ProfileResourceAssignment | Machine Dev, user-directed | Canonical Profile ID to explicit resource ID set and Profile-local purpose/labels |
| ResourceInstance | Machine Dev | Stable resource ID, provider identity, creation provenance, current content/revision, retention and recovery |
| ResourceLease | Machine Dev + OS | Shared/exclusive possession, holder PID/start, deadline and current operation source identity |

For example, Profile four references its reviewed Station and requests connect;
an iOS requirement declares runtime/device compatibility. The user requests
two suitable devices or chooses readable device names. Agent/control plane
inspects inventory and resolves the assignment internally, for example
`four -> [ios-a, ios-b]`, `other -> [ios-b]`.
The two Profiles share `ios-b` and see that shared reference. Profile-local
labels and client scenarios do not create extra physical devices.
This is a semantic example, not executable Profile syntax or an env mutation.

### 12.1 Instance Facts

The target machine-owned record contains:

- Stable internal resource ID, kind and placement owner.
- Readable display name/label, provider name and optional Profile-local purpose.
  Display names are not identity keys; renaming does not change IDs or locks.
- Provider identity (iOS UUID or resolved Station target).
- Owned creation/preparation receipt, or explicit external provenance.
- Classified creation/data ownership, including assigned, task-disposable,
  user-retained or external scope.
- Runtime/device compatibility and original data-owner scope references.
- Physical-lease reference, actual holder/purpose, retention and release condition.
- Current provider binding and installation/source/data revision with last writer.
- Preparation identity, lifecycle/cleanup progress and last provider observation.

These are instance facts, not a duplicate WorkspaceBinding, Task, Plan or
credential store. Profile assignments are the single owner of reference sets;
the reverse `profileIds` view is derived, not independently persisted.
One machine resource ID resolves one provider instance; conflicting alias IDs
for one provider identity must not bypass the same physical UUID lock.
Installed App source, bundle identity and artifact digest are separate from
physical identity and rechecked before use.

### 12.2 User-Directed ID Assignments

LDCP-D26/D27 govern allocation. A user requests count/purpose, selects readable
resources from discovered inventory or delegates matching to the Agent.
Existing/shared resources and explicit creation are presented by name/context;
Agent/control plane resolves their internal IDs. The
authoritative result is the set of IDs, and the displayed count is its
cardinality. A count does not choose a device, identify sharing or determine
which Profile may overwrite it. No default global count cap or fixed role is imposed.

The same ID in multiple assignment sets means one shared resource. Different
IDs remain distinct even when Profiles have equal requested counts. Every
Profile can see all other references, current content and observed holders.
Runtime compatibility is checked against the selected ID rather than used to
silently substitute another device. Shared definitions keep logical requirements;
machine UUIDs and actual assignment are machine state under LDCP-D03.

Detach removes only the named Profile-to-ID relation. Release ends one held
operation. Delete removes the provider resource only through a separately
authorized, observed operation. Neither detach nor release implies delete.

### 12.3 Separate State Machines

| Instance progress | Meaning | Can operate |
|-------------------|---------|-------------|
| preparing | Durable ID/preparation intent, provider result not confirmed | after recovery completes |
| present | Provider identity and current content observed | by ID, subject to lease/overwrite admission |
| removing | Explicit provider removal in progress | no new mutation |
| removed | Device and scoped associated data absence confirmed | no; destroyed instance |
| cleanup-failed | Cleanup failed or cannot be confirmed | no contradictory completion claim; reconcile first |
| ownership-unknown | Ownership/provider match cannot be established | observe only |

Profile associations, retained handoff, instance progress and lease held/released
are separate facts. A released lock can accompany present retained contents or
cleanup-failed progress. No count or reference record proves a live lease.
Do not erase a record before cleanup; publish removed only after readback.

The same preparation ID must recover or return its original result. Persist
nonce and intent before OS create; match provider evidence and owned intent
together after a crash. A device name prefix cannot establish createdBy.

### 12.4 Operation And Data Scope

Station uses its existing connect/deploy/reset capabilities. Simulator uses
inspect/use/provision/reset/delete semantics defined by the same control plane.
Concrete capability spellings and serialized fields are implementation work;
consumers may not mint their own permission taxonomy.

Simulator overwrite/reset/delete requires exact instance identity and the
affected original data scopes. A non-stable Profile never converts another
Profile's content into silently disposable state. Shared credentials/keychain
and databases must not be claimed isolated merely because uninstall succeeded.

### 12.5 Operation-Specific Overwrite Decision

The conceptual pending operation freezes resource ID, provider identity,
reference set, current binding/content revision, active holders, requested
replacement and affected data/session scopes. The user receives that concrete
notice and may decline or explicitly force the specified replacement.

No response/decline/cancel performs no overwrite. Force is specific to this
operation and impact; it is not stored as a Profile default or inferred from
sharing. It does not bypass OS locks, unknown ownership or Station permissions.
After physical-lock acquisition, changed references/content/holder require a
new notice. Stopping an active user's process requires explicitly confirmed
stop scope as part of the notice.

One instance record owns actual installed content and last writer. All Profile
projections derive from it after success or partial failure; no stale per-Profile
copy may pretend the previously installed source remains current. Concrete
serialization and UI/CLI spelling remain implementation work.

### 12.6 Readable Selection Projection

Agent/control plane derives a selection list from provider inventory and
canonical assignments. Each item binds an internal resource/provider identity
to readable name, model/runtime, observed state, Profile references and purpose.
Raw UUID is diagnostic detail, not a required user input or primary label.

A count/purpose request is valid: the Agent finds eligible devices and makes
its selected/recommended names and sharing effects visible. A named selection
or a temporary list choice resolves the same internal tuple. Duplicate names
must be differentiated; a stale list position cannot remap to another device.
Changing a readable label never changes identity, assignments or locks.
Unknown assignment facts remain unknown; OS names do not prove ownership.
Overwrite notices use these readable descriptors while fencing the exact ID/
revision internally. This projection is not another persistent allocation store.

### 12.7 Machine Dev Resource Encoding

The original `resolveProfileDefinition` projects optional
`PT_MOBILE_IOS_RUNTIME`, `PT_MOBILE_IOS_DEVICE_TYPE` and
`PT_MOBILE_IOS_DATA=preserve|fresh`. Runtime and device type are explicit
provider identifiers; both are required together. There is no default
quantity, fixed role or new Profile file. Missing requirements are a typed
Profile finding, never authority to edit sibling env source.

`~/.peers-touch/dev/resources.json` is one subordinate machine document with
`kind=peers-touch-machine-resources`, encoding `version=1`, and the closed
collections `instances`, `assignments`, `operations`. The existing Machine Dev
lifecycle and registry lock protect its atomic fsync/rename transactions.
It is independent from the artifact root and does not become a controller,
task authority, credential store or separate Profile parser.

Instance IDs are random `ios-<24 hex>` identifiers. Provider UUIDs are uppercase
and unique across all instance records. Assignments contain one canonical
Profile ID, its original definition source and explicit ID/purpose references;
reverse sharing is derived. Creation persists request ID, request digest,
nonce, exact provider name, compatibility and pre-existing UUID set before
calling the provider. Recovery matches that durable intent to provider
observation and returns the original instance; a prefix alone proves nothing.

`simulator.ios:<provider UUID>` uses the original OS lease runner. Source
admission binds branch, HEAD and the existing `inspectGitWorkspace`
workspace digest. Nested leases pass an explicit descriptor stack so acquiring
a physical lock cannot drop the enclosing slot lock. Aliases cannot use
resource IDs to select a different physical lock.

Operations bind Profile/workspace/source, exact instance/provider identity,
action, target, displayed impact and its digest. Actions are
`use|boot|install|reset|delete`. States are
`pending|declined|ready|running|succeeded|failed|cancelled`.
Only the matching pending impact accepts `force`; a ready operation can be
cancelled. `begin` verifies the actual inherited descriptor and repeats
source, reference, content, session and artifact checks under the registry
lock. Changed impact returns to pending and clears the decision.

Install verifies the installed artifact with an independent directory digest.
Runtime `use` records unverified intended content until provider readback can
establish it; it cannot certify native readiness. Failed or interrupted
mutations publish observed, unverified content. Interrupted deletion retains
retry identity and becomes removed only after provider and associated-directory
absence. Recovery never reuses a force decision to repeat an interrupted effect.
