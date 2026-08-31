# Local Development Environment

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-07-23 | **Updated**: 2026-08-31
> **Owner**: Platform Team

---

## 1. Document Scope

This document defines:
- Profile system: what a profile is, field semantics, mode types
- Deploy model: how code reaches remote stations
- Runtime topology: ports, services, connections per profile
- Make targets: what each command does under each mode

This document does NOT define:
- When to restart vs hot-reload (see `pt-dev-runtime-handoff` skill for decision logic)
- How to create/switch profiles (see `pt-local-dev-env` skill for interactive workflow)
- CI/CD pipeline (out of scope for local dev)

---

## 2. Profile System

### 2.1 What Is A Profile

A deployable profile is a `.env` source at
`../env/peers-touch/<name>/profile.env.example` that configures one complete
development topology: which Station to use, which ports, and which mode.
`.local/dev/profiles/<name>.env` is an imported cache, not a competing source
for a same-named deployable profile.

Each git worktree selects its profile through
`.local/dev/active/<worktree-name>.env`. Runtime commands derive the selected
name from that worktree-specific pointer and load the sibling `env` repository
source when it exists. The shared `.local/dev/profile` selector is not part of
the runtime contract.

### 2.2 Profile Fields

| Field | Required | Example | Semantics |
|-------|----------|---------|-----------|
| `PT_DEV_PROFILE` | yes | `one` | Profile name identifier |
| `PT_DEV_SLOT` | yes | `0` | Port slot for multi-profile isolation |
| `PT_STATION_MODE` | yes | `local` or `remote` | How Station is run (see §3) |
| `PT_STATION_NAME` | yes | `one` | Human-readable Station label |
| `PT_STATION_URL` | yes | `http://10.37.246.80:18080` | Station base URL |
| `PT_STATION_PORT` | yes | `18080` | Station HTTP port |
| `PT_STATION_DEPLOY_ENV` | if remote | `station-1` | Maps to `.local/deploy/envs/<name>.env` |
| `PT_STATION_HEALTH_URL` | recommended | `http://host:port/sub-oss/healthz` | Health check endpoint |
| `PT_RELAY_MODE` | if relay used | `remote` | Relay run mode |
| `PT_RELAY_URL` | if relay used | `http://host:port` | Relay base URL |
| `PT_RELAY_DEPLOY_ENV` | if relay remote | `relay-1` | Maps to deploy env |
| `PT_DESKTOP_APP_GATEWAY_PORT` | yes | `3030` | Desktop Tauri BFF port |
| `PT_DESKTOP_APP_WEB_PORT` | yes | `3210` | Desktop Tauri web port |
| `PT_DESKTOP_WEB_GATEWAY_PORT` | yes | `3031` | Desktop browser BFF port |
| `PT_DESKTOP_WEB_WEB_PORT` | yes | `3211` | Desktop browser web port |
| `PT_MOBILE_WEB_PORT` | if mobile | `5173` | Mobile dev server port |

### 2.3 Deploy Env Files

Canonical definitions live at
`../env/peers-touch/<profile>/deploy/<name>.env.example` and are imported to
`.local/deploy/envs/<name>.env`. These define remote host connection:

| Field | Semantics |
|-------|-----------|
| `PT_DEPLOY_HOST` | SSH target host IP |
| `PT_DEPLOY_USER` | SSH user (default: current user) |
| `PT_DEPLOY_DIR` | Remote working directory |
| `PT_DEPLOY_SOURCE` | `central` / `local` / `github` — how remote pulls code |

---

## 3. Station Mode

### 3.1 `local` mode

Station runs on the developer's machine. `make station` compiles and starts the
Go binary locally. Suitable when:
- Debugging Station code with breakpoints
- No network access to remote hosts
- Testing against local PostgreSQL

### 3.2 `remote` mode

Station runs on a remote host. `make station` triggers a full deploy cycle:

```
make station (remote mode)
  1. Push current branch to git server (central/local/github per deploy env)
  2. SSH to remote host
  3. Remote pulls the branch
  4. Remote rebuilds Go binary
  5. Remote restarts Station service
  6. Health check until ready
  7. Reports "Station ready at <URL>"
```

**Key implication**: `make station` in remote mode **deploys the current local
branch's HEAD commit** to the remote Station. Uncommitted changes are NOT deployed.
If you have local changes that need to be tested remotely, commit them first
(even as a WIP commit on a feature branch), then run `make station`.

### 3.3 Mode-specific behavior summary

| Command | `local` mode | `remote` mode |
|---------|-------------|---------------|
| `make station` | Compile + start locally | Deploy + restart remote |
| `make station-restart` | Kill + restart local process | SSH restart remote service |
| `make station-check` | Curl local health endpoint | Curl remote health endpoint |
| `make station-logs` | Tail local log file | SSH tail remote logs |
| `make station-stop` | Kill local process | SSH stop remote service |

---

## 4. Runtime Topology

With profile active, the developer's machine runs:

```
┌─────────────────────────────────────────────────────┐
│ Developer Machine                                    │
│                                                      │
│  Desktop App (Tauri)  → localhost:3030 (BFF)         │
│  Desktop Web (Browser)→ localhost:3031 (BFF)         │
│  Mobile Dev Server    → localhost:5173               │
│                                                      │
│  [local mode only]                                   │
│  Station              → localhost:18080              │
│  PostgreSQL           → localhost:5432 (Docker)      │
└──────────────────────────────┬───────────────────────┘
                               │ (if remote mode)
                               ▼
┌─────────────────────────────────────────────────────┐
│ Remote Station Host (e.g. 10.37.246.80)              │
│  Station              → :18080                       │
│  PostgreSQL           → :5432                        │
└─────────────────────────────────────────────────────┘
```

---

## 5. Make Targets Reference

All commands run from repository root. Profile must be active.

### Core

| Target | What it does |
|--------|-------------|
| `make station` | Ready Station (local start or remote deploy, per mode) |
| `make desktop` | Start Desktop Tauri app |
| `make desktop-web` | Start Desktop in browser |
| `make mobile` | Start Mobile iOS simulator |

### Lifecycle

| Target | What it does |
|--------|-------------|
| `make status` | Show all running services |
| `make stop` | Stop all services |
| `make restart` | Restart all services |
| `make station-restart` | Restart Station only |
| `make desktop-restart` | Restart Desktop only |
| `make station-check` | Health-check Station |
| `make station-logs` | Tail Station logs |

### Deploy (explicit)

| Target | What it does |
|--------|-------------|
| `make deploy ENV=station-1` | Deploy to named env (branch defaults to current) |
| `make deploy ENV=station-1 BRANCH=feat/x` | Deploy specific branch |
| `make deploy-status ENV=station-1` | Check deploy status |
| `make deploy-logs ENV=station-1` | Tail remote logs |

### Docker

| Target | What it does |
|--------|-------------|
| `make docker-station` | Build + deploy Station container (local Docker) |
| `make docker-station REMOTE=pt-station-1` | Build + deploy to remote Docker host |
| `make docker-relay` | Build + deploy Relay container |
| `make docker-all` | Build + deploy all containers |

### Proto + Quality

| Target | What it does |
|--------|-------------|
| `make model-gen` | Run `./model/build.sh` (proto generation) |
| `make check` | Go fmt check |
| `make style` | Full Go style check |
| `make test-unit` | Run Go unit tests |

---

## 6. E2E Verification Pattern

After deploying Station with new code:

```bash
# 1. Deploy
make station

# 2. Verify health
make station-check

# 3. Call API (example: new provider list endpoint)
curl -X POST "$PT_STATION_URL/sub-agent/agent/provider/list" \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{}'

# 4. Start Desktop to test full flow
make desktop
```

---

## 7. Station DB Access (Debug / Read-Only)

For debugging and data inspection, agents can query Station's PostgreSQL directly.

**Connection via SSH tunnel** (remote Station):

```bash
# From profile env: PT_STATION_URL tells the host, DB name is peers_touch_<profile>
ssh <station-host> -L 15432:localhost:5432 -N &
psql -h localhost -p 15432 -U peers -d peers_touch_<profile_name>
```

**Connection via MCP** (if PostgreSQL MCP server is configured):

```
postgresql://peers:peers123@localhost:15432/peers_touch_<profile_name>
```

**Useful debug queries**:

```sql
-- Check registered actors
SELECT ptid, created_at FROM actor_identity_keys;

-- Check active conversations
SELECT conversation_id, kind, current_sequence FROM messaging_conversations;

-- Check enrolled devices per conversation
SELECT conversation_id, ptid, device_id, active FROM messaging_conversation_member_devices;

-- Check message queue
SELECT id, conversation_id, created_at FROM device_queue_lanes ORDER BY created_at DESC LIMIT 10;
```

**Rules**:
- Read-only for debugging and acceptance diagnostics.
- Never use direct DB writes as a standard recovery path — implement admin commands instead.
- Connection details (host, port, DB name) come from the active profile, not hardcoded.

---

## 8. Conventions

1. **Never SSH manually to deploy** — always use `make station` or `make deploy ENV=x`.
2. **Never edit code on remote hosts** — deploy env discipline (AGENTS.md §12).
3. **Profile per worktree** — each git worktree has its own profile, avoids port conflicts.
4. **Health check is the contract** — `make station` is not done until health passes.
5. **Current branch deploys** — remote mode pushes HEAD, not necessarily main.
6. **Environment repository is authoritative** — do not repurpose a canonical
   profile by editing only its `.local` cache; create a distinctly named
   environment profile instead.
