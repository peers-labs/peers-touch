---
name: pt-local-dev-env
description: >
  Set up worktree-isolated local development environment using profiles.
  Use when the user wants to run Desktop, Mobile, or Station locally, or
  connect to a remote Station. Reviewed non-stable Profiles may be operated
  autonomously in local, compose, or remote mode.
---

# Local Dev Environment

## Goal

Prepare the development environment so the user can simply run:

```bash
make station       # Ready Station (local start / remote deploy)
make relay         # Ready Relay (remote deploy)
make desktop       # Start Desktop (Tauri app)
make mobile        # Start Mobile iOS Simulator
make status        # Check what's running
make stop          # Stop everything
make restart       # Restart everything
```

The agent resolves or creates a **Profile** for the selected worktree, then uses
the canonical Make entrypoints. The verified Profile ID is the sole
reset-policy input: IDs ending in `stable` case-insensitively are protected;
every other reviewed Profile is Agent-resettable.

## Operation Policy

- Existing reviewed non-stable Profiles authorize selection, registration,
  runtime provisioning, deploy, restart, and exact-scope reset within their
  declared capabilities. Do not ask for another approval.
- `make profile-init` may create one non-overwriting worktree-local compose
  Profile. No authorization receipt is required.
- Remote mutation requires one Git-tracked, clean Profile and deploy definition
  from the sibling environment repository. Never invent a host, credential, or
  local deploy fallback.
- New remote topology is a normal source change only when the environment
  repository is explicitly selected in task scope.
- Stable Profile reset is denied. Other stable mutations require explicit user
  direction.
- Every operation still validates the canonical worktree binding, capability,
  target or reset scope, current source identity, topology, and OS-held lease.

## Core Concepts

### Profile

A deployable profile is canonically defined in the sibling environment
repository at `env/peers-touch/<name>/profile.env.example`. The
`.local/dev/profiles/<name>.env` file is an imported cache and is never the
authority for a same-named environment-repository profile. The only
machine-local definition is a worktree-local compose Profile created through
`make profile-init`.

Remote deploy environments resolve directly from exactly one Git-tracked, clean
`env/peers-touch/<profile>/deploy/<name>.env.example`. A
`.local/deploy/envs/` copy is not deployment authority.

The profile directory name and `PT_DEV_PROFILE` value must match exactly. After
that identity check, derive reset policy from the canonical ID:

- ID ends in `stable`, case-insensitive: `stable-protected`; autonomous reset
  is denied with `PROFILE_RESET_PROTECTED`.
- ID does not end in `stable`: `agent-resettable`; the Agent may choose reset
  without human involvement.

There is no reset-policy field or legacy fallback. Resettable does not mean
unbounded: `station.reset` must still be present in the workspace binding and
the command must name the exact scope, topology and current source identity
must match, and the OS lease must be held. Remote Profile creation remains a
tracked source change; local Profile creation is worktree-scoped setup.

One profile is bound per registered worktree in
`~/.peers-touch/dev/registry.json`, keyed by canonical `workspaceId`.
`make profile PROFILE=<name>` explicitly creates a minimum binding on first
selection and updates that authoritative binding thereafter. First selection
atomically allocates the lowest free slot and grants `station.connect`, plus
`station.deploy` for a reviewed remote Profile. It never grants
`station.reset`. Legacy `.local/dev/active/` symlinks are observations only and
are never runtime selection authority.

### Slot

Slot controls port allocation. Multiple worktrees use different slots to avoid
port conflicts:

| Service | Port formula |
|---------|--------------|
| Station | `18080 + slot * 100` |
| Desktop App gateway | `3030 + slot * 100` |
| Desktop App web | `3210 + slot * 100` |
| Mobile web | `5173 + slot * 100` |

There is no implicit slot from Profile metadata. First explicit
`make profile <name>` selection allocates the lowest free machine slot under
the registry lock; an explicit `env-register` may choose another slot. Profile
`PT_DEV_SLOT` and local client port fields are legacy metadata; the machine
binding supplies the runtime values.

### Station Mode

- `local` / `compose` — `make station` runs Station on the current machine.
  Agents may operate non-stable Profiles through the canonical entrypoint.
- `remote` — `make station` runs the remote ready closure:
  pull code via deploy env, build, restart, then health-check. A remote Station
  profile MUST set `PT_STATION_DEPLOY_ENV`.

Use `make station-check` only when the user explicitly wants health-check only.

### Relay Mode

- `local` — local relay runner is not implemented yet
- `remote` — `make relay` runs the remote ready closure:
  pull code via deploy env, build, restart, then health-check. A remote Relay
  profile MUST set `PT_RELAY_DEPLOY_ENV`.

Use `make relay-check` only when the user explicitly wants health-check only.

## Commands Reference

```bash
# Machine binding and profile management
make env-register PROFILE=<name> SLOT=<n> CAPABILITIES='<csv>' PURPOSE='<text>'
make env-update [PROFILE=<name>] [SLOT=<n>] [CAPABILITIES='<csv>']
make env-unregister [WORKSPACE_ID=<id>]       # After coordinated close, before worktree removal
make env-check [WORKSPACE_ID=<id>] [PROFILE=<name>] [SLOT=<n>] [CAPABILITIES='<csv>'] [BUDGET_SECONDS=<n>]
make env-status-all                         # Bindings plus observed OS-held leases
make profiles                               # List approved canonical profiles
make profile <name>                         # Register on first use, then update this workspace binding
make profile-init <name> SLOT=<n>           # Create a worktree-local compose Profile
make config                                 # Show authoritative binding and config

# Services
make station                                # Start/verify Station
make station-check                          # Health-check Station only
make station-status                         # Station deployment/runtime status
make station-logs                           # Station logs
make relay                                  # Prepare Relay
make relay-check                            # Health-check Relay only
make relay-status                           # Relay deployment/runtime status
make relay-logs                             # Relay logs
make desktop                                # Desktop Tauri app
make mobile                                 # Mobile iOS Simulator

# Lifecycle
make status                                 # Show running services
make stop                                   # Stop all
make restart                                # Restart all
make station-stop                           # Stop Station only
make station-restart                        # Restart Station only
make desktop-stop / desktop-restart
make mobile-stop / mobile-restart
```

## Profile Variables

```env
PT_DEV_PROFILE=<name>
PT_DEV_SLOT=<0-9>

# Station
PT_STATION_MODE=local|remote
PT_STATION_NAME=<label>
PT_STATION_URL=http://<host>:<port>
PT_STATION_PORT=<port>
PT_STATION_DB_NAME=<db_name>
PT_STATION_DEPLOY_ENV=<deploy-env-name>
PT_STATION_DEPLOY_BRANCH=<optional-branch>
PT_STATION_HEALTH_URL=<optional-health-url>

# Relay
PT_RELAY_MODE=local|remote
PT_RELAY_URL=<url>
PT_RELAY_DEPLOY_ENV=<deploy-env-name>
PT_RELAY_DEPLOY_BRANCH=<optional-branch>
PT_RELAY_HEALTH_URL=<optional-health-url>
PT_RELAY_MULTIADDR=<multiaddr>
PT_BOOTSTRAP_NODES=<multiaddr>

# Desktop
PT_DESKTOP_APP_GATEWAY_PORT=<port>
PT_DESKTOP_APP_WEB_PORT=<port>

# Mobile
PT_MOBILE_WEB_PORT=<port>
PT_MOBILE_DEFAULT_STATION_URL=http://<host>:<port>
```

## Recipes

### Recipe: Local Station + Desktop + Mobile

```bash
make profile-init PROFILE=local-dev SLOT=0
make env-register \
  PROFILE=local-dev \
  SLOT=0 \
  CAPABILITIES=station.connect \
  PURPOSE='Local development'
# Profile defaults are correct for local development
make station   # Compiles and starts Station
make desktop   # Starts Desktop
make mobile    # Starts Mobile
```

### Recipe: Remote Station (e.g. 10.37.246.80) + Local Desktop + Mobile

Define the deployable profile in the sibling environment repository:

```env
# env/peers-touch/remote-s1/profile.env.example
PT_STATION_MODE=remote
PT_STATION_URL=http://10.37.246.80:18080
PT_STATION_PORT=18080
PT_STATION_DEPLOY_ENV=station-1
PT_MOBILE_DEFAULT_STATION_URL=http://10.37.246.80:18080
```

```bash
make env-register \
  PROFILE=remote-s1 \
  SLOT=0 \
  CAPABILITIES='station.connect,station.deploy' \
  PURPOSE='Remote Station development'
make station   # Deploy/restart/check remote Station
make desktop   # Connects to 10.37.246.80
make mobile    # Connects to 10.37.246.80
```

### Recipe: Second worktree running simultaneously

```bash
# In worktree-2, use slot=1 to avoid port conflicts
make profile-init PROFILE=worktree-2 SLOT=1
make env-register \
  PROFILE=worktree-2 \
  SLOT=1 \
  CAPABILITIES=station.connect \
  PURPOSE='Local development in worktree-2'
make station   # Runs on :18180
make desktop   # Gateway on :3130, web on :3310
```

### Recipe: Connect to Relay

Edit the active profile:

```env
PT_RELAY_MODE=remote
PT_RELAY_URL=http://10.37.118.48:18081
PT_RELAY_DEPLOY_ENV=relay-1
PT_BOOTSTRAP_NODES=/ip4/10.37.118.48/tcp/4001/p2p/<relay-peer-id>
```

These variables are passed to Station at startup.

### Recipe: Multi-Station (e.g. cross-Station chat acceptance)

When acceptance scenarios require two Stations (e.g. Alice on station-four,
Bob on station-five-arm), deploy both using separate reviewed Profiles:

```bash
# 1. Register the reviewed profile for station-four
make env-register \
  PROFILE=multi-four \
  SLOT=0 \
  CAPABILITIES='station.connect,station.deploy' \
  PURPOSE='Multi-Station development'
# Set in env/peers-touch/four/profile.env:
#   PT_STATION_MODE=remote
#   PT_STATION_URL=http://10.37.94.156:18132
#   PT_STATION_DEPLOY_ENV=four
make station          # Deploy/restart/check station-four

# 2. Switch the existing workspace binding to station-five-arm
make env-update PROFILE=multi-five-arm SLOT=1
# Set in env/peers-touch/fiveArm/profile.env:
#   PT_STATION_MODE=remote
#   PT_STATION_URL=http://<fiveArm-host>:<port>
#   PT_STATION_DEPLOY_ENV=fiveArm
make station          # Deploy/restart/check station-five-arm

# 3. Switch back to the acceptance profile and run
make profile PROFILE=multi-four
# Acceptance scenarios use service_bindings in manifest to route each client
```

Both Stations remain running after deploy — `station-dev.sh` in remote mode
performs deploy/restart/check and returns. The acceptance environment contract
(`multi-station-linux.yaml`) declares both services and client bindings.

For agent automation: deploy both sequentially (switch profile, `make station`,
switch profile, `make station`), then run acceptance from either profile.
`PT_STATION_SKIP_DEPLOY=true` can reuse an already-running Station.

## Known Remote Stations (from .localenv topology)

| Name | URL | Notes |
|------|-----|-------|
| Station-1 | `http://10.37.246.80:18080` | direct=ON |
| Station-2 | `http://10.37.195.98:18080` | direct=ON |
| Relay | `http://10.37.118.48:18081` | bootstrap DHT seed |
| Station-4 | `http://10.37.195.98:18082` | relay-only, direct=OFF |

## Agent Workflow

When the user says "set up environment for X" or "I want to debug against Y":

1. **Inspect authority**: run `make env-status-all` and `make profiles`.
2. **Resolve reset policy**: verify the directory name equals
   `PT_DEV_PROFILE`, then apply a case-insensitive terminal `stable` check.
3. **Resolve the mode**: reuse a canonical environment-repository Profile or
   create a worktree-local compose Profile with `make profile-init`.
4. **Do not invent remote topology**: a missing remote host, credential, or
   deploy definition is a blocker unless the environment repository is
   explicitly in task scope for a tracked source change.
5. **Register or update the Profile**: the Agent may run
   `make env-register`, `make profile`, or `make env-update` without a repeated
   approval prompt. It may add `station.reset` for a non-stable Profile when
   the task requires it.
6. **Fail-closed preflight**: run `make env-check` and `make config`; verify
   canonical workspace identity, allocated slot, allowed capabilities, and
   exact topology. Remote mode additionally requires tracked-clean definitions,
   non-loopback URL, and deploy-host match. Current Git HEAD is not part of the
   durable registration; root or registered-branch drift remains fail-closed.
7. **Execute**: after preflight run `make station`,
   `make desktop`, `make mobile`, or related lifecycle/Acceptance commands.
8. **Report**: include workspace ID, slot, capabilities, derived reset policy,
    Station URL, deploy environment, and lease result.
9. **Remove explicitly**: when the user explicitly authorizes worktree
    removal, unregister the exact owned binding only after its OS-held leases
    are released. Do not delete registry rows by hand.

## Remote Deployment

Deploy code to remote hosts without pushing to GitHub first.
Uses a **central git server** (bare repo on a designated host) as the single source.
Local machine pushes there; all remote hosts fetch from it.

### Architecture

```
Local machine ──push via SSH──→ 80: bare repo
                                     │
                           ┌─────────┴─────────┐
                           ▼                     ▼
               80: working repo              48: working repo
               (local path fetch)            (git daemon fetch)
```

### One-Time Setup

```bash
make setup-git-server    # Creates bare repo + starts git daemon on central server
```

Configuration: `.local/deploy/git-server.env`:

```env
PT_GIT_SERVER_HOST=10.37.246.80
PT_GIT_SERVER_USER=shuxian
PT_GIT_SERVER_BARE_PATH=peers-touch/bare.git
PT_GIT_SERVER_DAEMON_PORT=9418
```

### Commands

```bash
make station                         # Push + deploy + build + restart + health
make relay                           # Same for relay
make deploy ENV=station-1            # Direct deploy (same as make station)
make deploy ENV=station-1 BRANCH=x   # Deploy specific branch
make deploy-status ENV=station-1     # Check remote status
make deploy-logs ENV=station-1       # Fetch remote logs
make setup-git-server                # One-time: init bare repo + daemon
```

### Deploy Env Config

Create `.local/deploy/envs/<name>.env`:

```env
PT_DEPLOY_HOST=10.37.246.80
PT_DEPLOY_USER=shuxian
PT_DEPLOY_PATH=peers-touch/repo
PT_DEPLOY_ROLE=station
PT_DEPLOY_SOURCE=central
PT_DEPLOY_HEALTH_URL=http://10.37.246.80:18080/sub-oss/healthz
PT_DEPLOY_BUILD_CMD='docker compose -f tooling/docker/compose.yml build station'
PT_DEPLOY_RESTART_CMD='docker compose -f tooling/docker/compose.yml up -d station'
```

Source modes:
- `central` — (recommended) push to central bare repo, remotes fetch from it
- `local` — (legacy) local git daemon + SSH reverse tunnel
- `github` — remote fetches from GitHub origin

### How it works (central mode)

1. `make station` pushes current HEAD to central bare repo (80) via SSH
2. If target IS the git server: fetch from local path (instant)
3. If target is another host: fetch from git daemon on git server (LAN speed)
4. Build → Restart → Health check
5. Full ready closure: won't return until service is verified healthy

## Important Rules

- `~/.peers-touch/dev/registry.json` is the only worktree binding and slot
  authority; an observed snapshot is not authority.
- Deployable profiles and deploy envs are authoritative in the sibling `env`
  repository; remote deploy resolves them directly.
- Agents may create worktree-local Profiles through `make profile-init`.
  Remote topology must remain tracked, clean, and explicitly scoped source.
- The canonical Profile ID is the only reset-policy source. A case-insensitive
  terminal `stable` suffix blocks autonomous reset; every other reviewed Profile is
  Agent-resettable.
- Non-stable reset requires the binding capability, exact scope, matching
  topology/source identity, and live lease. Once every guard matches, execute
  without another approval prompt.
- Existing reviewed non-stable Profiles authorize deploy and restart through
  their workspace capabilities; no Plan authorization field is required.
- `make env-register` is an explicit workspace registration, not permission to
  create or edit a profile.
- `make env-unregister` is a terminal cleanup operation. It requires the exact
  registration owner and rejects any OS-held lease. Deleted-worktree recovery
  uses the exact `WORKSPACE_ID`, not a guessed root.
- Legacy `.local/dev/active/` pointers never select a runtime profile.
- Runtime PIDs/logs/data live under
  `~/.peers-touch/dev/workspaces/<workspaceId>/runtime/<profile>/`.
- `local.slot`, `station.deploy`, and `station.reset` possession requires the
  canonical OS-held lease plus matching PID/process-start metadata.
- Runtime work requires the authoritative workspace capability, exact reviewed
  Profile and target or reset scope, prepared current source identity, and the
  OS-held lease. Task declarations, PlanMount, resource-plan receipts, OWNER
  bindings, and Hook receipts neither grant nor block acquisition.
- The machine registration never stores Git HEAD. Normal same-branch Git
  updates therefore need no `make env-update`; branch or root drift still
  fails closed. Runtime acquisition snapshots branch and HEAD before locking
  and revalidates both after the OS lease is held.
- `make station` is idempotent — it reuses an already healthy Station only when
  `/app-meta/version` reports a build commit matching the current local HEAD;
  stale or missing build identity triggers exact-source deployment
- `make station` holds `station.deploy` through source sync, build, restart,
  deploy health, and final profile health readback.
- Agent use of `make station` follows the selected Profile mode. Local, compose,
  and remote all use the same canonical preflight and lease owners.
- `make desktop`, `make mobile`, and restart targets may
  ready Station indirectly, so the same agent preflight applies to them.
- `make desktop` installs missing package dependencies with
  frozen-lockfile semantics and always ensure Station is source-current before
  starting the client.
- Desktop browser mode is unsupported; do not create or invoke a substitute
  browser launcher.
- `make mobile` always ensures Station is ready first.
- Profile files own runtime topology and allocation inputs. Repository
  manifests and lockfiles own source package dependencies; do not duplicate
  the package graph into Profile fields.
- Never hardcode station URLs in code — they come from the profile

## Machine State And Local Definitions

Machine allocation and runtime state:

```text
~/.peers-touch/dev/registry.json
~/.peers-touch/dev/leases/
~/.peers-touch/dev/workspaces/<workspaceId>/
```

`.local/dev/profiles/*.env` contains worktree-local compose definitions created
through `make profile-init`. `.local/deploy/envs/` and
`.local/dev/active/` are legacy observations and never deployment or selection
authority.

### Lease API

The destructive reset wrapper must call the generic canonical API and provide
the exact declared reset scope:

```bash
node tooling/scripts/local-dev/machine-dev.mjs lease \
  --resource-kind station.reset \
  --resource-id <station-fixture-scope> \
  --reset-scope <station-fixture-scope> \
  --budget-seconds <seconds> \
  -- <reset-command>
```

The wrapper must hold this one lease across pre-audit, deletion, nested
canonical `make station`, and post-audit. The lease API rejects a different
scope and does not implement deletion.

## Test Accounts

Built-in test users for debug and testing scenarios:

| User | Password | PIN |
|------|----------|-----|
| `a`  | `1`      | `111111` |
| `b`  | `1`      | `111111` |
| `c`  | `1`      | `111111` |

These accounts are pre-seeded in all Station environments (one/two/three).
Use them for local Desktop login, mobile login, E2E test runs, and acceptance
verification. When the agent needs to authenticate against a running Station,
use user `a` with password `1` and PIN `111111` unless instructed otherwise.

## Service Coordination & Troubleshooting

When encountering cross-service issues (Circuit reservation rejected, DHT seeds
not connecting, federation resolve failing, session kicked after Station
redeploy), consult:

- **`docs/architecture/platform/runtime/service-coordination.md`** — Dependency DAG, credential
  contracts (Relay invite → node enrollment → reservation/route), bootstrap
  node requirements, and troubleshooting index.

Key diagnostics:
- `curl <station>/actor/federation/health` — check DHT readiness and seed status
- Station logs: inspect Relay enrollment, reservation, and route-publication errors
- "Circuit reservation rejected" → verify node enrollment generation, ACL admission,
  Relay public address, and the current Station route (§6 of the doc)
