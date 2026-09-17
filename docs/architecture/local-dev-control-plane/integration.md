# Local Dev Control Plane - Integration

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-13 | **Updated**: 2026-09-13
> **Owner**: Platform Team
> **Module**: `tooling/scripts/local-dev/`

---

## 1. Existing System Mapping

| Existing path | Current role | Target role |
|---------------|--------------|-------------|
| `env/peers-touch/<profile>/` | Profile and deploy topology | Remains canonical topology owner |
| `<worktree>/.local/dev/profiles/` | Imported cache or authorized local compose profile | Cache is not authority; local profile requires a digest-bound receipt |
| `<worktree>/.local/dev/active/` | Legacy worktree profile pointer | No runtime reader; replaced by machine registry binding |
| `<worktree>/.local/dev/pids|logs|data/` | Legacy worktree/profile runtime state | New runtime state resolves under the workspace-scoped global dev root |
| `<worktree>/.local/deploy/envs/` | Legacy imported deploy cache | Never deployment authority; deploy resolves a unique tracked-clean env-repository definition |
| `/tmp/peers-touch-profile-leases/` | Legacy Acceptance/deploy live locks | Not used by canonical `make station`; replaced by one machine control-plane lease root |
| `~/.peers-touch/dev/registry.json` | Observed snapshot until explicit promotion | Authoritative after `make env-register` |
| `~/Library/Application Support/PeersTouch/acceptance/` | Legacy Acceptance Evidence Store | One-time verified move to `~/.peers-touch/dev/acceptance/` |

The migration must be atomic at the runtime command boundary. There must not be
permanent dual-read precedence between global registry and `.local/dev/active`.

## 2. Target Directory Layout

```text
~/.peers-touch/dev/
├── README.md
├── registry.json
├── registry.lock
├── work.json
├── work.lock
├── authorizations/
│   └── environment-creation/
│       ├── pending/
│       ├── claims/
│       └── receipts/
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
| `make env-update` | Atomically refresh the registered Git identity or replace requested binding fields while no lease is held |
| `make env-check` | Verify current root/ID/branch/HEAD, selected definition, slot, capabilities, target host, and budget |
| `make dev-start` | Publish and confirm source/runtime intent before mutation |
| `make dev-update` | Atomically replace the current work item's intent |
| `make dev-status-all` | Show all worktree declarations beside observed leases |
| `make dev-check` | Verify current worktree/branch/HEAD owns a live declaration |
| `make dev-release` | Release the work declaration after cleanup |
| `make profile-authorize <name> SLOT=<n>` | Human-only interactive grant for one exact local compose profile |
| `make profile-init <name> SLOT=<n>` | Consume the exact pending grant and persist a digest-bound receipt |
| `make profile <name>` | Call canonical `env-update` behavior for only the current `workspaceId` binding |
| `make config` | Resolve current binding + env definition + allocation |
| `make status` | Show current worktree declared and observed state |
| `make env-status-all` | Show all registered worktrees, conflicts, processes and leases |
| `make desktop[-web]` | Acquire current workspace `local.slot` lease |
| `make mobile` | Acquire current workspace `local.slot` lease |
| `make station-check` | Require `station.connect` |
| `make station` / restart | Require exclusive `station.deploy` |
| destructive Acceptance reset | Require exclusive `station.reset` plus explicit run authorization |

The generic reset lease API for the later destructive wrapper is:

```bash
node tooling/scripts/local-dev/machine-dev.mjs lease \
  --resource-kind station.reset \
  --resource-id <station-fixture-scope> \
  --reset-authorized-scope <station-fixture-scope> \
  --budget-seconds <seconds> \
  -- <reset-command>
```

It validates the authoritative binding, `allowedCapabilities`, exact active
Development intent, remote tracked-clean topology, and exact reset scope before
acquiring the OS lock. It does not itself authorize or implement deletion.

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
- Do not select a default profile for unbound worktrees.
- Do not assign slot 0 as a fallback.
- Do not create, copy, derive, or register an environment-repository profile,
  deploy environment, or local-only profile cache without explicit human
  developer approval for the exact environment name and target. A missing
  environment blocks execution and must be reported.
- Agents must not run `make profile-authorize` or create authorization files.
  Pending authorizations are short-lived and single-use; authorized local
  profiles must continue to match their consumed receipt digest.
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
- Missing profile with no explicit human authorization to create it.
- Expired, mismatched, reused, or digest-invalid environment authorization.

Focused implementation verification:

```bash
node --test --test-timeout=1200000 \
  tooling/scripts/lib/machine-dev-paths.test.mjs \
  tooling/scripts/local-dev/*.test.mjs
```

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

- `make env-register` is the only operation that enrolls the current
  `workspaceId`; it requires an Owner-provided purpose, profile, capability
  set, and slot or allocation request.
- `make profiles`, `git worktree list`, repository scans, and old
  `.local/dev/active` pointers are discovery only.
- `make env-status-all` lists registered worktrees first, then separately
  reports unregistered observations and potential risks.
- `active` requires a matching live process/listener or lease. A selected
  profile, recent commit, active project plan, or open IDE window is
  insufficient.
- An idle registration retains its allocation but is reported as `idle`, not
  active.
- A stale registration blocks mutation until repaired or explicitly removed.

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
