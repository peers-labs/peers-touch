# Local Dev Control Plane - Integration

> **Status**: active
> **Version**: v2.0
> **Updated**: 2026-10-21
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/machine-dev-*`

## 1. Owner Integration

| Owner | Supplies To Local Dev | Receives From Local Dev |
|---|---|---|
| Environment repository | tracked-clean remote topology | no machine allocation |
| Developer Toolchain | local Profile creation and Profile parsing | selected Profile, ports, runtime root |
| Station adapter | normalized deploy target | capability and deploy lease |
| Desktop and Mobile | canonical workspace request | binding, slot, and runtime paths |
| Acceptance | explicit artifact-root override and run scope | real binding and guarded runtime access |
| Development Workflow | no authority input | optional read-only runtime facts |

No integration copies credentials into the registry or turns workflow state
into runtime permission.

## 2. Command Contract

| Command | Local Dev behavior |
|---|---|
| `make profile <name>` | register on first use, allocate a slot, and select the Profile |
| `make profile-init <name> SLOT=<n>` | delegate local topology and credential creation to `devctl` |
| `make profiles` | list available Profile observations and selected binding |
| `make config` | resolve binding, Profile, and allocated ports through `devctl` |
| `make env-register ...` | create an explicit binding |
| `make env-update ...` | update allowed binding fields when no lease is held |
| `make env-check ...` | assert identity, Profile, slot, and capabilities |
| `make env-unregister` | remove the exact idle registration owned by the caller |
| `make env-status-all` | report registrations, Profile state, and leases |

Runtime commands consume this contract. They do not select a default Profile
for an unregistered worktree.

## 3. Fresh Checkout

For a local Compose environment:

```bash
make profile-init local
make profile local
make doctor
make station
```

Initialization creates:

```text
.local/dev/profiles/local.env
.local/dev/compose/local.env
```

The first file contains topology. The second contains generated Compose
credentials and is referenced by the first. Both are Git-ignored and
non-overwriting; the credential file is never printed.

Selection then creates the machine binding and assigns the effective slot.

## 4. Runtime Admission

### Connect

Station health checks and clients require `station.connect`. The capability is
shared and does not create a deploy or reset lease.

### Deploy

Remote Station deployment requires:

- `station.connect` and `station.deploy`;
- one tracked-clean Profile and deploy definition;
- matching Station and deployment hosts;
- current branch and HEAD;
- the normalized `station.deploy` lease.

The child inherits the held descriptor. Environment markers alone do not
prove possession.

### Reset

Reset additionally requires:

- an agent-resettable Profile;
- `station.reset`;
- exact equality between requested resource and reset scope;
- current source revalidation;
- the normalized `station.reset` lease.

Stable Profile reset fails before lease acquisition.

## 5. State Boundaries

The registry persists durable allocation only. Other state remains with its
owner:

- current HEAD: Git;
- Profile values: Profile file;
- credentials: private Compose env or external secret owner;
- process identity: Developer Toolchain runtime records and live OS probes;
- task progress: Development Workflow task record;
- formal evidence: Acceptance Evidence Store;
- product data: product runtime.

Removing or corrupting one optional task record cannot change a workspace
binding. A stale binding cannot be repaired by task or Hook state.

## 6. Removed Paths

Current runtime has:

- no worktree profile-pointer reader;
- no parallel shell Profile implementation;
- no Profile-owned slot authority;
- no current-HEAD field in the registry;
- no workflow declaration, Plan mount, or Hook receipt in runtime admission;
- only `local.slot`, `station.deploy`, and `station.reset` lease kinds.

There is no compatibility reader or dual-write path for these contracts.
Rollback is a source revert, not a retained fallback.

## 7. Verification

Focused checks:

```bash
node --test tooling/scripts/lib/machine-dev-paths.test.mjs
node --test tooling/scripts/local-dev/machine-dev.test.mjs
node --test tooling/devctl/test/profile.test.mjs
```

Structural verification also checks:

- one slot cannot be assigned to two workspaces;
- root or branch drift fails;
- same-branch HEAD advancement succeeds without registry mutation;
- stable reset fails;
- deploy and reset normalize real target identity;
- stale lock metadata does not create ownership;
- Profile initialization creates private, separate Compose credentials;
- deleted Profile scripts and pointer readers have no live consumer.

User-facing setup and troubleshooting live in
[`docs/development/environment.md`](../../../development/environment.md).
