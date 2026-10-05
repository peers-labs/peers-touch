# P1.1 Note Gap Audit

> Date: 2026-06-24
> Plan source: `docs/architecture/platform/applet-runtime/execution-plans/2026-06-23-applet-capability-completion-plan.md`
> Workstream: `P1 - Note Product Completion`
> Task: `P1.1 Note Gap Audit`
> Evidence classes used: `REAL_PRODUCT_PATH`, `CONTROLLED_LOCAL_UPSTREAM`,
> `SYNTHETIC_FIXTURE`, `NOT_IMPLEMENTED`

## Scope

This audit compares current `peers.note` behavior with the P1 deliverables in
the active applet capability completion plan. It does not change Note frontend,
service, SDK, Desktop, Mobile, or Station code.

## Plan Requirements

P1 requires `peers.note` to become a complete official applet product path:

- list, create, edit, delete, search, and restore behavior;
- editor/update flow;
- local draft storage through SDK storage only;
- typed failure UI for permission denied, unavailable service, timeout, not
  found, and conflict;
- i18n-complete UI;
- reload persistence evidence for create, edit, delete, and search.

Acceptance commands from the active plan:

```bash
pnpm applet:note-frontend-sdk-gate
pnpm applet:note-real-product-gate
pnpm applet:note-desktop-live-smoke
pnpm applet:note-forbidden-scan
cd apps/applets/note/service && go test ./...
cd apps/desktop && pnpm run check && pnpm run build
```

## Current Implementation Inventory

### REAL_PRODUCT_PATH

| Area | Current state | Evidence |
|------|---------------|----------|
| Note contract and official applet shape | Present. Official contract gate passes for `apps/applets/note`. | `official-applet/official-contract-gate.json` |
| Desktop package injection | Present. `peers.note` package is indexed, integrity-checked, and loadable from Desktop applet distribution. | `official-applet/note-desktop-injection-gate.json` |
| Desktop live launch | Present for smoke path. Applet creates a session, reports ready, performs `network.request` to `service: note`, tracks telemetry, and destroys lifecycle. | `official-applet/note-desktop-live-smoke.json` |
| Station-bundled service path | Present. Desktop Gateway `network.request` reaches the Station-bundled Note service through the Note service binding. | `official-applet/note-real-product-gate.json` |
| Frontend SDK boundary | Present for existing UI. Frontend data access is centralized through `sdk.network.request({ service: 'note' })`. | `official-applet/note-frontend-sdk-gate.json` |

### Implemented In Code

| P1 item | Current state | Key files |
|---------|---------------|-----------|
| List | Implemented in frontend and service. | `apps/applets/note/frontend/src/application/useNoteController.ts`, `apps/applets/note/service/application/service.go` |
| Create | Partially implemented as `createSample`, not as a real editor/input flow. | `apps/applets/note/frontend/src/application/useNoteController.ts` |
| Search | Partially implemented as `searchSample`, not as a real query input flow. | `apps/applets/note/frontend/src/application/useNoteController.ts` |
| Delete | Implemented for selected note. | `apps/applets/note/frontend/src/application/useNoteController.ts` |
| Service update | Implemented in service and transport. | `apps/applets/note/service/application/service.go`, `apps/applets/note/service/transport/http_handler.go` |
| Service restore | Implemented in service and transport. | `apps/applets/note/service/application/service.go`, `apps/applets/note/service/transport/http_handler.go` |

## Gap Inventory

### NOT_IMPLEMENTED

| Gap | Required by P1 | Current observation | Required next task |
|-----|----------------|---------------------|--------------------|
| Real create input flow | `list/create/edit/delete/search/restore behavior` | Frontend only has `createSample()` using localized sample title/content. | Add Note editor/create UI with user-entered title/content and SDK-backed create command. |
| Editor/update flow | `Editor/update flow` | Service supports PATCH, but frontend has no `updateNote` client, editor state, or save action. | Add `updateNote` to service client, add editor state, save action, and update persistence evidence. |
| Restore flow | `restore behavior` | Service supports restore, but frontend has no `restoreNote` client, deleted-list view, include-deleted query, or restore action. | Add restore client and product UI decision for deleted notes or recovery state. |
| Draft storage | `Local draft storage through SDK storage only` | Frontend controller only uses React state; no `sdk.storage.get/set/remove` draft path exists. | Add draft repository over SDK storage and prove draft load/save/remove without business truth persistence. |
| Typed failure UI | `permission denied`, `unavailable service`, `timeout`, `not found`, `conflict` | Current error path maps `Error.message` through `t()` and otherwise falls back to `note.error.operationFailed`; it does not classify canonical error codes. | Add typed error normalization and dedicated localized failure views/actions. |
| Reload persistence evidence | create/edit/delete/search reload checks | Existing gates prove launch, GET/list, real service path, and basic SDK boundary; they do not execute the required reload persistence sequence. | Add a P1 acceptance gate that performs create -> reload -> list, edit -> reload, delete -> reload, and search persisted note. |
| `applet:note-forbidden-scan` command | P1 acceptance command | `package.json` has Note gates but no `applet:note-forbidden-scan` script. | Add or rename the forbidden scan gate so the active plan command is executable. |

### PARTIAL

| Item | Current state | Why partial |
|------|---------------|-------------|
| i18n-complete UI | Existing minimum UI uses `t()` and locale catalogs. | New editor, restore, draft, typed failures, and acceptance states will require additional locale keys. |
| Note product UX | Existing page shows list/detail and sample action buttons. | It is still a validation UI, not a full product workflow for user-authored notes. |
| Mobile Note readiness | `note-mobile-contract-gate.json` is `CONTRACT_PREPARED_NOT_RUNTIME_E2E`. | P1 is Desktop product completion; Mobile runtime product readiness remains outside the current Note completion claim. |

## Required P1 Task List

Execute these before claiming P1 completion:

1. `P1.2 Note Editor Flow`
   - Add create/edit form state for title/content.
   - Add `createNote` using user input.
   - Add `updateNote` client and save existing note flow.
   - Keep all user-facing strings in Note frontend locale catalogs.

2. `P1.3 Note Draft Storage`
   - Add a draft storage adapter over `@peers-touch/applet-sdk` storage.
   - Persist only draft UI state, not canonical Note business truth.
   - Clear draft after successful create/update.

3. `P1.4 Note Restore Flow`
   - Add `restoreNote` client.
   - Decide product UI for deleted notes: deleted filter, recovery panel, or typed recovery state.
   - Verify restored notes reappear in normal list/search.

4. `P1.5 Typed Failure UI`
   - Normalize SDK/Gateway/service errors into typed Note UI states.
   - Cover permission denied, unavailable service, timeout, not found, and conflict.
   - Add locale keys and recovery actions for each state.

5. `P1.6 Note Product Acceptance Gate`
   - Add an executable gate for create/edit/delete/search reload persistence.
   - Add or align `pnpm applet:note-forbidden-scan`.
   - Keep existing `note-frontend-sdk-gate`, `note-real-product-gate`, and
     `note-desktop-live-smoke` as regression gates.

## Current Claim

- `peers.note` is launchable through the Desktop real product path and has a
  Station-bundled Note service path.
- P1 is not complete. The frontend remains a minimum validation UI, and product
  completion still requires editor/update, restore, draft storage, typed failure
  UI, and reload persistence evidence.

## Verification

This P1.1 audit did not run acceptance commands. It is a static inventory over
the current source files and existing evidence listed above.
