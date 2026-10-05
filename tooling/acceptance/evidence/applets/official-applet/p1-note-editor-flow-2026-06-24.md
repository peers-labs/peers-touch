# P1.2 Note Editor Flow Evidence

> Date: 2026-06-24
> Plan source: `docs/architecture/platform/applet-runtime/execution-plans/2026-06-23-applet-capability-completion-plan.md`
> Workstream: `P1 - Note Product Completion`
> Task: `P1.2 Note Editor Flow`
> Evidence class: `REAL_PRODUCT_PATH`

## Scope Completed

- Replaced the sample-only create/search UI with user-entered create and search
  inputs.
- Added edit mode for the selected note and a save action that routes updates
  through the Note service client.
- Added `updateNote()` to the frontend service client using
  `sdk.network.request({ service: 'note', method: 'PATCH' })`.
- Kept Note frontend service access centralized in
  `apps/applets/note/frontend/src/infrastructure/capability/serviceClient.ts`.
- Updated Note frontend locale catalogs for create, search, edit, save, and
  editor validation states.
- Updated `applet-note-frontend-sdk-gate.mjs` so the official frontend gate
  checks product editor/search keys instead of the superseded sample-action
  keys.
- Updated `apps/applets/note/README.md` to reflect the current frontend product
  state.

## Evidence

| Command | Status | Notes |
|---------|--------|-------|
| `pnpm --filter @peers-touch/note-official-applet check` | PASS | TypeScript check passes for the ReactLynx editor/input flow. |
| `pnpm --filter @peers-touch/note-official-applet build` | PASS | Rspeedy builds `dist/main.lynx.bundle`. |
| `pnpm applet:note-frontend-sdk-gate` | PASS | Gate confirms SDK dependency, service binding, localized UI, and centralized `sdk.network.request`. |
| `pnpm applet:note-desktop-live-smoke` | PASS | Desktop Lynx Host still launches `peers.note` and records `REAL_PRODUCT_PATH` smoke evidence. |
| `git diff --check -- <P1.2 touched files>` | PASS | No whitespace diff errors in touched files. |

## Not Completed

- P1.3 draft storage is not implemented.
- P1.4 restore UI is not implemented.
- P1.5 typed failure UI is not implemented.
- P1.6 reload persistence acceptance gate is not implemented.
- Full P1 Note Product Completion is not claimed.

## Claim

`peers.note` now has a user-entered create/search path and a selected-note
editor/update path through the official applet SDK service binding. This
completes P1.2 only; it does not complete P1.
