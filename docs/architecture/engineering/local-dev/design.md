# Local Dev Control Plane - Design

> **Status**: active
> **Version**: v2.0
> **Updated**: 2026-10-21
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/machine-dev-*`

## 1. Principles

1. One machine root owns shared local allocation.
2. Every worktree has an independent canonical identity and binding.
3. Profile topology and machine allocation have different owners.
4. Current source comes from Git at operation time.
5. Declared binding, live process state, and held leases remain separate facts.
6. Capabilities are checked before mutation.
7. Conflicts and identity mismatches fail closed.
8. Development state never uses the product Application Support namespace.

## 2. Architecture

```text
Developer / Agent
  |
  +-- make profile / env-*
  +-- devctl runtime commands
  |
  v
Machine Dev Control Plane
  ~/.peers-touch/dev/
  - workspace registry
  - slot allocation
  - Station capabilities
  - OS-held leases
  - workspace runtime roots
  |
  +-- reads reviewed Profile topology
  |     env/peers-touch/<profile>/
  |     .local/dev/profiles/<profile>.env
  |
  +-- supplies binding and ports to devctl
  |
  v
Station / Desktop / Mobile / Relay runtime owners
```

The control plane coordinates resources. It does not implement product
lifecycle or business behavior.

## 3. Machine Root

```text
~/.peers-touch/dev/
├── registry.json
├── registry.lock
├── leases/
├── acceptance/
└── workspaces/
    └── <workspaceId>/
        ├── runtime/
        ├── logs/
        ├── debug/
        └── data/
```

The platform resolver may map this logical root differently on another OS, but
all consumers use one resolver. Registry, leases, runtime files, and Acceptance
artifacts keep separate child namespaces.

## 4. Workspace Binding

```text
workspaceId = sha256(realpath(worktreeRoot))[0:16]
```

The durable binding contains:

- canonical root and registered branch;
- selected Profile;
- allocated local slot;
- allowed Station capabilities;
- owner and purpose metadata.

It does not persist current Git HEAD. Every operation reads branch and HEAD
from the worktree. Root or branch drift is stale binding; advancing the same
branch is normal source evolution.

`make profile <name>` is the common first-use path. It registers an unbound
worktree with the lowest free slot, then selects the Profile. `make
env-register` is the advanced path for explicit slot, capability, purpose, and
owner values.

## 5. Profile Topology

The binding names a Profile but does not copy its topology.

- Remote topology must come from one tracked-clean directory in the sibling
  environment repository.
- A local or Compose topology may come from a private Profile directly under
  `.local/dev/profiles/`.
- `devctl profile init` creates the local Profile and its separate private
  Compose credential file.
- Machine allocation supplies runtime ports and overrides Profile slot
  defaults.

Profile parsing and secret generation belong to Developer Toolchain. Local Dev
owns selection, identity checks, and allocation.

## 6. Capabilities

```text
station.connect   shared use of an existing Station
station.deploy    exclusive source deployment or restart
station.reset     exclusive destructive reset of one exact scope
```

First selection grants:

- non-stable remote Profile: `station.connect` and `station.deploy`;
- stable remote Profile: `station.connect`;
- local or Compose Profile: `station.connect`.

Reset is never granted implicitly. For reset policy, only the verified
canonical Profile ID is read:

```text
lowercase(profileId).endsWith("stable")
  -> stable-protected
otherwise
  -> agent-resettable
```

Stable reset always fails. Non-stable reset still requires the capability,
exact scope, current source identity, reviewed topology, and lease.

## 7. Lease Admission

The control plane uses OS locks for:

- `local.slot`;
- `station.deploy`;
- `station.reset`.

Admission order:

1. resolve the authoritative binding;
2. validate Profile, capability, target, and requested scope;
3. capture current branch and HEAD;
4. acquire the resource lock;
5. re-read binding and source identity under the registry lock;
6. launch the child while it inherits the held descriptor;
7. release on exit, failure, signal, or timeout.

JSON inside a lock file is diagnostic metadata. It cannot establish ownership
without the live OS lock and matching process identity.

## 8. Observation

`env-status-all` reports:

- authoritative registrations;
- `active`, `idle`, or `stale` binding state;
- active leases and stale lease metadata;
- unregistered observations separately.

Discovery, Hook reports, task progress, Plans, and open IDE windows never
register a worktree or mark it active.

## 9. Failure Semantics

Mutation stops before side effects when:

- the registry is missing, malformed, or non-authoritative;
- the worktree root or branch no longer matches;
- the selected Profile is missing, ambiguous, dirty, or malformed;
- the slot or requested capability does not match the binding;
- a deploy target or reset scope does not match;
- stable reset is requested;
- the source changes during lease acquisition;
- another process holds the resource lease.

Errors preserve the failing boundary. They are not translated into a request
for unrelated workflow state or human approval.

## 10. Forbidden Relationships

- Profile files owning machine slot allocation.
- Discovery or observation creating registration.
- Task, Plan, Hook, or chat state granting runtime permission.
- Current Git HEAD stored as durable registration state.
- Credentials stored in the registry.
- Caller-provided resource labels bypassing normalized target identity.
- A stale PID file or lock JSON treated as live ownership.
- Development artifacts written into product data roots.
