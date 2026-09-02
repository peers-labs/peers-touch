---
name: pt-local-dev-env
description: >
  Set up worktree-isolated local development environment using profiles.
  Use when the user wants to run Desktop, Mobile, or Station locally, or
  connect to a remote Station. Handles profile creation, configuration,
  activation, and service lifecycle. After this skill runs, the user only
  needs `make desktop`, `make mobile`, `make station` to start services.
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

The agent's job is to ensure a **profile** is created, configured correctly for
the user's scenario, and activated. Once that's done, all `make` commands work
without any additional flags.

## Core Concepts

### Profile

A profile is a `.env` file at `.local/dev/profiles/<name>.env`.
One profile is **active** per worktree (symlinked from `.local/dev/active/<worktree-name>.env`).
All `make` commands read the active profile automatically.

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

- `local` — `make station` compiles and runs Station from source
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
make profiles                               # Bootstrap/list profiles and deploy envs
make profile <name>                         # Activate profile
make profile-init <name> SLOT=<n>           # Create new profile
make config                                 # Show active config

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

### Recipe: Local Station + Desktop + Mobile

```bash
make profile-init PROFILE=local-dev SLOT=0
make profile PROFILE=local-dev
# Profile defaults are correct for local development
make station   # Compiles and starts Station
make desktop   # Starts Desktop
make mobile    # Starts Mobile
```

### Recipe: Remote Station (e.g. 10.37.246.80) + Local Desktop + Mobile

```bash
make profile-init PROFILE=remote-s1 SLOT=0
```

Then edit `.local/dev/profiles/remote-s1.env`:

```env
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

### Recipe: Second worktree running simultaneously

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
2. **Decide**: create new or reuse existing profile
3. **Create if needed**: `make profile-init <name> SLOT=<n>`
4. **Edit profile** if non-default config needed (remote station, relay, etc.)
5. **Activate**: `make profile <name>`
6. **Verify**: `make config` to confirm
7. **Report**: tell user they can now `make desktop` / `make mobile` / `make station`

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
- Profiles and deploy envs are tracked in `.local/` repo
- `make profiles` and `make profile <name>` bootstrap missing profiles/deploy envs from the shared `.local/` used by sibling worktrees.
- Runtime artifacts (pids/logs/data) and active pointers are gitignored within `.local/`
- Each worktree has its own active profile pointer (keyed by worktree basename)
- Multiple worktrees share one `.local/` via symlink; pids/logs/data are profile-scoped
- `make station` is idempotent — if Station is already running, it just confirms
- `make desktop` / `make mobile` always ensure Station is ready first
- Never hardcode station URLs in code — they come from the profile
- PIDs/logs/data live in `.local/dev/{pids,logs,data}/<profile-name>/`

## .local/ Git Repo

`.local/` is a standalone git repo (main repo gitignores it entirely).

**Tracked** (committed in `.local/` repo):
- `dev/profiles/*.env` — all profiles
- `deploy/envs/*.env` — all deploy env configs
- `topology.env` — network topology reference
- `.gitignore`

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
`.local/dev/active/<worktree-basename>.env`, so switching profiles in one
worktree doesn't affect others.

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
