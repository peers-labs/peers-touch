# P1.3-P1.5 Note Draft, Restore, and Failure UI Evidence

> Date: 2026-06-24
> Plan source: `docs/architecture/platform/applet-runtime/execution-plans/2026-06-23-applet-capability-completion-plan.md`
> Workstream: `P1 - Note Product Completion`
> Tasks: `P1.3 Note Draft Storage`, `P1.4 Note Restore Flow`, `P1.5 Typed Failure UI`
> Evidence class: `REAL_PRODUCT_PATH`

## Scope Completed

- Added `draftRepository.ts` backed only by `@peers-touch/applet-sdk`
  `sdk.storage`.
- Persisted create and edit editor drafts through SDK storage, keyed separately
  for create mode and per-note edit mode.
- Cleared the active draft after successful create or update.
- Added deleted-note loading through `listNotes({ includeDeleted: true })` and
  client-side deleted filtering.
- Added `restoreNote()` using `POST /v1/notes/{note_id}:restore` through the
  Note service client.
- Added restore UI for selected deleted notes.
- Added first-pass typed error normalization for permission denied, timeout,
  not found, conflict, and existing Note locale-key errors.
- Added localized UI keys for draft restoration, deleted notes, restore, and
  typed failures.

## Evidence

| Command | Status | Notes |
|---------|--------|-------|
| `pnpm --filter @peers-touch/note-official-applet check` | PASS | TypeScript check passes for SDK storage draft flow, restore flow, and failure classification. |
| `pnpm --filter @peers-touch/note-official-applet build` | PASS | Rspeedy builds `dist/main.lynx.bundle`. |
| `pnpm applet:note-frontend-sdk-gate` | PASS | Gate scans `draftRepository.ts` and confirms business `sdk.network.request` remains centralized in `serviceClient.ts`. |
| `pnpm applet:note-desktop-live-smoke` | PASS | Desktop Lynx Host still launches `peers.note` after the draft/restore/failure UI changes. |

## Not Completed

- Reload persistence acceptance is not implemented. P1.6 still needs an
  executable create -> reload, edit -> reload, delete -> reload, search, and
  restore acceptance gate.
- Typed failure UI is a first-pass normalization layer. It does not yet have
  dedicated product recovery actions per error type.
- This evidence does not prove Mobile Note runtime behavior.

## Claim

`peers.note` now has SDK-storage-backed local drafts, a frontend restore flow
over the existing Note service restore API, and typed localized failure
classification. This advances P1.3, P1.4, and the first implementation slice of
P1.5, but full P1 completion still depends on P1.6 reload persistence evidence.
