---
name: dev-runtime-handoff
description: >
  Use after code changes when the user wants the agent to prepare a dev
  runtime for acceptance testing. Guides make-based startup, deployment,
  service restart decisions, local/remote Station selection, Desktop app/web
  launch, dual-client verification, and reporting what the user can validate.
---

# Dev Runtime Handoff

## Goal

After finishing code, the agent should prepare the right dev runtime so the
user only needs to verify behavior. Do not leave the user to guess whether
Station, Docker services, Desktop Rust BFF, Vite, or dual clients need to be
started or restarted.

Always prefer the repository `make` targets. The shell scripts in
`tooling/scripts/` are implementation details behind `make` unless a target is
broken.

## Default Entry Points

Use these from the repository root:

```bash
make dev-app
make dev-web
make dev-dual
make docker-station
make docker-relay
make docker-all
make docker-logs
make docker-ps
```

Remote dev box variants:

```bash
make dev-app REMOTE=dev-box
make dev-web REMOTE=dev-box
make dev-dual REMOTE=dev-box
make docker-station REMOTE=dev-box
make docker-all REMOTE=dev-box
```

Force Desktop Rust BFF restart:

```bash
make dev-app RESTART=1
make dev-web RESTART=1
make dev-dual RESTART=1
```

## Runtime Selection

Choose runtime by acceptance need:

- `make dev-app`: native Tauri app verification.
- `make dev-web`: browser-mode Desktop verification.
- `make dev-dual`: two-account flows such as chat realtime, typing, badges,
  notifications, presence, image delivery, friend/group interactions.
- `make docker-station`: Station server code changed and acceptance uses the
  Docker/dev-box deployment path.
- `make docker-all`: Station plus relay changed, or call/realtime relay
  behavior needs end-to-end validation.

Do not default every Desktop task to dual mode. Use dual only when the feature
requires two clients or cross-account observation.

## Restart And Deploy Decisions

### Station

Restart or deploy Station when changes touch:

- `apps/station/**`
- `model/domain/**` plus regenerated server/client proto output
- database models, bootstrap, migrations, auth/session, SSE/realtime,
  notification fan-out, OSS upload/serve/cache contracts, friend chat, group
  chat, relay-facing Station APIs

Use:

```bash
make docker-station
make docker-station REMOTE=dev-box
```

If only local non-Docker Station is needed, let `make dev-*` start or reuse it.
Do not bypass the Makefile with manual `go run` unless the make path is broken.

### Relay

Restart or deploy relay when changes touch relay service/config, WebRTC/TURN
routing, call signaling infrastructure, or Docker relay env.

Use:

```bash
make docker-relay
make docker-relay REMOTE=dev-box
```

### Desktop Rust BFF / Tauri

Restart Desktop runtime when changes touch:

- `apps/desktop/src-tauri/**`
- Tauri command signatures
- gateway ports, local HTTP gateway, auth/session resolver, event stream,
  presence, OSS cache, local storage, identity bridge

Use `RESTART=1` with the selected dev target.

### Desktop Web

For `apps/desktop/src/**` UI/runtime/store changes, first use Vite hot reload.
Restart the selected `make dev-*` target if the page is stale, the runtime was
installed before the code existed, or the change affects app boot/runtime
installation.

### Proto

If proto changes are part of the task, run the repo's model generation path
before runtime verification, then restart affected Station/Desktop runtimes.

## Before Starting

1. Inspect existing terminals so duplicate dev servers are not launched.
2. Check whether the task changed Station, Desktop Rust, Desktop Web, proto,
   Docker config, relay, or only docs/tests.
3. Choose the smallest runtime that can verify the behavior.
4. Use `REMOTE=dev-box` only when acceptance needs the remote/dev-box Station.
5. Tell the user what will be started/restarted and why.

## Dev Handoff Workflow

1. Run focused checks for the files changed by the task.
2. Decide deploy/restart scope using the rules above.
3. Start/deploy with `make`, not direct scripts.
4. Wait until the relevant ports/services are ready.
5. Run the minimal smoke verification the agent can perform.
6. Report exactly what is ready for user acceptance.

## IM / Dual Client Acceptance

Use `make dev-dual` when validating cross-account chat behavior.

Expected topology:

- App client: native Tauri window, gateway `3030`.
- Web client: browser client, gateway `3031`.
- Both clients share one Station.
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

1. Station logs and SSE fan-out.
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
- Checks: <commands and result>
- Deployment/restart: <what was reused/restarted/deployed and why>
- Runtime: <make target, local or REMOTE=dev-box>
- Verification: <what the agent smoke-tested>
- User acceptance: <exact scenario the user should try>
- Open risk: <only if something could not be verified>
```
