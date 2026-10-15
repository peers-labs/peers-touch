# Local Dev Control Plane - Architecture Design

> **Status**: active
> **Version**: v1.6
> **Created**: 2026-09-13 | **Updated**: 2026-10-15
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
9. **Profile-authorized environment lifecycle**: a reviewed Profile authorizes
   routine selection, registration, provisioning, deploy, restart, and reset
   within its declared capabilities. A worktree-local Profile may be created
   directly; remote topology still comes from tracked source.
10. **Profile-ID reset policy**: the canonical Profile ID is the only reset
    policy source. A case-insensitive terminal `stable` suffix protects the Profile
    from autonomous reset; every other reviewed Profile is Agent-resettable.
    The policy never replaces capabilities, exact reset scope,
    leases, topology validation, or source identity.
11. **One read-only development projection**: Workflow Snapshot joins each
    worktree's optional task facts with topology, leases, and observations
    without becoming a mutation or truth owner.
12. **No dashboard runtime**: the projection is an on-demand CLI/library call;
    it starts no server, opens no browser, and reserves no fixed port.
13. **Stable binding, live source**: the registry owns durable root, branch,
    profile, slot, and capability binding only. Current Git HEAD is read from
    the worktree for each operation and revalidated after OS-lock acquisition.

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
  - local slot allocation
  - Station capability leases
  - observed process/port projection
  - Acceptance Evidence Store
                 |
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
| Profile reset policy | Canonical profile identity | Case-insensitive terminal `stable` suffix in the verified directory/`PT_DEV_PROFILE` ID |
| Machine-local Profile creation | Current worktree | `make profile-init PROFILE=<name> SLOT=<n>` |
| Worktree registration identity | Canonical filesystem path + registered branch | `workspaceId = sha256(realpath(root))[0:16]` |
| Current worktree source identity | Git | Current branch and HEAD captured at operation time |
| Worktree profile selection | Machine Dev Control Plane | `bindings[workspaceId].profile` |
| Local port slot | Machine Dev Control Plane | `bindings[workspaceId].slot` |
| Station connection/deploy/reset permission | Machine Dev Control Plane | capability lease |
| Live process and port state | OS observation | PID identity + listening socket |
| Runtime evidence | Acceptance Evidence Store | `~/.peers-touch/dev/acceptance/` |
| Read-only workflow projection | Development Workflow | `workflow-snapshot.mjs` |

Profile files may describe remote topology defaults, but they must not remain
the authority for machine-local slot allocation.

## 4. Runtime Units

### 4.1 Environment Repository

Owns named, reviewable environment definitions. It must not record which local
worktree currently uses an environment.

Missing remote topology is a fail-closed boundary. It does not authorize an
agent to invent a host, credential, or untracked deploy definition. A new
tracked remote Profile is an ordinary source change only when the environment
repository is explicitly in task scope. A worktree-local development Profile
may be created directly with `make profile-init`.

Remote deployment resolves exactly one Git-tracked, clean deploy definition
directly from this repository. A `.local/deploy/envs/` copy is never topology
authority.

Reset policy is derived after the selected directory name and
`PT_DEV_PROFILE` value are proven identical:

| Derived policy | Canonical Profile ID | Agent reset authority |
|---|---|---|
| `stable-protected` | ends in `stable`, case-insensitive | autonomous `station.reset` is denied |
| `agent-resettable` | does not end in `stable` | Agent may choose exact-scope reset without human involvement |

No profile field stores or overrides this policy. Former control-mode metadata
has no reader. Renaming a Profile across the `stable` boundary is therefore a
reviewed topology change, not a runtime toggle.

For a non-stable Profile, reset still requires `station.reset` in the workspace
binding, the same exact reset scope on the command boundary, remote
tracked-clean topology, matching current source identity, and the OS-held
reset lease. These are scope, topology, identity, and concurrency guards; none
is a human-permission prompt. A stable Profile fails with
`PROFILE_RESET_PROTECTED` before lease acquisition.

An existing reviewed Profile and the current workspace binding authorize deploy
and restart within their capabilities. Non-stable reset is likewise
Profile-authorized. Every operation still resolves the exact target, current
source, clean remote topology when applicable, and OS-held lease. Stable reset
fails before lease acquisition.

`profile-init` creates one worktree-local compose Profile and never overwrites
an existing definition. It creates development topology, not another worktree
and not delivery permission.

### 4.2 Machine Registry

Owns durable machine-local declarations:

- Registered worktrees.
- Independent profile selection per `workspaceId`.
- Local slot allocation.
- Allowed Station capability mode.
- Detected conflicts.

It does not own Plan selection. Development Workflow stores the immutable Plan
binding in the workspace workflow namespace beside, not inside, the mutable
environment registration. The registry must not contain credentials, JWTs,
passwords, private keys, user messages, or Acceptance artifacts.

Registration is explicit. Discovery through `git worktree list`, a branch name,
an existing directory, a project `active_work` row, or a legacy profile pointer
must not register a worktree automatically.

Registration is reusable machine allocation and remains after normal task
completion. It is removed only for an explicitly authorized worktree removal.
Unregister requires the exact registration owner and no OS-held lease.
Deleted-worktree cleanup uses the exact workspace identity; no registry row is
removed by path guessing or direct file edits. Optional task records do not
occupy the registration.

Worktree activity is a derived runtime fact:

| State | Definition |
|-------|------------|
| `active` | A live process/listener or held lease has matching `workspaceId`, PID and process-start identity |
| `idle` | Explicitly registered, but no matching live process or lease exists |
| `stale` | Explicit registration exists, but canonical root or registered branch no longer matches |
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

### 4.5 Optional Task Records

Development Workflow may keep task-local progress and recovery records, but
Local Dev does not read them for runtime admission, binding changes, or
unregister. Historical `work.json`, PlanMount, Session, active-work, close, and
resource-plan files are diagnostic history only during removal.

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

The canonical implementation is split by responsibility:

- `machine-dev-registry.mjs` owns registration, binding, topology validation,
  slot allocation, capability checks, current-source validation, and status
  projection.
- `machine-dev-lease.py` owns the OS advisory-lock file descriptor and the
  bounded child process group; the mutation child inherits that descriptor and
  verifies the exact held lease before entering the critical section.
- `machine-dev.mjs` is the only CLI composition point used by Make and runtime
  scripts.

This is one control plane, not a Secure Content lease implementation.
`station.deploy` is keyed by the exact reviewed deploy-environment name.
`station.reset` is keyed by the exact Station/Fixture reset scope and requires
that same value as run-scoped authorization input. `local.slot` is keyed by the
machine binding's slot.

Lease acquisition snapshots the current branch and HEAD from the exact
canonical worktree. After acquiring the OS lock, it revalidates that source,
the authoritative binding, capability, reviewed Profile, normalized target,
reset policy, and exact scope under the lifecycle and registry locks. This
closes registration/source-change races without treating task records as
permission.

### 4.7 Runtime Observer

Projects current OS facts:

- Listening ports.
- PID, start time, executable, and cwd.
- Runtime profile and workspace identity when attestable.
- Active lease owner.

PID files are hints only. A PID must match process identity before it is treated
as running.

### 4.8 Workflow Snapshot

`workflow-snapshot.mjs` assembles one bounded read-only view of current Git
source, explicitly stored task progress, task-local corruption, and an
optional runtime status supplied by its caller. The primary key is
`workspaceId`, never basename.

The projection does not infer a selected task, join retired workflow ledgers,
or decide runtime authorization. Missing or malformed sources remain local
typed findings. The command prints one result and exits; it has no HTTP
endpoint, browser asset, refresh loop, mutation endpoint, or resident owner.

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

- Multiple worktrees share one remote Station with `station.connect`.
- One worktree holds `station.deploy` while other clients remain connected,
  provided the Profile capability and lease checks allow it.
- A reviewed non-stable Profile authorizes direct deploy, restart, runtime
  provisioning, and exact-scope reset without another prompt.
- An Agent may add `station.reset` to the current binding and request an exact
  reset scope for any non-stable reviewed Profile without human confirmation.
- Each worktree has its own profile and slot binding.
- A worktree-local compose profile is created only by canonical
  `make profile-init` and remains scoped to that worktree.
- Acceptance acquires stronger temporary leases without changing the user's
  durable worktree binding.

Forbidden:

- Two live worktrees use the same local slot.
- Two owners hold `station.deploy` or `station.reset` for the same resource.
- A profile's static `PT_DEV_SLOT` silently overrides the machine allocation.
- One worktree's `.local/dev/active` acts as global truth.
- Runtime commands read untracked environment definitions as approved topology.
- An Agent invents a remote host, credential, or untracked deploy definition
  outside the canonical Profile pipeline.
- A stored field, alias, Station mode, worktree name, or legacy cache overrides
  the canonical Profile ID reset policy.
- An existing non-stable Profile reset is converted into a user authorization
  request.
- A non-stable Profile bypasses exact reset capability/scope/lease checks.
- A stable Profile is granted `station.reset` or reaches reset lease
  acquisition.
- Workflow Snapshot writes registry, mount ledger, work ledger, lease, profile,
  workflow, or runtime state.
- A workflow inspection command starts a server, opens a browser, or reserves a
  fixed port.
- An arbitrary `PT_DEV_PROFILE_FILE` bypasses reviewed topology; only a
  contained Acceptance runtime-manifest profile is allowed.
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
| Stable Profile requests `station.reset` | `PROFILE_RESET_PROTECTED` |
| Workspace binding lacks a requested capability | `WORKSPACE_CAPABILITY_MISSING` |
| Reset command scope differs from the requested resource | `RESET_SCOPE_MISMATCH` |
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
- Every reviewed profile derives exactly one reset policy from its canonical
  ID and the resolved status projection exposes it.
- Mixed-case terminal `stable` suffixes reject `station.reset`; IDs with only a
  non-terminal `stable` token admit it
  only when binding capability, exact scope, current source, and lease all
  match.
- Workflow Snapshot joins every worktree's active requirements/Journeys and
  declared/held resources without exposing secret-bearing profile fields or
  providing mutation controls.
- Active source and docs contain no dashboard server, browser asset, fixed
  4177 resource, `make dev-ui`, or browser Gate after cutover.
- Workflow Snapshot returns one bounded view and exits without a live process.
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
- Existing non-stable Profile reset never requests human authorization; missing
  capability, scope, topology, identity, and lease failures remain separately
  typed and fail closed.
