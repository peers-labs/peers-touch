# P1 Note Product Completion Evidence

> Date: 2026-06-24
> Plan source: `docs/architecture/applet-runtime/execution-plans/2026-06-23-applet-capability-completion-plan.md`
> Workstream: `P1 - Note Product Completion`
> Evidence class: `REAL_PRODUCT_PATH`

## Scope Completed

This evidence closes the active plan's P1 scope for the Desktop-backed
`peers.note` official applet product path:

- list, create, edit, delete, search, and restore behavior;
- editor/update flow through the official Note service client;
- local create/edit draft storage through `@peers-touch/applet-sdk`
  `sdk.storage`;
- typed localized failure classification for permission denied, timeout, not
  found, conflict, and Note-specific locale-key errors;
- i18n-backed Note frontend UI with no hardcoded JSX text;
- reload persistence evidence for create, edit, delete, search, and restore.

## Evidence

| Command | Status | Evidence |
|---------|--------|----------|
| `pnpm --filter @peers-touch/note-official-applet check` | PASS | TypeScript validation for Note frontend. |
| `pnpm --filter @peers-touch/note-official-applet build` | PASS | Rspeedy builds `dist/main.lynx.bundle`. |
| `pnpm applet:note-frontend-sdk-gate` | PASS | `official-applet/note-frontend-sdk-gate.json` |
| `pnpm applet:note-forbidden-scan` | PASS | Reuses the Note frontend SDK boundary gate with the active-plan command name. |
| `pnpm applet:note-reload-persistence-gate` | PASS | `official-applet/note-reload-persistence-gate.json` |
| `pnpm applet:note-real-product-gate` | PASS | `official-applet/note-real-product-gate.json` |
| `pnpm applet:note-desktop-live-smoke` | PASS | `official-applet/note-desktop-live-smoke.json` |
| `cd apps/applets/note/service && go test ./...` | PASS | Note service application and stationadapter tests pass. |
| `cd apps/desktop && pnpm run check` | PASS | Desktop TypeScript and runtime-boundary checks pass. |
| `cd apps/desktop && pnpm run build` | PASS | Desktop Vite build completes; existing large chunk warnings remain non-blocking. |
| `git diff --check -- <P1 touched files>` | PASS | No whitespace diff errors in touched files. |

## Reload Persistence Coverage

`pnpm applet:note-reload-persistence-gate` starts the real Go Note Station
fixture with JWT, `stationadapter`, SQLite, and GORM, then verifies the public
HTTP mapping:

- create response includes a persisted note;
- created note survives list reload;
- edit response includes the updated note;
- updated note survives list reload;
- updated note is discoverable through search reload;
- deleted note is absent from normal list reload;
- deleted note is present with `include_deleted=true` reload;
- restore response returns an active note;
- restored note survives list reload.

## Not Completed

- This is not Station Store readiness.
- This is not Station-backed Applet Box readiness.
- This is not real third-party producer certification.
- This is not manual normal-user release acceptance.
- This is not `L5 COMPLEX_PLATFORM_READY`.

## Claim

`peers.note` P1 Note Product Completion is complete for the active Desktop-backed
official applet product path and its listed acceptance commands. The broader
applet platform plan must continue with P2 Station Store and later workstreams.
