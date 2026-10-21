# Local Dev Control Plane - Data Model

> **Status**: active
> **Version**: v2.0
> **Updated**: 2026-10-21
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/machine-dev-*`

## 1. Machine Registry

The authoritative registry is:

```text
~/.peers-touch/dev/registry.json
```

```typescript
interface MachineRegistry {
  schemaVersion: 1;
  kind: "peers-touch-machine-dev-registry";
  authority: "machine-control-plane";
  updatedAt: string;
  registrations: WorkspaceRegistration[];
}
```

Before first registration, an inventory may use
`authority: "observed-snapshot"`. Runtime resolution rejects that authority.

The schema is closed. Unknown authoritative fields, duplicate workspace IDs,
duplicate slots, malformed timestamps, or identity mismatches fail closed.

## 2. Workspace Registration

```typescript
interface WorkspaceRegistration {
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

Identity is derived as:

```text
canonicalRoot = realpath(worktreeRoot)
workspaceId   = sha256(canonicalRoot)[0:16]
```

`name` is display metadata. Current Git HEAD is not a registration field.

## 3. Profile Projection

The machine owner resolves the selected Profile without copying its full env
into the registry:

```typescript
interface ProfileProjection {
  profile: string;
  profileFile: string;
  sourceState: "tracked-clean" | "local";
  stationMode: "local" | "compose" | "remote";
  stationUrl: string;
  stationHost: string;
  stationDeployEnvironment?: string;
  stationDeployFile?: string;
  stationDeployHost?: string;
  resetPolicy: "stable-protected" | "agent-resettable";
}
```

The canonical Profile ID and the declared `PT_DEV_PROFILE` must match.
`resetPolicy` is derived and never persisted.

## 4. Capabilities

```typescript
type StationCapability =
  | "station.connect"
  | "station.deploy"
  | "station.reset";
```

Rules:

- connect does not imply deploy or reset;
- deploy and reset require a remote, non-loopback, tracked-clean target;
- reset is rejected for a stable-protected Profile;
- missing capability and stable protection are distinct failures;
- Profile selection preserves only capabilities valid for the new Profile.

## 5. Slot Allocation

One authoritative registry may assign a slot to only one workspace.

```typescript
interface SlotPorts {
  station: number;
  desktopAppGateway: number;
  desktopAppWeb: number;
  mobileWeb: number;
}
```

Ports are derived from the registered slot. The Profile's slot value cannot
override this allocation.

## 6. Lease Request

```typescript
type LeaseResourceKind =
  | "local.slot"
  | "station.deploy"
  | "station.reset";

interface LeaseRequest {
  resourceKind: LeaseResourceKind;
  resourceId: string;
  workspaceId: string;
  source: {
    branch: string;
    head: string;
  };
  budgetSeconds: number;
  leaseFile: string;
}
```

Resource identity is normalized by the control plane:

- `local.slot` uses the bound slot;
- `station.deploy` uses the Profile's reviewed deployment environment;
- `station.reset` uses the exact reset scope.

The caller cannot substitute an arbitrary resource label.

## 7. Lease Metadata

```typescript
interface LeaseMetadata {
  leaseId: string;
  resourceKind: LeaseResourceKind;
  resourceId: string;
  workspaceId: string;
  ownerPid: number;
  ownerProcessStart: string;
  acquiredAt: string;
}
```

Metadata describes the live holder but does not create ownership. The lock is
valid only while the OS lock is held by the matching process identity.

## 8. Status Projection

```typescript
type WorkspaceActivity = "active" | "idle" | "stale";

interface MachineStatus {
  observedAt: string;
  authority: "missing" | "observed-snapshot" | "machine-control-plane";
  registrations: Array<
    WorkspaceRegistration & {
      activity: WorkspaceActivity;
      resetPolicy?: "stable-protected" | "agent-resettable";
      profileState: "available" | "blocked";
      profileError?: {
        code: string;
        message: string;
      };
    }
  >;
  activeLeases: LeaseMetadata[];
  staleLeaseMetadata: unknown[];
  unregisteredObservations: unknown | null;
}
```

Status is recomputed from registry, Git, Profile, and lease observations. It
does not infer task progress or completion.
