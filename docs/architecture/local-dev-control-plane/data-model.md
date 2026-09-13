# Local Dev Control Plane - Data Model

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-13 | **Updated**: 2026-09-13
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/`

---

## 1. Machine Registry

The machine registry is stored at:

```text
~/.peers-touch/dev/registry.json
```

Current bootstrap state uses:

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-machine-dev-registry",
  "authority": "observed-snapshot"
}
```

`observed-snapshot` means the file is diagnostic only. Future implementation
may promote it to runtime authority only through an accepted migration.

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
  canonicalRoot?: string;
  name: string;
  branch: string;
  head: string;
  profile: string | null;
  slot: number | null;
  stationUrl: string | null;
  localState: 'global-managed' | 'private-directory' | 'missing';
}
```

An `observed-snapshot` may omit `canonicalRoot` while retaining its derived
`workspaceId`. An authoritative registry must persist and re-verify both.

## 3. Profile Definition

Profile definitions remain references to the sibling environment repository:

```ts
interface ProfileDefinition {
  name: string;
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
- `station.reset` requires explicit run-scoped authorization in addition to the
  durable allowed capability.

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

The lock is enforced by an OS advisory lock. JSON metadata is diagnostic and
cannot establish a held lease without the live lock and matching process
identity.

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

## 9. Atomicity

Registry mutation must:

1. Acquire the machine registry lock.
2. Read and validate the complete current document.
3. Reconcile live leases and process identity.
4. Apply one closed mutation.
5. Write a same-directory temporary file.
6. Flush and atomically replace `registry.json`.
7. Flush the containing directory where supported.

Unknown schema versions or unknown mutation variants fail closed.

## 10. Acceptance Evidence Root

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

### 10.1 Terminal State

Migration has no persistent terminal `legacy-removed` state. After the old
directory is removed and absence is verified:

1. Write an immutable completion receipt under
   `~/.peers-touch/dev/migrations/acceptance-root-relocation-v1.json`.
2. Remove `legacyAcceptanceEvidence` from `roots`.
3. Remove the complete `acceptanceEvidenceMigration` object.
4. Remove operational legacy-path branches from active docs and tooling.

The completion receipt is historical evidence only. Runtime resolvers, status
commands, and allocation logic must not read it.
