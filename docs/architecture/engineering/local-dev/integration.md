# Local Dev Control Plane - Integration

> **Status**: active
> **Version**: v1.4
> **Created**: 2026-09-13 | **Updated**: 2026-10-15
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/`

---

## 1. Existing System Mapping

| Existing path | Current role | Target role |
|---------------|--------------|-------------|
| `env/peers-touch/<profile>/` | Profile and deploy topology | Remains canonical topology owner |
| `<worktree>/.local/dev/profiles/` | Imported cache or local compose profile | Worktree-local Profile created by canonical `profile-init`; never remote deploy authority |
| `<worktree>/.local/dev/active/` | Legacy worktree profile pointer | No runtime reader; replaced by machine registry binding |
| `<worktree>/.local/dev/pids|logs|data/` | Legacy worktree/profile runtime state | New runtime state resolves under the workspace-scoped global dev root |
| `<worktree>/.local/deploy/envs/` | Legacy imported deploy cache | Never deployment authority; deploy resolves a unique tracked-clean env-repository definition |
| `/tmp/peers-touch-profile-leases/` | Legacy Acceptance/deploy live locks | Not used by canonical `make station`; replaced by one machine control-plane lease root |
| `~/.peers-touch/dev/registry.json` | Observed snapshot until explicit promotion | Authoritative after `make env-register` |
| `~/Library/Application Support/PeersTouch/acceptance/` | Legacy Acceptance Evidence Store | One-time verified move to `~/.peers-touch/dev/acceptance/` |
| `.dev-workflow/tasks/<taskId>/task.json` | Optional task-local recovery | Repository-local atomic snapshot; never runtime authority |
| `tooling/scripts/local-dev/workflow-snapshot.mjs` | Peers Dev server previously owned this projection | Canonical one-shot read-only Workflow Snapshot |

The migration must be atomic at the runtime command boundary. There must not be
permanent dual-read precedence between global registry and `.local/dev/active`.

## 2. Target Directory Layout

```text
~/.peers-touch/dev/
├── README.md
├── registry.json
├── registry.lock
├── acceptance/
│   └── <workspaceId>/<gateId>/<runId>/
├── leases/
│   ├── local-slot-<n>.lock
│   ├── station-deploy-<environment>.lock
│   └── station-reset-<station-fixture>.lock
└── workspaces/
    └── <workspaceId>/
        ├── runtime/
        ├── pids/
        ├── logs/
        ├── debug/
        └── data/
```

The target root is platform-adapted on non-Unix systems, but the logical
contract remains `Peers Touch machine dev root`. Platform resolution belongs to
one resolver, not each script.

## 3. Command Integration

Target command behavior:

| Command | Control-plane action |
|---------|----------------------|
| `make env-register` | Explicitly enroll the verified current workspace and allocate one profile/slot/capability binding |
| `make env-unregister [WORKSPACE_ID=<id>]` | Remove the exact idle registration owned by the caller; reject any live OS-held lease |
| `make profile <name>` | Select a reviewed Profile; register with the lowest free slot on first use; non-stable remote Profiles receive connect+deploy, while stable/local/compose Profiles receive connect only |
| `make env-update` | Atomically replace requested binding fields and the registered branch while no lease is held |
| `make env-check` | Verify current root/ID/branch, live Git source, selected definition, slot, capabilities, target host, and budget |
| `make dev-start TASK=<id> ...` | Optionally create task-local recovery state |
| `make dev-update TASK=<id> EXPECTED_REVISION=<n> ...` | Update one explicit task with revision/CAS |
| `make dev-status TASK=<id>` | Read one explicit task |
| `make dev-status-all` | Read task-local records and isolate corrupt tasks |
| `make dev-close TASK=<id> ...` | Close only the selected task and settle only its owned resources |
| `make plan-validate PLAN=<path>` | Validate one explicit frozen Plan Version |
| `make plan-inspect PLAN=<path>` | Inspect one explicit Plan without machine occupancy |
| `make plan-task PLAN=<path> TASK=<id>` | Read one explicit Plan task |
| `make profile-init <name> SLOT=<n>` | Create one non-overwriting worktree-local compose Profile |
| `make profile <name>` | Call canonical `env-update` behavior for only the current `workspaceId` binding |
| `make config` | Resolve current binding + env definition + allocation |
| `make status` | Show current worktree declared and observed state |
| `make env-status-all` | Show all registered worktrees, conflicts, processes and leases |
| `make workflow-snapshot` | Print one redacted workflow projection and exit |
| `make desktop` | Acquire current workspace `local.slot` lease and start native Tauri Desktop |
| `make mobile` | Acquire current workspace `local.slot` lease |
| `make station-check` | Require `station.connect` |
| `make station` / restart | Require exclusive `station.deploy` |
| destructive Acceptance reset | Require an Agent-resettable Profile, exclusive `station.reset`, and an exact run scope |

The generic reset lease API for the later destructive wrapper is:

```bash
node tooling/scripts/local-dev/machine-dev.mjs lease \
  --resource-kind station.reset \
  --resource-id <station-fixture-scope> \
  --reset-scope <station-fixture-scope> \
  --budget-seconds <seconds> \
  -- <reset-command>
```

It validates the canonical Profile-ID reset policy, authoritative binding,
`allowedCapabilities`, remote tracked-clean topology, prepared current source,
and exact reset scope before acquiring the OS lock. It does not implement
deletion or consult task progress, Plan state, host identity, Hook output, or a
second human-authorization channel.

`make station` uses the same API with `station.deploy` and holds the lease
across source synchronization, build, restart, deploy health readback, and the
final profile health check. The mutation child inherits the locked file
descriptor and verifies its exact lease metadata before bypassing acquisition;
an environment marker alone cannot establish possession. Direct Station
deployment enters the same canonical lease path, while the old `/tmp` profile
lease remains only for non-Station deployment roles.

## 4. Bootstrap Snapshot Boundary

Before explicit promotion, `~/.peers-touch/dev/registry.json` is intentionally
diagnostic:

- It records current worktree/profile/slot/Station facts.
- It records dirty and untracked env definitions.
- It records detected conflicts.
- It records the target and legacy Acceptance roots.
- Runtime commands reject it as non-authoritative.
- It does not migrate, delete, or symlink any worktree `.local`.

`env-status-all` may read and label the snapshot, but only `env-register`
promotes it. This permits visibility without silently changing active runtimes.

## 5. Migration Constraints

- Preserve each worktree's independent profile choice.
- Derive reset policy only from the verified canonical Profile ID. A
  case-insensitive terminal `stable` suffix is protected; all other reviewed Profile
  IDs are Agent-resettable. Do not read a control-mode field or legacy cache.
- Do not select a default profile for unbound worktrees.
- Do not assign slot 0 as a fallback.
- Agents may create a worktree-local Profile with `make profile-init`; remote
  topology must remain tracked source in the explicitly scoped environment
  repository.
- `PT_DEV_PROFILE_FILE` is reserved for a profile directly contained by a
  declared Acceptance runtime profile root with
  `acceptance-runtime-manifest` authority.
- Do not activate untracked env profiles as deploy authority.
- Do not move product data into the dev root.
- Move Acceptance evidence into the dedicated `acceptance/` child; do not mix
  it with registry, lease, workspace runtime, or product data.
- Do not infer a running process from a stale PID file.
- Do not delete existing `.local` trees until their owned runtime data is
  classified and the command cutover is proven.
- After cutover, delete old active-profile resolution and shared-local
  bootstrap code; no compatibility shim remains.
- Quiesce all Acceptance writers before evidence migration.
- Prefer an atomic same-volume directory rename. If unavailable, copy,
  validate every immutable run and aggregate file/byte counts, atomically
  switch the resolver, then delete the legacy root.
- Do not use symlinks, dual writes, dual reads, or fallback from the target
  Evidence Store to the legacy product path.
- CI retains explicit `PT_ACCEPTANCE_ARTIFACT_ROOT`; local development uses the
  canonical Dev Control Plane root without configuration.
- Repository root must not contain tracked or untracked `debug-*`, `.dbg/`,
  runtime logs, traces, screenshots, DOM dumps, or ad-hoc test prompts.
- New debug sessions write under
  `~/.peers-touch/dev/workspaces/<workspaceId>/debug/<sessionId>/` and are
  removed when closed. Durable findings are promoted to formal docs,
  operational knowledge, or Acceptance evidence.

## 6. Verification

Implementation must include:

```text
register -> bind independently -> allocate slot -> acquire lease -> run
  -> observe -> release -> report
```

Required negative fixtures:

- Same basename, different canonical roots.
- Same profile, different worktrees.
- Same slot requested concurrently.
- Shared connect plus exclusive deploy.
- Competing deploy.
- Competing reset.
- Stale lock metadata with no live lock.
- Live process whose PID file points to another executable.
- Missing registry, malformed registry, and unsupported schema.
- Dirty/untracked environment repository definition.
- Missing or ambiguous remote target or credential.
- Mixed-case `stable` Profile requesting `station.reset`.
- Non-stable reset with missing binding capability, exact scope, current
  source identity, or OS lease.

Focused implementation verification:

```bash
node --test --test-timeout=1200000 \
  tooling/scripts/lib/machine-dev-paths.test.mjs \
  tooling/scripts/local-dev/*.test.mjs
```

Workflow Snapshot verification:

```bash
node --test tooling/scripts/local-dev/workflow-snapshot*.test.mjs
make workflow-snapshot
```

The snapshot contains current source, explicitly selected task-local records,
isolated task errors, and optional runtime status. It never infers a current
task, joins historical workflow stores, or turns task progress into runtime
intent or occupancy.

Lifecycle verification proves Workflow Snapshot emits one document and exits
without opening a listener, browser, PID file, background process, or runtime
lease.

The lease suite launches isolated child processes for every required lease
class and proves contention plus release on success, command failure, signal,
timeout, and stale metadata recovery. It does not contact a Station.

## 7. Acceptance Root Closure Contract

The old root is pollution to remove, not a compatibility surface to support.
Migration remains incomplete until every condition below holds:

1. Every worktree returned by `git worktree list` is recorded as
   `canonical-ready` in the run-scoped migration manifest, or is removed from
   the Git worktree registry. Discovery does not enroll it in the machine
   registry.
2. No process, live run, writer lock, or lease can still target the old root.
3. The target root contains every immutable run and valid `latest.json`
   pointer, with matching per-file hashes, manifest identities, file count,
   logical byte count, and allocated byte accounting.
4. The canonical resolver and tests reject the product Application Support
   namespace and expose no old-root fallback.
5. The old root is deleted and a second filesystem observation confirms it is
   absent.
6. The machine registry drops `legacyAcceptanceEvidence` and the entire
   `acceptanceEvidenceMigration` object.
7. Active architecture, platform, skill, and operational docs remove the
   legacy migration branch. Only the closed ADR and immutable completion
   receipt may retain historical context.

## 8. Registration And Activity Rules

- `make profile <name>` and `make env-register` are the only operations that
  enroll the current `workspaceId`. The former is the normal explicit
  first-use path with atomic free-slot allocation; non-stable remote Profiles
  receive connect+deploy while stable/local/compose Profiles receive connect
  only. The latter accepts purpose metadata, profile, capability set, and slot.
- `make profiles`, `git worktree list`, repository scans, and old
  `.local/dev/active` pointers are discovery only.
- `make env-status-all` lists registered worktrees first, then separately
  reports unregistered observations and potential risks.
- `active` requires a matching live process/listener or lease. A selected
  profile, recent commit, active project plan, or open IDE window is
  insufficient.
- An idle registration retains its allocation but is reported as `idle`, not
  active.
- A registration with root or branch drift blocks mutation until repaired or
  explicitly removed. Advancing HEAD on the registered branch does not make
  the binding stale.

The implementation must provide a stable completion Gate:

```bash
python3 tooling/scripts/local-dev-control-plane-audit.py \
  --require-no-legacy-acceptance-root
```

The Gate owns the closed forbidden-pattern set and scans runtime code, active
docs, skills, and the live machine registry. During migration it must report the
remaining owners. After closure it must return zero. Closed ADRs, immutable
migration receipts, and historical execution plans may retain audit context but
cannot be imported or executed as current runtime policy.
