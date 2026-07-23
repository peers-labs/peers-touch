---
name: pt-dev-runtime-handoff
description: >
  Use after code changes when the user wants the agent to prepare a dev
  runtime for acceptance testing. Guides profile-based startup, service
  restart decisions, local/remote Station selection, Desktop app/web launch,
  dual-client verification, and reporting what the user can validate.
---

# Dev Runtime Handoff

> **Source of truth for environment spec**: `docs/global/local-dev-environment.md`
> This skill defines behavior (when to restart, what to run). The doc above defines semantics (what modes mean, what fields do, what deploy does).

## Goal

After finishing code, the agent should prepare the right dev runtime so the
user only needs to verify behavior. Do not leave the user to guess whether
Station, Docker services, Desktop Rust BFF, Vite, or dual clients need to be
started or restarted.

**Prerequisite**: The `pt-local-dev-env` skill must have been applied first — a
profile must be active. If no profile exists, apply `pt-local-dev-env` first.

## Entry Points (New Profile System)

All commands from the repository root. No flags needed if a profile is active:

```bash
# Core dev commands
make station                # Start/verify Station (local or remote per profile)
make desktop                # Desktop Tauri app
make desktop-web            # Desktop in browser
make mobile                 # Mobile iOS Simulator

# Lifecycle
make status                 # Show running services
make stop                   # Stop all
make restart                # Restart all
make station-restart        # Restart Station only
make desktop-restart        # Restart Desktop only
make mobile-restart         # Restart Mobile only

# Docker (unchanged)
make docker-station         # Build & deploy Station container
make docker-relay           # Build & deploy Relay container
make docker-all             # Build & deploy all
make docker-logs            # Tail container logs
make docker-ps              # Show running containers
```

Docker remote variants (unchanged):

```bash
make docker-station REMOTE=pt-station-1
make docker-station REMOTE=pt-station-2
make docker-relay REMOTE=pt-relay
```

## Runtime Selection

Choose runtime by acceptance need:

- `make desktop`: native Tauri app verification.
- `make desktop-web`: browser-mode Desktop verification.
- `make desktop` + `make desktop-web` in two terminals: two-account dual-client
  flows (chat realtime, typing, badges, notifications, presence, friend/group).
- `make station`: Station code changed, local mode compiles and runs.
- `make station-restart`: Station code changed while already running.
- `make mobile`: Mobile iOS verification against profile's Station.

## Restart And Deploy Decisions

### Station

Restart when changes touch:

- `apps/station/**`
- `model/domain/**` plus regenerated proto output
- database models, bootstrap, migrations, auth/session, SSE/realtime,
  notification fan-out, OSS upload/serve/cache contracts, friend chat, group
  chat, relay-facing Station APIs, federation

Use: `make station-restart` (local mode) or `make docker-station REMOTE=<ctx>`

### Relay

Restart when changes touch relay service/config, broadcast protocol, WebRTC/TURN
routing, call signaling infrastructure, or Docker relay env.

Use: `make docker-relay REMOTE=pt-relay`

### Desktop Rust BFF / Tauri

Restart when changes touch:

- `apps/desktop/src-tauri/**`
- Tauri command signatures
- gateway ports, local HTTP gateway, auth/session resolver, event stream,
  presence, OSS cache, local storage, identity bridge

Use: `make desktop-restart`

### Desktop Web

For `apps/desktop/src/**` UI/runtime/store changes, first rely on Vite HMR.
Use `make desktop-restart` if the page is stale, the runtime was installed
before the code existed, or the change affects app boot/runtime installation.

### Proto

If proto changes are part of the task, run `make model-gen` before runtime
verification, then restart affected Station/Desktop runtimes.

## Before Starting

1. Run `make status` to see what's already running.
2. Check whether the task changed Station, Desktop Rust, Desktop Web, proto,
   Docker config, relay, or only docs/tests.
3. Choose the smallest runtime that can verify the behavior.
4. If Station URL needs to change (local vs remote), switch profile first:
   `make profile PROFILE=<name>` (see `pt-local-dev-env` skill).
5. Tell the user what will be started/restarted and why.

## Dev Handoff Workflow

1. Run focused checks for the files changed by the task.
2. Decide deploy/restart scope using the rules above.
3. Start/deploy with `make`, not direct scripts.
4. Wait until the relevant ports/services are ready.
5. Run the minimal smoke verification the agent can perform.
6. Report exactly what is ready for user acceptance.

## Dual Client Acceptance

Run `make desktop` in one terminal and `make desktop-web` in another.

Expected topology:

- App client: native Tauri window, gateway on profile's `PT_DESKTOP_APP_GATEWAY_PORT`.
- Web client: browser client, gateway on profile's `PT_DESKTOP_WEB_GATEWAY_PORT`.
- Both clients share one Station (from profile).
- Each client has isolated Rust BFF/session profile.

Verify:

1. A sends message to B; B sees it without sending a message and without
   clicking the Chat sidebar.
2. Chat badge updates immediately when B is not viewing the conversation.
3. Badge stays clear when B is viewing the conversation.
4. Typing indicator appears above the composer and clears after idle/send/blur.
5. Image messages show sender-side local thumbnail and receiver-side resolved
   thumbnail.
6. Presence and notification state update without manual page remount.

If verification fails, inspect in this order:

1. Station logs (`make status` shows log path).
2. Rust BFF event stream and Tauri event names.
3. `eventStream.ts` protobuf frame decode.
4. Runtime owner (`socialRealtime`, `notification`, `navigationBadges`,
   `mediaRuntime`).
5. Store projection.
6. Component rendering.

Do not make page-level `useEffect(...load...)` the primary fix for runtime
state. Components can fallback-load, but the owning runtime must consume events
and reconcile.

## Reporting Template

Report in this shape:

```markdown
Dev runtime ready:
- Profile: <active profile name and key settings>
- Checks: <commands and result>
- Deployment/restart: <what was reused/restarted/deployed and why>
- Runtime: <make target(s) started>
- Verification: <what the agent smoke-tested>
- User acceptance: <exact scenario the user should try>
- Open risk: <only if something could not be verified>
```
