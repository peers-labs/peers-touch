# Local Development Environment

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-07-23 | **Updated**: 2026-09-28
> **Owner**: Platform Team

---

Station API ownership remains unchanged in every profile: Conversation is the
sole Chat business entry point under `/conversation/*`; Device, Inbox,
Recovery, Key Exchange, and Federation expose `/device/*`,
`/device/inbox/*`, `/recovery/*`, `/key-exchange/*`, and peer-only
`/federation/*`. Local topology never enables a Station Messaging facade.

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

The machine-global ownership and allocation architecture is defined in
[`docs/architecture/local-dev-control-plane/`](../architecture/local-dev-control-plane/README.md).
The registration, binding, slot, and capability-lease runtime is implemented by
`tooling/scripts/local-dev/machine-dev.mjs`. Evidence-root relocation remains a
separate migration.

### 1.1 Current Machine-State Boundary

The authoritative machine-global registry path is:

```text
~/.peers-touch/dev/registry.json
```

It becomes runtime authority only through explicit `make profile <name>` or
`make env-register`. An existing `authority: observed-snapshot` remains
diagnostic and makes normal runtime resolution fail closed. Legacy
`.local/dev/active/` pointers have no runtime authority.

Do not interpret discovered worktrees or profile pointers as active usage:

- registration is an explicit Owner action;
- `active` requires a matching live process/listener or valid lease;
- a registered worktree without live resources is `idle`;
- an unregistered worktree remains an observation only.

`make env-status-all` reports registration and live OS-held leases separately.
Lease JSON is metadata only; the held advisory lock plus matching
PID/process-start identity establishes possession.

Acceptance evidence is also development state. Its canonical local target is:

```text
~/.peers-touch/dev/acceptance
```

`~/Library/Application Support/PeersTouch/` is reserved for formal product
data. The existing `acceptance/` child there is legacy data pending a verified
resolver cutover and one-time migration. The migration is not complete until
every current Git worktree uses the canonical root, the old directory is
deleted, and the live registry plus active docs remove their legacy fields and
migration branches.

Development task intent is separately published at:

```text
~/.peers-touch/dev/work.json
```

It is machine-visible source/runtime intent owned by Development Workflow, not
Profile allocation or a live lease. Read-only intake may precede it; non-trivial
tasks must publish and confirm it before the first write or runtime acquisition.

Tracked Plan ownership is stored separately from both environment allocation
and mutable intent:

```text
~/.peers-touch/dev/workspaces/<workspaceId>/workflow/plan-binding.json
```

`make plan-bind PLAN=<path>` creates this binding once. The same tuple is
idempotent; a different Plan is rejected. A new Plan requires a new worktree.
Repository/PR synchronization never changes the binding.

---

## 2. Profile System

### 2.1 What Is A Profile

A deployable profile is a `.env` source at
`../env/peers-touch/<name>/profile.env.example` that configures one complete
development topology: which Station to use, which ports, and which mode.
`.local/dev/profiles/<name>.env` is an imported cache, not a competing source
for a same-named deployable profile. The only local-authority exception is a
human-authorized compose profile whose bytes match its consumed machine receipt.

Each Git worktree selects its profile through the machine registry binding keyed
by canonical `workspaceId`. `make profile PROFILE=<name>` creates a minimum
registration on first explicit selection and updates it thereafter; it never
writes a legacy active-profile pointer. Runtime commands load the sibling `env`
repository source directly.

The registration stores the canonical root and registered branch, but not Git
HEAD. Current HEAD is read directly from the worktree for each command.
The registry remains schema v1. Runtime does not migrate or accept
head-bearing registrations; machine-local files produced by superseded
development code must be corrected explicitly.

Local slot and Desktop/Mobile ports come from the machine binding. A profile's
`PT_DEV_SLOT` and local client port fields are legacy topology observations and
cannot override the allocation. See
[`local-dev-control-plane/design.md`](../architecture/local-dev-control-plane/design.md).

### 2.2 Environment Creation Authorization

AI agents may inspect and activate an existing approved profile, but MUST NOT
create, copy, derive, or register a profile or deploy environment without
explicit human developer approval for the exact environment name and target.
This includes `env/peers-touch/<name>/`, `.local/dev/profiles/`,
`.local/deploy/envs/`, `make profile-authorize`, and `make profile-init`.

A missing profile or deploy environment fails closed and must be reported. A
task, mere Plan existence, available host, old profile pointer, or Acceptance
need does not imply creation permission. Only an exact user grant or a formal
Plan field explicitly dedicated to environment creation could authorize it;
the current `ExecutionAuthorization` schema has no such field. Untracked
env-repository definitions and local definitions without a matching consumed
authorization receipt cannot authorize profile selection, deployment, restart,
or reset.

Human local-profile creation is a two-step, single-use flow:

```bash
make profile-authorize PROFILE=<name> SLOT=<n>
make profile-init PROFILE=<name> SLOT=<n>
```

The first command requires an interactive exact-tuple confirmation and writes a
30-minute pending grant under
`~/.peers-touch/dev/authorizations/environment-creation/`. The second consumes
that grant, creates one compose profile, and records its digest. It never
overwrites an existing profile. Agents may consume an already approved grant
for the exact requested tuple but must not run the authorization command or
create its files.

`PT_DEV_PROFILE_FILE` is not a general override. It is accepted only with
`PT_DEV_PROFILE_FILE_AUTHORITY=acceptance-runtime-manifest`, and the owned
regular profile file must be directly contained by the absolute
`PT_ACCEPTANCE_RUNTIME_PROFILE_ROOT`. Normal development resolves reviewed
env-repository topology or an authorized local compose profile.

### 2.3 Existing Profile Operation Admission

The selected directory name and `PT_DEV_PROFILE` value must match exactly. The
verified canonical ID then determines reset policy:

- case-insensitive ID containing `stable`: `stable-protected`, so autonomous
  `station.reset` is rejected;
- every other reviewed ID: `agent-resettable`, so the Agent may choose reset
  without human involvement.

There is no reset-policy environment field or machine-state override. For
non-stable Profiles, reset still requires the workspace `station.reset`
capability, a live declaration for the same Profile and exact exclusive scope,
the same command scope, matching tracked-clean remote topology and source
identity, and the OS-held reset lease.

Deploy/restart of an existing reviewed remote Profile continues to consume an
exact user grant or the accepted Plan's `authorization.runtime.deployProfiles`
entry. Neither deploy admission nor reset policy authorizes profile or
deploy-environment creation.

### 2.4 Profile Fields

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

### 2.5 Deploy Env Files

Canonical definitions live at
`../env/peers-touch/<profile>/deploy/<name>.env.example`. Remote deploy commands
resolve exactly one Git-tracked, clean definition directly from the env
repository. `.local/deploy/envs/<name>.env` is legacy cache/observation only
and cannot authorize deployment. These definitions contain:

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

All commands run from repository root. The workspace must be explicitly
registered and its binding must resolve.

### Core

| Target | What it does |
|--------|-------------|
| `make profile <name>` | Explicitly select a reviewed Profile; on first use, register with the lowest free slot and minimum operational capabilities without reset |
| `make env-register ...` | Explicitly register this verified workspace and allocate profile, slot, and allowed capabilities |
| `make env-update ...` | Update requested binding fields and current registered branch while no lease is held |
| `make env-check ...` | Verify stable workspace binding, current Git source, tracked-clean topology, slot, capabilities, target match, and budget |
| `make env-status-all` | Report all registrations and observed OS-held leases |
| `make dev-start ...` | Publish and conflict-check this task's source/runtime intent |
| `make dev-update WORK_ITEM=<id>` | Replace supplied scope or refresh the declared branch/HEAD |
| `make dev-status [WORK_ITEM=<id>]` | Show declarations for the current worktree |
| `make dev-status-all` | Show machine-wide task declarations |
| `make dev-check WORK_ITEM=<id>` | Verify current declaration before mutation |
| `make dev-heartbeat WORK_ITEM=<id>` | Extend the current declaration expiry |
| `make dev-release WORK_ITEM=<id>` | Release declaration after runtime cleanup |
| `make plan-bind PLAN=<path>` | Bind this workspace once to one Plan Package |
| `make plan-binding` | Resolve and validate the workspace's bound Plan |
| `make station` | Reuse a healthy source-matched Station, otherwise deploy the current commit and verify its live build identity |
| `make desktop` | Start Desktop Tauri app |
| `make desktop-web` | Start Desktop in browser |
| `make mobile` | Start Mobile iOS simulator |

Normal initial registration is explicit and one-step:

```bash
make profile <name>
```

Use the advanced form only when the Owner needs an exact slot, purpose, or
capability set:

```bash
make env-register \
  PROFILE=<name> \
  SLOT=<n> \
  CAPABILITIES='station.connect,station.deploy' \
  PURPOSE='<owner-approved purpose>'
make env-check \
  PROFILE=<name> \
  SLOT=<n> \
  CAPABILITIES='station.connect,station.deploy' \
  BUDGET_SECONDS=1200
```

For an explicit human `make station`, the command owns one bounded
`make.station` deployment intent and acquires the exact `station.deploy` lease
it needs. No separate `make dev-start` is required. Agent-driven tracked work
still declares runtime intent through Dev Workflow, and no direct owner action
can acquire `station.reset`.

After a normal commit, merge, rebase, or pull on the same branch, every command
immediately uses the new Git HEAD without mutating the machine registration.
Root or branch changes remain explicit binding changes. Agent workflow must
still update its Development declaration before another mutation or runtime
acquisition so the declared `sourceHead` equals the live worktree HEAD.

`make desktop` and `make desktop-web` are self-preparing. They resolve ports,
Station topology, and runtime settings from the selected Profile; resolve
package requirements from the repository manifests and `pnpm-lock.yaml`;
install missing packages with `pnpm install --frozen-lockfile`; generate missing
Desktop TypeScript proto bindings through `model/build.sh`; and run the
source-aware Station ready closure before starting Desktop. A complete managed
Vite/Tauri pair is reused only when both records match the current Git commit.
Partial or source-stale managed pairs are stopped as one owned runtime before
ports are checked and the pair is restarted. A separate `pnpm install`,
`make model-gen`, or `make station` is not required.

Registration does not create or edit an environment definition. A later
destructive wrapper uses the generic lease API after deriving Profile reset
policy and declaring the exact reset scope:

```bash
node tooling/scripts/local-dev/machine-dev.mjs lease \
  --resource-kind station.reset \
  --resource-id <station-fixture-scope> \
  --reset-scope <station-fixture-scope> \
  --budget-seconds <seconds> \
  -- <reset-command>
```

The reset API owns scope validation and lease lifetime only; it does not
implement deletion.

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
SELECT conversation_id, kind, current_seq FROM conversations;

-- Check enrolled devices per conversation
SELECT conversation_id, ptid, device_id, active FROM conversation_member_devices;

-- Check message queue
SELECT id, conversation_id, created_at FROM device_queue_lanes ORDER BY created_at DESC LIMIT 10;
```

**Rules**:
- Read-only for debugging and acceptance diagnostics.
- Never use direct DB writes as a standard recovery path — implement admin commands instead.
- Connection details (host, port, DB name) come from the active profile, not hardcoded.

---

## 8. Conventions

1. **Never SSH manually to deploy** — Station deployment always uses
   `make station`, which owns the canonical deploy lease and health closure.
2. **Never edit code on remote hosts** — deploy env discipline (AGENTS.md §12).
3. **Profile selection per worktree** — each Git worktree selects independently
   through its authoritative `workspaceId` binding. Profiles may be shared;
   slots may not.
4. **Health check is the contract** — `make station` is not done until health passes.
5. **Current branch deploys** — remote mode pushes HEAD, not necessarily main.
6. **Environment repository is authoritative** — do not repurpose a canonical
   profile by editing only its `.local` cache. If no approved profile fits,
   stop and request explicit human authorization before creating a distinctly
   named environment profile or deploy environment.
7. **No implicit global fallback** — an unregistered or stale worktree fails
   closed; do not infer profile or slot from another worktree, a legacy pointer,
   profile metadata, basename, or branch.
8. **Local creation consumes authorization** — `profile-init` requires one
   unexpired exact-tuple machine grant and produces a digest-bound receipt.
9. **Declare intent, then lease** — a matching active `work.json` declaration
   is required before `local.slot`, `station.deploy`, or `station.reset`
   acquisition. The declaration does not replace the OS-held lease.
10. **Station deploy lease covers the closure** — `make station` holds
    `station.deploy` across deploy, restart, and health readback, and releases
    on success, failure, signal, or timeout.
11. **Apply Profile-ID reset policy once** — non-stable Profiles may be reset by
    the Agent without human confirmation; stable Profiles fail before lease
    acquisition. Runtime scope and ownership guards still apply.
