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

Prepare the development environment through the cross-platform `devctl`
control plane. On Windows use `tooling/dev.ps1`; on every platform the direct
Node entrypoint has the same contract:

```bash
node tooling/devctl/index.mjs config
node tooling/devctl/index.mjs doctor
node tooling/devctl/index.mjs station start
node tooling/devctl/index.mjs desktop start --mode app
node tooling/devctl/index.mjs desktop start --mode web
node tooling/devctl/index.mjs status
node tooling/devctl/index.mjs stop all
```

Make targets are compatibility forwarders. Relay and Mobile iOS remain legacy,
platform-specific workflows and are outside devctl ownership.

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
4. Verify `PT_STATION_DEPLOY_ENV` is non-empty and matches the user-approved
   remote node.
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
authority for a same-named environment-repository profile.

One profile is **active** per worktree. The symlink at
`.local/dev/active/<worktree-name>.env` selects its name; all `make` commands
resolve that name back to the canonical environment repository before use.

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

Default slot = 0.

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
# Profile management
node tooling/devctl/index.mjs profile list
node tooling/devctl/index.mjs profile activate <name>
node tooling/devctl/index.mjs profile init <name> --slot <n>
node tooling/devctl/index.mjs config
node tooling/devctl/index.mjs doctor

# Managed services
node tooling/devctl/index.mjs station start
node tooling/devctl/index.mjs station check
node tooling/devctl/index.mjs station status
node tooling/devctl/index.mjs desktop start --mode app
node tooling/devctl/index.mjs desktop start --mode web

# Managed lifecycle
node tooling/devctl/index.mjs status
node tooling/devctl/index.mjs stop all
node tooling/devctl/index.mjs restart all
node tooling/devctl/index.mjs station stop
node tooling/devctl/index.mjs station restart
node tooling/devctl/index.mjs desktop stop --mode app
node tooling/devctl/index.mjs desktop restart --mode web

# Legacy non-devctl workflows
make station-logs                           # Station logs
make relay                                  # Prepare Relay
make relay-check                            # Health-check Relay only
make relay-status                           # Relay deployment/runtime status
make relay-logs                             # Relay logs
make mobile                                 # Mobile iOS Simulator
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
make profile-init PROFILE=local-dev SLOT=0
make profile PROFILE=local-dev
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
make profile PROFILE=remote-s1
make station   # Deploy/restart/check remote Station
make desktop   # Connects to 10.37.246.80
make mobile    # Connects to 10.37.246.80
```

### Recipe: Second worktree running simultaneously (Human Local Mode)

This local/compose example is documentation for human developers. Agents must
instead configure and preflight an approved remote Station profile.

```bash
# In worktree-2, use slot=1 to avoid port conflicts
make profile-init PROFILE=worktree-2 SLOT=1
make profile PROFILE=worktree-2
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
Bob on station-five-arm), deploy both using separate profiles:

```bash
# 1. Create/activate profile for station-four
make profile-init PROFILE=multi-four SLOT=0
make profile PROFILE=multi-four
# Set in env/peers-touch/four/profile.env:
#   PT_STATION_MODE=remote
#   PT_STATION_URL=http://10.37.94.156:18132
#   PT_STATION_DEPLOY_ENV=four
make station          # Deploy/restart/check station-four

# 2. Switch to profile for station-five-arm
make profile-init PROFILE=multi-five-arm SLOT=1
make profile PROFILE=multi-five-arm
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

1. **Bootstrap/check existing profiles**: `make profiles`
2. **Select remote only**: reuse a canonical environment-repository profile that sets
   `PT_STATION_MODE=remote`.
3. **Create if needed**: add a distinctly named profile and deploy environment
   under `env/peers-touch/<name>/`; do not repurpose an existing environment
   name or edit only its `.local` cache.
4. **Configure**: set the approved remote Station URL and deploy environment in
   that canonical environment source.
5. **Activate**: `make profile <name>`.
6. **Fail-closed preflight**: run `make config` and verify remote mode,
   non-loopback URL, and approved non-empty deploy environment.
7. **Execute**: only after preflight may the agent run `make station`,
   `make desktop`, `make mobile`, or related lifecycle/Acceptance commands.
8. **Report**: include the resolved mode, Station URL, and deploy environment.

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

- `.local/` is its own git repo (gitignored by main repo, versioned separately)
- Deployable profiles and deploy envs are authoritative in the sibling `env`
  repository; `.local/` stores imported caches and runtime state
- `make profiles` and `make profile <name>` bootstrap missing profiles/deploy envs from the shared `.local/` used by sibling worktrees.
- Runtime artifacts (pids/logs/data) and active pointers are gitignored within `.local/`
- Each worktree has its own active profile pointer (keyed by worktree basename)
- Multiple worktrees share one `.local/` via symlink; pids/logs/data are profile-scoped
- `make station` is idempotent — if Station is already running, it just confirms
- Agent use of `make station` is remote-only and requires the safety preflight
  above. Local/compose Station execution is reserved for human developers.
- `make desktop`, `make desktop-web`, `make mobile`, and restart targets may
  ready Station indirectly, so the same agent preflight applies to them.
- `make desktop` / `make mobile` always ensure Station is ready first
- Never hardcode station URLs in code — they come from the profile
- PIDs/logs/data live in `.local/dev/{pids,logs,data}/<profile-name>/`

## `.local/` Runtime Cache

`.local/` is a standalone git repo used for imported configuration caches and
runtime state. The sibling `env` repository remains authoritative for every
same-named deployable profile and deploy environment.

**Cached configuration**:
- `dev/profiles/*.env` — imported profile cache or human-only local profile
- `deploy/envs/*.env` — imported deploy-env cache
- `topology.env` — network topology reference

**Ignored** (runtime, never committed):
- `dev/pids/` — PID files per profile
- `dev/logs/` — log files per profile
- `dev/data/` — data files per profile
- `dev/active/` — per-worktree active profile symlinks

### Cross-worktree sharing

All worktrees symlink `.local/` to the same directory:

```bash
# In another worktree:
ln -sfn /path/to/primary-worktree/.local .local
```

Each worktree has its own active profile pointer at
`.local/dev/active/<worktree-basename>.env`. The pointer selects a profile
name; runtime commands load the canonical sibling-environment profile for that
name when it exists. Switching profiles in one worktree therefore does not
affect another worktree.

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
