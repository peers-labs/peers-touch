# Local Dev Control Plane - Data Model

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-09-13 | **Updated**: 2026-09-21
> **Owner**: Platform Team
> **Module**: `apps/dev/`, `tooling/scripts/local-dev/`

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
  head: string;
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
ID, branch, and HEAD before every resolved command. Source movement or Git
identity drift makes the registration `stale` until `env-update` refreshes it.

## 3. Profile Definition

Profile definitions remain references to the sibling environment repository:

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
  authorizationReceipt?: string;
  sourceState:
    | 'tracked'
    | 'tracked-clean'
    | 'tracked-dirty'
    | 'untracked'
    | 'authorized-local';
}
```

`resetPolicy` is not stored in the profile. The reader first requires the
profile directory name and `PT_DEV_PROFILE` to match exactly, then applies
`lowercase(profileId).includes("stable")`:

- `stable-protected`: autonomous `station.reset` is denied with
  `PROFILE_RESET_PROTECTED`;
- `agent-resettable`: the Agent may choose reset without human involvement
  when the workspace capability, live declaration, exact scope, source
  identity, remote topology, and OS lease all match.

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
- Registration requires an explicit Owner action; discovery never writes a
  `WorkspaceBinding`.
- Slot is allocated independently of profile.
- `station.connect` does not imply deploy or reset.
- `station.deploy` consumes an exact user grant or accepted Plan
  `authorization.runtime.deployProfiles` entry for the existing reviewed
  profile.
- `station.reset` may be added by the Agent for an `agent-resettable` Profile.
  It still requires an exact exclusive runtime declaration and lease.
- `station.reset` cannot be added for a `stable-protected` Profile.
- Missing capability is `WORKSPACE_CAPABILITY_MISSING`, not an authorization
  request.

### 4.1 Immutable Workspace Plan Binding

Development Workflow owns a separate create-once record:

```text
~/.peers-touch/dev/workspaces/<workspaceId>/workflow/plan-binding.json
```

It contains the canonical root, `workspaceId`, `planId`, repository-relative
`planPath`, and binding audit fields. It is not part of `WorkspaceRecord`:
Profile, slot, capabilities, branch and HEAD may change under their existing
guards, while Plan ownership cannot be rebound.

Activity is derived and not manually asserted:

```ts
type WorkspaceActivity = 'active' | 'idle' | 'stale';
```

- `active`: at least one live runtime process/listener or lease matches
  `workspaceId`, PID, and process-start identity.
- `idle`: registration is valid but no runtime resource is live.
- `stale`: the registered canonical root or source identity no longer matches.

An unregistered discovered worktree has no `WorkspaceActivity`; it is simply
outside the managed cohort.

## 5. Environment Creation Authorization

An interactive human grant is short-lived and exact:

```ts
interface EnvironmentCreationAuthorization {
  schemaVersion: 1;
  kind: 'peers-touch-environment-creation-authorization';
  state: 'pending' | 'consumed';
  workspaceId: string;
  workspaceRoot: string;
  profile: string;
  target: {
    mode: 'compose';
    slot: number;
  };
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
  nonce: string;
  consumedAt?: string;
  profileSha256?: string;
}
```

Rules:

- Only a human developer may create `pending` authorization through an
  interactive terminal confirmation of the exact tuple.
- An Agent may not invoke the grant command or write the authorization file.
- `profile-init` atomically claims one pending authorization and produces one
  immutable consumed receipt bound to the generated profile bytes.
- A pending grant expires after 30 minutes and cannot be reused.
- A machine-local profile whose current digest does not match a consumed
  receipt is unavailable.
- Git-tracked, clean env-repository profiles remain canonical and do not use
  this machine-local authorization path.
- `PT_DEV_PROFILE_FILE` is reserved for run-scoped Acceptance composition and
  must declare `acceptance-runtime-manifest` authority plus an absolute profile
  root containing the owned regular file.

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
registry, source identity, capability and Development intent under the registry
lock; binding updates inspect leases under the same lock order.

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

## 7.1 Dashboard Projection

```ts
interface DevelopmentDashboardSnapshot {
  observedAt: string;
  server: PeersDevServerIdentity;
  profiles: Array<{
    name: string;
    resetPolicy: 'stable-protected' | 'agent-resettable' | null;
    stationMode: string | null;
    stationUrl: string | null;
    stationDeployEnvironment: string | null;
    relayUrl: string | null;
    relayDeployEnvironment: string | null;
    sourceState: string;
    status: 'available' | 'blocked';
    error: null | { code: string; message: string };
  }>;
  registrations: WorkspaceRecord[];
  declarations: DevelopmentResourceDeclaration[];
  activeLeases: LeaseRecord[];
  staleLeaseMetadata: unknown[];
  worktrees: Array<{
    workspaceId: string;
    name: string | null;
    branches: string[];
    workState:
      | 'in-progress'
      | 'stale'
      | 'reserved'
      | 'blocked';
    environmentHealth: {
      state: 'ready' | 'warning' | 'blocked' | 'conflict' | 'unregistered';
      issues: string[];
    };
    requirements: Array<{
      workItemId: string;
      journeyId: string | null;
      purpose: string;
      state: 'DECLARED' | 'ACTIVE' | 'RELEASING' | 'STALE';
      plan: null | {
        planId: string;
        taskId: string;
        status:
          | 'available'
          | 'untracked'
          | 'missing'
          | 'legacy'
          | 'invalid'
          | 'mismatch'
          | 'unregistered';
        progress: null | {
          completed: number;
          total: number;
          percentage: number;
        };
      };
    }>;
    environment: {
      profile: string | null;
      slot: number | string | null;
      resetPolicy: 'stable-protected' | 'agent-resettable' | null;
      sourceState: string | null;
    };
    resources: {
      station: RuntimeResourceProjection;
      relay: RuntimeResourceProjection;
      databases: RuntimeClaimProjection[];
      other: RuntimeClaimProjection[];
    };
    leases: LeaseRecord[];
  }>;
  occupancy: Array<{
    profile: string;
    workspaceIds: string[];
    slots: number[];
    workItemIds: string[];
    leaseIds: string[];
    state: 'free' | 'reserved' | 'active' | 'conflict' | 'blocked';
  }>;
}

interface PeersDevServerIdentity {
  schemaVersion: 1;
  kind: 'peers-touch-dev-server';
  protocolVersion: 2;
  endpoint: 'http://127.0.0.1:4177';
  startedAt: string;
  source: {
    workspaceId: string;
    branch: string;
    head: string;
    dirty: boolean;
  };
}

interface RuntimeClaimProjection {
  kind: string;
  resourceId: string;
  mode: 'shared' | 'exclusive';
  workItemIds: string[];
}

interface RuntimeResourceProjection {
  url: string | null;
  deployEnvironment: string | null;
  claims: RuntimeClaimProjection[];
}
```

This object is generated on request and never persisted as authority. Secret
profile fields, canonical roots and raw profile documents are excluded by
construction. `worktrees` is the primary operator projection; `occupancy`
remains a secondary profile-capacity projection.

## 7.2 Single-Instance State

Peers Dev has no persisted owner record. Live ownership is exactly the process
holding the `127.0.0.1:4177` TCP listener.

```ts
type PeersDevProbe =
  | { state: 'absent' }
  | { state: 'compatible'; server: PeersDevServerIdentity }
  | { state: 'foreign'; status?: number };
```

Startup accepts only `kind=peers-touch-dev-server`,
`schemaVersion=1`, and `protocolVersion=2`. An absent listener may be bound.
A compatible listener is reused. A foreign, malformed, timed-out, or
incompatible listener produces `DEV_SERVER_PORT_CONFLICT`.

PID files and lock metadata are not part of this state model.

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

## 9. Development Work Intent

Development Workflow publishes machine-visible intent in:

```text
~/.peers-touch/dev/work.json
```

The full schema is owned by
[`development-workflow/data-model.md`](../development-workflow/data-model.md).
This control plane consumes only projected runtime claims for status and
conflict reporting.

Rules:

- Intent declaration precedes resource acquisition.
- Declaration does not establish a lease.
- Live lease and process observation determine active resource possession.
- Missing or released intent prevents new workflow mutation but does not
  fabricate process cleanup.
- Secrets and raw runtime handles are invalid in both registry and work ledger.

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

Plan binding creation uses a complete owner-only temporary file and atomic
no-replace publication. An existing different tuple returns
`WORKSPACE_PLAN_REBIND_DENIED`; no mutation or deletion follows.

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
