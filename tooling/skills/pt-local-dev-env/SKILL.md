---
name: pt-local-dev-env
description: Prepare worktree-isolated Peers-Touch development runtimes. Use for Profile selection, local setup, Station or client launch, deploy, restart, reset, status, and runtime contention.
---

# Local Dev Environment

Use the canonical Make and Machine Dev entrypoints. Detailed Profile fields,
mode behavior, port formulas, and command reference live in
[`docs/global/local-dev-environment.md`](../../../docs/global/local-dev-environment.md).

## Invoke When

- Selecting or creating a development Profile.
- Starting, stopping, restarting, or inspecting Station, Desktop, or Mobile.
- Deploying exact source to a reviewed remote development environment.
- Resetting disposable development data.
- Resolving slot, target, process, or lease contention.

Do not use this Skill for release publication, CI/CD, worktree creation, or
inventing remote topology.

## Core Rule

A reviewed non-stable Profile and the current workspace capability binding
authorize environment selection, registration, runtime provisioning, deploy,
restart, and exact-scope reset without another prompt.

Admission still requires:

- the user-selected canonical worktree and authoritative workspace binding;
- a reviewed Profile whose directory and `PT_DEV_PROFILE` identities match;
- the required capability and exact deploy target or reset scope;
- current prepared Git source identity;
- tracked-clean remote Profile and deploy definitions;
- the matching OS-held lease and post-lock revalidation.

Profile IDs ending in `stable`, case-insensitively, are protected:

- canonical selection grants only `station.connect`;
- deploy/restart requires a user-directed explicit `station.deploy` binding;
- `station.reset` is always rejected with `PROFILE_RESET_PROTECTED`.

Every other reviewed Profile is Agent-resettable. The Agent may add
`station.reset` when the task needs it, but must still supply the exact scope
and pass all admission checks.

## Profile Sources

Remote topology comes only from:

```text
../env/peers-touch/<profile>/profile.env.example
../env/peers-touch/<profile>/deploy/<environment>.env.example
```

Both definitions must be Git-tracked and clean. Never invent hosts,
credentials, deploy definitions, or `.local/deploy` fallbacks.

`make profile-init PROFILE=<name> SLOT=<n>` may create one non-overwriting
worktree-local compose Profile. Runtime accepts it only as a non-symlink
regular file directly under `.local/dev/profiles/`, owned by the current user,
private to that user, and containing shell-safe literal assignments. A local
Profile never grants remote deploy or reset. The resolver emits quoted exports;
normal development never executes the file with `source`.

## Workflow

1. Confirm the exact canonical worktree, then inspect current authority:

   ```bash
   make env-status-all
   make profiles
   ```

2. Reuse a reviewed Profile. Create a local compose Profile only when local
   topology is actually needed:

   ```bash
   make profile <name>
   make profile-init PROFILE=<name> SLOT=<n>
   ```

3. Use `make profile <name>` for normal selection. Use explicit registration
   or update only when slot or capability control is needed:

   ```bash
   make env-register PROFILE=<name> SLOT=<n> \
     CAPABILITIES='<csv>' PURPOSE='<text>'
   make env-update PROFILE=<name> CAPABILITIES='<csv>'
   ```

4. Preflight the binding, current source, Profile, target, and capabilities:

   ```bash
   make env-check
   make config
   ```

5. Execute through canonical owners:

   ```bash
   make station
   make desktop
   make mobile
   make status
   ```

   Desktop verification uses the native Tauri app. Do not substitute a
   browser shell or invoke Station binaries directly.

6. For reset, call the canonical lease wrapper with the exact same
   `resource-id` and `reset-scope`. Hold one lease across pre-audit, mutation,
   nested Station readiness, and post-audit.

7. On contention, inspect live leases, PID/process-start identity, target, and
   current task facts. Reuse, serialize, or choose a non-conflicting slot or
   target when deterministic. Ask the user only when ownership or safe ordering
   cannot be established.

8. Unregister only as part of an explicitly authorized worktree removal, after
   the exact workspace owns no live lease. Never edit registry rows by hand.

## Source Sync Boundary

Remote exact-source verification requires a commit because uncommitted changes
are not deployable. A local checkpoint commit may therefore precede Journey or
Acceptance verification and does not imply delivery.

`direct` and `central` source modes force-update only:

```text
refs/peers-touch/deploy/<environment>/<branch>
```

inside a dedicated deployment transport repository. This is Profile-authorized
source transport, not publication of a collaboration branch, delivery, or
permission to push origin/GitHub. Push, PR, merge, release, and history rewrite
remain separately governed.

## Verification

- `make env-check` and `make config` pass for the selected worktree.
- The selected Profile reports the expected derived reset policy.
- Remote definitions are tracked and clean, and deploy host matches Station
  URL identity.
- `/app-meta/version` reports the current checkpoint commit after deploy.
- Required leases remain held through the full operation and release on every
  terminal path.
- `node --test tooling/scripts/local-dev/machine-dev.test.mjs` passes after
  control-plane changes.

## Anti-Patterns

Never:

- infer Profile or slot from another worktree, branch, basename, legacy active
  symlink, or task record;
- ask again for non-stable operations already covered by Profile capabilities;
- grant stable mutation by default or attempt stable reset;
- source an unvalidated worktree-local Profile;
- bypass Make, capability checks, exact target/scope, source fencing, or lease;
- treat an internal deployment ref update as collaboration push or delivery;
- ask the user to resolve a resource conflict before inspecting facts and
  trying deterministic reuse or serialization.

## Service Coordination & Troubleshooting

When encountering cross-service issues (Circuit reservation rejected, DHT seeds
not connecting, federation resolve failing, session kicked after Station
redeploy), consult:

- **`docs/architecture/platform/runtime/service-coordination.md`** - Dependency DAG, credential
  contracts (Relay invite -> node enrollment -> reservation/route), bootstrap
  node requirements, and troubleshooting index.

Key diagnostics:

- `curl <station>/actor/federation/health` - check DHT readiness and seed status.
- Inspect Station logs for Relay enrollment, reservation, and route-publication errors.
- For "Circuit reservation rejected", verify node enrollment generation, ACL
  admission, Relay public address, and the current Station route.
