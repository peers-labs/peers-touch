# Local Dev Control Plane - Architecture Design

> **Status**: active
> **Version**: v1.4
> **Created**: 2026-09-13 | **Updated**: 2026-10-03
> **Owner**: Platform Team
> **Module**: `apps/dev/`, `tooling/scripts/local-dev/`

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
9. **Human-authorized environment lifecycle**: an AI agent may select an
   existing approved environment, but may not create, copy, derive, or register
   a profile or deploy environment without explicit human developer approval
   for the exact name and target.
10. **Profile-ID reset policy**: the canonical Profile ID is the only reset
    policy source. A case-insensitive `stable` substring protects the Profile
    from autonomous reset; every other reviewed Profile is Agent-resettable.
    The policy never replaces declarations, capabilities, exact reset scope,
    leases, topology validation, or source identity.
11. **One read-only development view**: the Development Control Plane dashboard
    joins each worktree's requirements and Journeys with its topology, bindings,
    declared resources, leases and observations without becoming a mutation or
    truth owner.
12. **One machine-wide app instance**: Peers Dev binds only
    `127.0.0.1:4177`; the OS listener is the exclusivity authority and every
    compatible worktree launch reuses that instance.
13. **Immutable Plan ownership**: each workspace has one machine-local Plan
    binding; repository/PR synchronization cannot replace it.
14. **Stable binding, live source**: the registry owns durable root, branch,
    profile, slot, and capability binding only. Current Git HEAD is read from
    the worktree for each operation and fenced by Development intent and
    runtime build identity where mutation occurs.
15. **Shared immutable compilation, isolated outputs**: Rust compiler results
    may be reused through one bounded machine `sccache`, while every worktree
    retains its own Cargo target directory, incremental state, linked
    artifacts, and final binaries.

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
  - immutable workspace Plan bindings
  - public development work declarations
  - human environment-creation authorizations
  - local slot allocation
  - Station capability leases
  - observed process/port projection
  - Acceptance Evidence Store
                 |
                 | redacted projection
                 v
Peers Dev
  apps/dev/
  - one machine-wide HTTP server
  - worktree/resource management UI
                 |
                 | workspaceId-scoped runtime resolution
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
~/.peers-touch/dev/cargo-cache/                  Shared bounded compiler cache
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
| Profile reset policy | Canonical profile identity | Case-insensitive `stable` substring in the verified directory/`PT_DEV_PROFILE` ID |
| Machine-local environment creation approval | Human developer | `~/.peers-touch/dev/authorizations/environment-creation/` |
| Worktree registration identity | Canonical filesystem path + registered branch | `workspaceId = sha256(realpath(root))[0:16]` |
| Current worktree source identity | Git | Current branch and HEAD captured at operation time |
| Worktree profile selection | Machine Dev Control Plane | `bindings[workspaceId].profile` |
| Worktree Plan ownership | Development Workflow | `workspaces/<workspaceId>/workflow/plan-binding.json` |
| Development source/runtime intent | Development Workflow | `~/.peers-touch/dev/work.json` |
| Local port slot | Machine Dev Control Plane | `bindings[workspaceId].slot` |
| Station connection/deploy/reset permission | Machine Dev Control Plane | capability lease |
| Live process and port state | OS observation | PID identity + listening socket |
| Runtime evidence | Acceptance Evidence Store | `~/.peers-touch/dev/acceptance/` |
| Reusable Rust compiler objects | Machine Dev Control Plane | `~/.peers-touch/dev/cargo-cache/data/` |
| Rust target and final binaries | Current worktree | Cargo's worktree-local `target/` |
| Peers Dev application source | Repository application layer | `apps/dev/` |
| Live Peers Dev server ownership | Operating system | listener on `127.0.0.1:4177` |

Profile files may describe remote topology defaults, but they must not remain
the authority for machine-local slot allocation.

## 4. Runtime Units

### 4.1 Environment Repository

Owns named, reviewable environment definitions. It must not record which local
worktree currently uses an environment.

Missing topology is a fail-closed boundary. It does not authorize an agent to
create `env/peers-touch/<name>/`, a local-only profile cache, or a deploy
environment. Creation requires explicit human developer approval naming the
environment and target; task scope, an execution plan, an existing host, or an
Acceptance requirement is not implied approval.

Remote deployment resolves exactly one Git-tracked, clean deploy definition
directly from this repository. A `.local/deploy/envs/` copy is never topology
authority.

Reset policy is derived after the selected directory name and
`PT_DEV_PROFILE` value are proven identical:

| Derived policy | Canonical Profile ID | Agent reset authority |
|---|---|---|
| `stable-protected` | contains `stable`, case-insensitive | autonomous `station.reset` is denied |
| `agent-resettable` | does not contain `stable` | Agent may choose exact-scope reset without human involvement |

No profile field stores or overrides this policy. Former control-mode metadata
has no reader. Renaming a Profile across the `stable` boundary is therefore a
reviewed topology change, not a runtime toggle.

For a non-stable Profile, reset still requires `station.reset` in the workspace
binding, one live Development declaration with the same Profile and exact
exclusive reset scope, the same scope on the command boundary, remote
tracked-clean topology, matching source identity, and the OS-held reset lease.
These are intent, scope, topology, identity, and concurrency guards; none is a
human-permission prompt. A stable Profile fails with
`PROFILE_RESET_PROTECTED` before lease acquisition.

Existing-profile deploy authorization remains resolved from exact user grants
and the accepted Plan's `authorization.runtime.deployProfiles`. Mere Plan
existence grants nothing, and Plan fields never authorize profile or
deploy-environment creation.

Human developers may create a short-lived, exact machine authorization for one
`workspaceId + profile + mode + slot` tuple. `profile-init` consumes it once
and writes a digest-bound receipt. Agents may consume a pre-existing grant when
the requested tuple matches, but may not create the grant. A machine-local
compose profile is selectable only while its bytes match that consumed receipt.

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

### 4.5 Development Work Ledger

`~/.peers-touch/dev/work.json` is the machine-wide public intent projection
owned by Development Workflow. It advertises work item, workspace, branch,
source write scope and planned runtime resources before mutation.

The ledger does not allocate resources and cannot grant deploy/reset authority.
Local Dev Control Plane leases remain the live exclusivity owner. A work
declaration and lease may reference the same resource, but they answer different
questions: planned use versus current possession.

A tracked declaration must match the immutable workspace Plan binding. Once
bound, the workspace cannot publish untracked declarations.

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
  slot allocation, capability checks, Development-intent matching, and status
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

Lease acquisition also requires one live Development declaration for the same
workspace, current branch, current HEAD, profile, and exclusive runtime claim.
The registry does not cache that HEAD: the declaration proves source intent,
the worktree supplies current source, and the OS lock proves possession.
The binding and intent are revalidated after OS-lock acquisition under the
registry update lock, closing the registration-update/acquisition race.

When a DWF-D32 `PlanResourcePlan` introduced the claim, admission additionally
requires a source-current `COMMITTED` receipt for that exact claim. A
`RESERVING` receipt is recoverable but non-authorizing. The receipt keeps
pre-existing declaration claims in `baseRuntimeClaims`; those claims retain
their original declaration authority and are not removed by replanning. A
shared `resource.plan:<workItemId>` claim marks planner provenance, so a missing
receipt fails closed instead of falling back to declaration-only admission.

### 4.7 Runtime Observer

Projects current OS facts:

- Listening ports.
- PID, start time, executable, and cwd.
- Runtime profile and workspace identity when attestable.
- Active lease owner.

PID files are hints only. A PID must match process identity before it is treated
as running.

### 4.8 Peers Dev Application

The self-development application lives under `apps/dev/`. Its server and web UI
form one product unit and serve a redacted snapshot assembled from:

- reviewed profile definitions;
- machine registry bindings and profile trust state;
- active Development work declarations and their requirement/Journey identity;
- live and stale lease observations;
- derived per-worktree profile, slot, Station, Relay, database, fixture and
  other runtime-resource usage;
- derived profile occupancy and conflicts as a secondary capacity view.

The primary row key is `workspaceId`, never basename. Registered workspaces use
registry display metadata; declaration-only workspaces remain explicit as
unregistered rather than disappearing from the board. Runtime claims describe
planned use, while leases separately describe current possession.

Each tracked declaration is also an explicit Plan foreign key:
`planPath + planId + taskId`. The server resolves that locator only beneath the
registered canonical root and delegates package interpretation to the canonical
Plan Package parser. It returns selected identity, lifecycle, and Task-closure
progress fields; canonical roots and absolute Plan paths remain private.

Work execution and environment readiness are separate projections. An active
Task can remain `in-progress` while a dirty profile, stale registry binding, or
slot conflict is reported in `environmentHealth`. The newest stale declaration
for a work item remains visible as `stale`, but contributes no runtime intent,
occupancy, or authorization.

The initial application has no mutation endpoint. It never reads or exposes
credentials, raw profile values, product data, logs, canonical roots, or
Acceptance payloads. Missing or malformed sources remain visible as typed
unavailable/conflict states. Future mutation controls must call guarded
`devctl` application services instead of writing control-plane files.

### 4.9 Peers Dev Server

The public endpoint is fixed at `http://127.0.0.1:4177`. Startup probes
`GET /api/server` before binding. A compatible response makes startup
idempotently successful; no new process is created. When the port is free, the
new process binds it. `EADDRINUSE` after the probe is treated as a concurrent
start race and followed by a bounded identity re-probe.

The server identity contract includes protocol version, app kind, source
`workspaceId`, branch, HEAD, and an explicit dirty flag. The flag prevents an
uncommitted runtime from being mistaken for exact commit source without
exposing filenames or diffs. The contract excludes canonical filesystem paths.
A listener that does not return the exact supported identity fails closed as
`DEV_SERVER_PORT_CONFLICT`.

No PID file, dynamic fallback port, implicit process kill, host override, or
port override participates in server ownership.

### 4.10 Rust Compiler Cache

Cargo discovers the repository `.cargo/config.toml` from any nested manifest
and invokes one checked-in wrapper. The wrapper uses `sccache` when available,
honors an explicit disable switch, and otherwise delegates directly to the
Cargo-provided `rustc` executable.

Machine setup installs the same wrapper under
`~/.peers-touch/dev/cargo-cache/bin/` and references it from Cargo's user
configuration so retained worktrees benefit before they synchronize the
repository config. The wrapper sets a shared cache directory and bounded cache
size only when the caller has not supplied explicit values.

The integration never sets `CARGO_TARGET_DIR` or Cargo `build.target-dir`.
Dependency versions, features, target triples, compiler versions, profiles and
compiler arguments remain part of the compiler-cache key; incompatible
artifacts therefore miss instead of being reused.

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
- An exact user grant or accepted Plan `deployProfiles` entry authorizes direct
  deploy operation of the matching existing reviewed remote profile.
- An Agent may add `station.reset` to the current binding and declare an exact
  reset scope for any non-stable reviewed Profile without human confirmation.
- Each worktree has its own profile and slot binding.
- A human-authorized machine-local compose profile has one consumed,
  digest-bound authorization receipt for its exact workspace and slot.
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
- An AI agent creates or registers a profile or deploy environment without
  explicit human developer approval for the exact environment and target.
- A stored field, alias, Station mode, worktree name, or legacy cache overrides
  the canonical Profile ID reset policy.
- An existing non-stable Profile reset is converted into a user authorization
  request.
- A non-stable Profile bypasses exact reset
  declaration/capability/scope/lease checks.
- A stable Profile is granted `station.reset` or reaches reset lease
  acquisition.
- The dashboard writes registry, work ledger, lease, profile, workflow, or
  runtime state.
- Two Peers Dev processes listen concurrently, a worktree silently chooses
  another port, or a launcher accepts a foreign listener.
- A worktree kills or replaces the current Peers Dev owner implicitly.
- An Agent runs `profile-authorize`, creates an authorization file, reuses a
  consumed grant, or edits an authorized local profile after receipt creation.
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
| Environment creation lacks explicit human approval | `ENVIRONMENT_CREATION_UNAUTHORIZED` |
| Authorization is expired, mismatched, reused, or digest-invalid | `ENVIRONMENT_CREATION_AUTHORIZATION_INVALID` |
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
- Mixed-case `stable` IDs reject `station.reset`; IDs without `stable` admit it
  only when binding capability, declaration, exact scope, and lease all match.
- The dashboard joins every worktree's active requirements/Journeys and
  declared/held resources without exposing secret-bearing profile fields or
  providing mutation controls.
- Two simultaneous `make dev-ui` calls result in exactly one listener; the
  loser verifies the winner and exits successfully.
- A compatible existing server is reused and exposes its source identity,
  while a foreign listener fails with `DEV_SERVER_PORT_CONFLICT`.
- Active source and docs contain no legacy dashboard implementation, command,
  or asset path after cutover.
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
  capability, declaration, scope, topology, identity, and lease failures remain
  separately typed and fail closed.
- Two byte-identical crates built from different directories produce a
  compiler-cache hit while retaining distinct target directories.
- Missing or explicitly disabled `sccache` delegates to the exact
  Cargo-provided compiler without breaking the build.
- Machine setup preserves unrelated Cargo configuration and refuses ambiguous
  duplicate ownership instead of rewriting it.
