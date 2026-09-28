---
name: pt-local-dev-env
description: >
  Set up worktree-isolated local development environment using profiles.
  Use when the user wants to run Desktop, Mobile, or Station locally, or
  connect to a remote Station. Agents may operate remote Station profiles
  only; local/compose Station modes are reserved for human developers.
---

# Local Dev Environment

## Goal

Prepare the development environment so the user can simply run:

```bash
make station       # Ready Station (local start / remote deploy)
make relay         # Ready Relay (remote deploy)
make desktop       # Start Desktop (Tauri app)
make desktop-web   # Start Desktop (browser)
make mobile        # Start Mobile iOS Simulator
make status        # Check what's running
make stop          # Stop everything
make restart       # Restart everything
```

The agent's job is to resolve and activate an existing approved **profile** for
the user's scenario. The verified canonical Profile ID is the sole reset-policy
input: IDs containing `stable` case-insensitively are reset-protected; every
other reviewed Profile is Agent-resettable. Creating a profile or deploy
environment still requires explicit human approval for the exact environment
name and target.

## Environment Creation Authorization

AI agents MUST NOT create, copy, derive, or register a development profile or
deploy environment without that explicit authorization. This includes:

- adding `env/peers-touch/<name>/` definitions;
- writing local-only `.local/dev/profiles/` or `.local/deploy/envs/` entries;
- supplying an arbitrary `PT_DEV_PROFILE_FILE` outside a bounded Acceptance
  runtime-manifest profile root;
- running `make profile-authorize`, minting an authorization file, or running
  `make profile-init` without a pre-existing exact grant; and
- inferring creation permission from mere Plan existence, an Acceptance
  requirement, available host, old pointer, task scope, or a Plan field that
  does not explicitly authorize environment creation.

A missing environment is a fail-closed blocker to report. Untracked or
dirty env-repository definitions cannot authorize profile selection,
deployment, restart, or reset. A machine-local compose profile is usable only
when it matches a consumed human-created authorization receipt.

## Agent Station Safety Boundary

Local and compose-managed Station support exists for human developers only.
AI agents MUST NOT start, restart, probe, test against, or otherwise access a
Station whose active profile resolves to:

- `PT_STATION_MODE=local` or `PT_STATION_MODE=compose`;
- `127.0.0.1`, `localhost`, or another loopback Station URL;
- an empty or unapproved remote deploy environment.

Before an agent runs `make station`, `make station-restart`, `make restart`,
`make desktop`, `make desktop-web`, `make mobile`, or any test/Acceptance
command that may ready or access Station, it MUST:

1. Run `make config`.
2. Resolve the active worktree profile.
3. Verify `PT_STATION_MODE=remote`.
4. Verify `PT_STATION_DEPLOY_ENV` is non-empty and matches the exact remote node
   authorized by the user or by the accepted Plan's
   `authorization.runtime.deployProfiles`.
5. Verify `PT_STATION_URL` is non-loopback and matches that same node.

Any missing, ambiguous, local, compose, loopback, or mismatched value is a
fail-closed stop. The agent must not rely on defaults because the runtime
scripts default to local/loopback behavior. `make station` is permitted for an
agent only after this remote-profile preflight; in that case it performs the
remote deploy/restart/health closure.

## Core Concepts

### Profile

A deployable profile is canonically defined in the sibling environment
repository at `env/peers-touch/<name>/profile.env.example`. The
`.local/dev/profiles/<name>.env` file is an imported cache and is never the
authority for a same-named environment-repository profile. The only
machine-local authority is a human-authorized compose profile whose bytes match
its consumed environment-creation receipt.

Remote deploy environments resolve directly from exactly one Git-tracked, clean
`env/peers-touch/<profile>/deploy/<name>.env.example`. A
`.local/deploy/envs/` copy is not deployment authority.

The profile directory name and `PT_DEV_PROFILE` value must match exactly. After
that identity check, derive reset policy from the canonical ID:

- ID contains `stable`, case-insensitive: `stable-protected`; autonomous reset
  is denied with `PROFILE_RESET_PROTECTED`.
- ID does not contain `stable`: `agent-resettable`; the Agent may choose reset
  without human involvement.

There is no reset-policy field or legacy fallback. Resettable does not mean
unbounded: `station.reset` must still be present in the workspace binding and
live Development declaration, the declaration and command must name the same
exact scope, topology and source identity must match, and the OS lease must be
held. Profile creation and renaming remain human-reviewed.

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
| Desktop Web gateway | `3031 + slot * 100` |
| Desktop Web vite | `3211 + slot * 100` |
| Mobile web | `5173 + slot * 100` |

There is no implicit slot from Profile metadata. First explicit
`make profile <name>` selection allocates the lowest free machine slot under
the registry lock; an explicit `env-register` may choose another slot. Profile
`PT_DEV_SLOT` and local client port fields are legacy metadata; the machine
binding supplies the runtime values.

### Station Mode

- `local` / `compose` — human-developer-only modes; `make station` runs Station
  on the current machine. Agents MUST NOT activate or execute these modes.
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
make env-check [WORKSPACE_ID=<id>] [PROFILE=<name>] [SLOT=<n>] [CAPABILITIES='<csv>'] [BUDGET_SECONDS=<n>]
make env-status-all                         # Bindings plus observed OS-held leases
make profiles                               # List approved canonical profiles
make profile <name>                         # Register on first use, then update this workspace binding
make profile-authorize <name> SLOT=<n>      # Human-only interactive grant
make profile-init <name> SLOT=<n>           # Consume a pre-existing exact grant
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
make desktop-web                            # Desktop in browser
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
PT_DESKTOP_WEB_GATEWAY_PORT=<port>
PT_DESKTOP_WEB_WEB_PORT=<port>

# Mobile
PT_MOBILE_WEB_PORT=<port>
PT_MOBILE_DEFAULT_STATION_URL=http://<host>:<port>
```

## Recipes

### Recipe: Local Station + Desktop + Mobile (Human Only)

This recipe is documentation for human developers. Agents MUST NOT execute it.

```bash
make profile-authorize PROFILE=local-dev SLOT=0
make profile-init PROFILE=local-dev SLOT=0
make env-register \
  PROFILE=local-dev \
  SLOT=0 \
  CAPABILITIES=station.connect \
  PURPOSE='Human local development'
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

### Recipe: Second worktree running simultaneously (Human Local Mode)

This local/compose example is documentation for human developers. Agents must
instead configure and preflight an approved remote Station profile.

```bash
# In worktree-2, use slot=1 to avoid port conflicts
make profile-authorize PROFILE=worktree-2 SLOT=1
make profile-init PROFILE=worktree-2 SLOT=1
make env-register \
  PROFILE=worktree-2 \
  SLOT=1 \
  CAPABILITIES=station.connect \
  PURPOSE='Human local development in worktree-2'
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
Bob on station-five-arm), deploy both using separate approved profiles. The
creation commands below are human-developer examples; an agent may execute them
only when the human developer has already created grants for both exact profile
names and targets:

```bash
# 1. Create/register profile for station-four
make profile-authorize PROFILE=multi-four SLOT=0
make profile-init PROFILE=multi-four SLOT=0
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
make profile-authorize PROFILE=multi-five-arm SLOT=1
make profile-init PROFILE=multi-five-arm SLOT=1
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
   `PT_DEV_PROFILE`, then apply a case-insensitive `stable` substring check.
3. **Select remote only**: reuse a canonical environment-repository profile that sets
   `PT_STATION_MODE=remote`.
4. **Missing profile means stop**: report the missing topology and request
   explicit human developer authorization. Do not run `make profile-authorize`,
   create authorization files, create `env/peers-touch/<name>/`, or add a
   local-only fallback.
5. **Configure**: set the approved remote Station URL and deploy environment in
   that canonical environment source only when the developer explicitly
   authorized creating or changing it.
6. **Register or update the existing Profile**: the Agent may run
   `make env-register`, `make profile`, or `make env-update` without a repeated
   approval prompt. It may add `station.reset` for a non-stable Profile when
   the task requires it. None of these commands creates an environment.
7. **Fail-closed preflight**: run `make env-check` and `make config`; verify
   canonical workspace identity, tracked-clean definition, allocated slot,
   allowed capabilities, remote mode, non-loopback URL, and exact deploy-host
   match.
8. **Declare runtime intent**: the active Development declaration must contain
   the exact profile and exclusive runtime resource before an Agent acquires
   the lease. A human invoking `make station` directly uses its bounded
   `make.station` owner action and does not run this internal step.
9. **Execute**: only after preflight may the agent run `make station`,
   `make desktop`, `make mobile`, or related lifecycle/Acceptance commands.
   Desktop startup automatically installs missing workspace packages from the
   committed lockfile and runs the source-aware Station ready closure.
10. **Report**: include workspace ID, slot, capabilities, derived reset policy,
    Station URL, deploy environment, and lease result.

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
- Agents must not create or register profiles or deploy environments without
  explicit human developer approval for the exact name and target.
- The canonical Profile ID is the only reset-policy source. A case-insensitive
  `stable` substring blocks autonomous reset; every other reviewed Profile is
  Agent-resettable.
- Non-stable reset requires an exact user or accepted Plan
  `destructiveResetScopes` grant, the binding capability, live declaration,
  exact scope, matching topology/source identity, and live lease. Once every
  guard matches, execute without another approval prompt.
- An accepted Plan `authorization.runtime.deployProfiles` entry is explicit
  deploy authorization for that existing reviewed profile. It must be consumed
  directly and never converted into another user confirmation.
- `make profile-authorize` is human-only. Agents may consume only an existing,
  unexpired exact-tuple grant through `make profile-init`.
- Agents may select only approved canonical env-repository definitions; a
  local-only fallback discovered by `make profiles` or `make profile <name>`
  must fail closed.
- `make env-register` is an explicit workspace registration, not permission to
  create or edit a profile.
- Legacy `.local/dev/active/` pointers never select a runtime profile.
- Runtime PIDs/logs/data live under
  `~/.peers-touch/dev/workspaces/<workspaceId>/runtime/<profile>/`.
- `local.slot`, `station.deploy`, and `station.reset` possession requires the
  canonical OS-held lease plus matching PID/process-start metadata.
- Agent-driven runtime work requires a live Development declaration before
  lease acquisition. A direct human `make station` invocation may acquire only
  the exact `station.deploy` lease through the bounded `make.station` owner
  action. Neither path substitutes for the OS-held lease, and no owner action
  bypass exists for `station.reset`.
- `make station` is idempotent — it reuses an already healthy Station only when
  `/app-meta/version` reports a build commit matching the current local HEAD;
  stale or missing build identity triggers exact-source deployment
- `make station` holds `station.deploy` through source sync, build, restart,
  deploy health, and final profile health readback.
- Agent use of `make station` is remote-only and requires the safety preflight
  above. Local/compose Station execution is reserved for human developers.
- `make desktop`, `make desktop-web`, `make mobile`, and restart targets may
  ready Station indirectly, so the same agent preflight applies to them.
- `make desktop` / `make desktop-web` install missing package dependencies with
  frozen-lockfile semantics and always ensure Station is source-current before
  starting the client.
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

`.local/dev/profiles/*.env` remains only for human-authorized local compose
definitions whose bytes match a consumed receipt. `.local/deploy/envs/` and
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

When encountering cross-service issues (relay-client not registered, DHT seeds
not connecting, federation resolve failing, session kicked after Station
redeploy), consult:

- **`docs/architecture/service-coordination.md`** — Dependency DAG, credential
  contracts (relay invite → mount → token), bootstrap node requirements, and
  troubleshooting index.

Key diagnostics:
- `curl <station>/actor/federation/health` — check DHT readiness and seed status
- Station logs: grep `relay-client` for mount errors
- "relay-client not registered" → Station needs a relay invite token (§8 of the doc)
