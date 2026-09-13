# Local Dev Control Plane - Architecture Design

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-13 | **Updated**: 2026-09-13
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/`

---

## 1. Core Principles

1. **One machine owner**: machine-local allocation truth lives under
   `~/.peers-touch/dev/`, never in one arbitrary worktree.
2. **Independent worktree binding**: profile and slot selection are keyed by
   `workspaceId`, so changing one worktree does not change another.
3. **Definition is not allocation**: the `env` repository defines deployable
   topology; the machine registry allocates local resources and permissions.
4. **Observed state is not declared state**: process and port probes verify live
   state; stale PID files or symlinks cannot establish ownership.
5. **Capabilities before mutation**: connecting, deploying, and resetting a
   Station are different permissions with different lease strength.
6. **Fail closed**: duplicate slot, conflicting exclusive Station capability,
   stale identity, or dirty untracked environment definition blocks mutation.
7. **Product namespace isolation**: development artifacts never write under
   the formal product Application Support root.
8. **Repository cleanliness**: transient debug sessions, logs, traces,
   screenshots, DOM dumps, and ad-hoc reports are machine development state,
   not repository-root content.

## 2. System Architecture

```text
Sibling env repository
  env/peers-touch/<profile>/
  - Station/Relay topology definition
  - deploy environment definition
                 |
                 | profile reference
                 v
Machine Dev Control Plane
  ~/.peers-touch/dev/
  - workspace registry
  - public development work declarations
  - local slot allocation
  - Station capability leases
  - observed process/port projection
  - Acceptance Evidence Store
                 |
                 | workspaceId-scoped resolution
                 v
Worktree
  - source and branch
  - independent active binding
  - no machine-global allocation truth
                 |
                 | resolved runtime manifest
                 v
make desktop | make mobile | make station | Acceptance
```

The following roots remain separate:

```text
~/.peers-touch/                                  product and Agent data
~/.peers-touch/dev/                              machine dev control plane
~/.peers-touch/dev/acceptance/                   Acceptance evidence
~/.peers-touch/dev/workspaces/<workspaceId>/     worktree-scoped development state
~/Library/Application Support/peers-touch/       Desktop runtime instances
~/Library/Application Support/PeersTouch/        formal product namespace
```

`~/Library/Application Support/PeersTouch/acceptance` is a legacy development
artifact root. It is retained only until a verified one-time migration and must
not remain as a symlink, fallback, or second read owner.

## 3. Sources Of Truth

| State | Owner | Canonical source |
|-------|-------|------------------|
| Deployable Station/Relay topology | Environment repository | `env/peers-touch/<profile>/` |
| Worktree identity | Git + canonical filesystem path | `workspaceId = sha256(realpath(root))[0:16]` |
| Worktree profile selection | Machine Dev Control Plane | `bindings[workspaceId].profile` |
| Development source/runtime intent | Development Workflow | `~/.peers-touch/dev/work.json` |
| Local port slot | Machine Dev Control Plane | `bindings[workspaceId].slot` |
| Station connection/deploy/reset permission | Machine Dev Control Plane | capability lease |
| Live process and port state | OS observation | PID identity + listening socket |
| Runtime evidence | Acceptance Evidence Store | `~/.peers-touch/dev/acceptance/` |

Profile files may describe remote topology defaults, but they must not remain
the authority for machine-local slot allocation.

## 4. Runtime Units

### 4.1 Environment Repository

Owns named, reviewable environment definitions. It must not record which local
worktree currently uses an environment.

### 4.2 Machine Registry

Owns durable machine-local declarations:

- Registered worktrees.
- Independent profile selection per `workspaceId`.
- Local slot allocation.
- Allowed Station capability mode.
- Last observed source and runtime state.
- Detected conflicts.

It must not contain credentials, JWTs, passwords, private keys, user messages,
or Acceptance artifacts.

Registration is explicit. Discovery through `git worktree list`, a branch name,
an existing directory, a project `active_work` row, or a legacy profile pointer
must not register a worktree automatically.

Worktree activity is a derived runtime fact:

| State | Definition |
|-------|------------|
| `active` | A live process/listener or held lease has matching `workspaceId`, PID and process-start identity |
| `idle` | Explicitly registered, but no matching live process or lease exists |
| `stale` | Explicit registration exists, but root/source identity no longer matches |
| `unregistered` | Discovered or observed only; cannot acquire managed runtime resources |

A profile pointer alone does not make a worktree active.

### 4.3 Acceptance Evidence Store

Owns immutable Acceptance runs under:

```text
~/.peers-touch/dev/acceptance/<workspaceId>/<gateId>/<runId>/
```

It remains logically independent from registry and lease mutation. Artifact
root overrides may redirect CI and isolated tests, but they must never redirect
machine-global lease authority.

### 4.4 Debug Session Store

Transient debug sessions resolve to:

```text
~/.peers-touch/dev/workspaces/<workspaceId>/debug/<sessionId>/
```

This store owns debug logs, traces, screenshots, DOM snapshots, temporary
reports, and reproduction notes. A session must be deleted after closure.
Reusable conclusions move to the governing design, operational knowledge, or
Acceptance Evidence Store; transient files do not move into the repository.

### 4.5 Development Work Ledger

`~/.peers-touch/dev/work.json` is the machine-wide public intent projection
owned by Development Workflow. It advertises work item, workspace, branch,
source write scope and planned runtime resources before mutation.

The ledger does not allocate resources and cannot grant deploy/reset authority.
Local Dev Control Plane leases remain the live exclusivity owner. A work
declaration and lease may reference the same resource, but they answer different
questions: planned use versus current possession.

### 4.6 Lease Manager

Owns bounded live exclusivity. Required lease classes:

| Capability | Sharing | Meaning |
|------------|---------|---------|
| `station.connect` | shared | Client may connect without deploying or resetting |
| `station.deploy` | exclusive per deploy environment | Current source may deploy/restart Station |
| `station.reset` | exclusive per Station + fixture scope | Destructive fixture reset is authorized |
| `local.slot` | exclusive while local clients run | Desktop/Mobile ports for one workspace |
| `runtime.profile` | exclusive when environment requires isolated runtime state | Acceptance/runtime profile state |

A durable binding does not prove a live lease. A live lease does not rewrite the
durable binding.

### 4.7 Runtime Observer

Projects current OS facts:

- Listening ports.
- PID, start time, executable, and cwd.
- Runtime profile and workspace identity when attestable.
- Active lease owner.

PID files are hints only. A PID must match process identity before it is treated
as running.

## 5. Resolution Contract

Every mutating runtime command resolves in this order:

```text
canonical worktree root
  -> workspaceId
  -> machine binding
  -> environment definition
  -> local slot allocation
  -> required capability lease
  -> observed conflict check
  -> immutable resolved runtime manifest
  -> execute
```

No command may infer profile from a sibling worktree, a branch name, basename,
or whichever `.local` directory happens to contain a file.

## 6. Allowed And Forbidden Relationships

Allowed:

- Multiple worktrees observe the same public Development work ledger.
- Multiple worktrees share one remote Station with `station.connect`.
- One worktree holds `station.deploy` while other clients remain connected,
  provided the deployment policy explicitly allows it.
- Each worktree has its own profile and slot binding.
- Acceptance acquires stronger temporary leases without changing the user's
  durable worktree binding.

Forbidden:

- A private worktree declaration replaces the machine public ledger.
- A Development declaration is treated as a held runtime lease.
- Two live worktrees use the same local slot.
- Two owners hold `station.deploy` or `station.reset` for the same resource.
- A profile's static `PT_DEV_SLOT` silently overrides the machine allocation.
- One worktree's `.local/dev/active` acts as global truth.
- Runtime commands read untracked environment definitions as approved topology.
- Machine registry stores secrets or product data.
- Acceptance or other development artifacts write under
  `~/Library/Application Support/PeersTouch/`.
- Missing registry state falls back to slot 0 or loopback Station.

## 7. Failure Semantics

| Failure | Result |
|---------|--------|
| Worktree not registered | `WORKSPACE_UNREGISTERED` |
| Binding absent | `WORKSPACE_BINDING_MISSING` |
| Profile missing or unreviewed | `PROFILE_UNAVAILABLE` |
| Slot already live | `LOCAL_SLOT_CONFLICT` |
| Station capability held | `STATION_CAPABILITY_CONFLICT` |
| Deploy host/URL mismatch | `DEPLOY_TARGET_MISMATCH` |
| Observed process identity mismatch | `RUNTIME_IDENTITY_MISMATCH` |
| Registry malformed | `MACHINE_REGISTRY_INVALID` |

All failures occur before service start, deploy, restart, or destructive reset.

## 8. Quality Gates

The target implementation must prove:

- Two same-basename worktrees receive distinct `workspaceId` bindings.
- Switching one binding does not change another.
- Concurrent allocation cannot assign the same live slot twice.
- Shared `station.connect` coexists; deploy/reset exclusivity fails closed.
- Stale PID and stale lock metadata do not establish ownership.
- Dirty or untracked env definitions are visible and cannot authorize deploy.
- `make env-status-all` reports declared binding and observed runtime separately.
- Evidence root migration preserves every manifest, latest pointer, content
  hash, workspace identity, and file count before deleting the legacy root.
- Product Application Support contains no Acceptance writer, symlink, fallback,
  or residual `acceptance/` directory after cutover.
- Every registered Git worktree proves the canonical root contract before
  cutover; an old worktree cannot silently recreate the removed directory.
- After closure, the live registry and active docs contain no legacy-root
  field or migration branch.
- No runtime command defaults to loopback, slot 0, or an arbitrary profile when
  a binding is missing.
