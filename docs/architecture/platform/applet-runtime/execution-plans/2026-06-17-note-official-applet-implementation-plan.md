# Note Official Applet Implementation Plan

> **Status**: superseded
> **Date**: 2026-06-17
> **Owner**: Architecture Team
> **Scope**: Task-level plan for implementing Note as the first official applet under `apps/applets/note`
> **Superseded by**: [`2026-06-23-applet-capability-completion-plan.md`](./2026-06-23-applet-capability-completion-plan.md)

> This document is archived as historical context. Do not use it as the active
> execution source for new applet capability work.

---

## 1. Goal

Implement Note as an official applet product unit that validates the Peers-Touch applet architecture through a real frontend, real backend service, real Host Gateway service binding, and real Desktop runtime path.

Target readiness:

```text
L3 OFFICIAL_APPLET_DESKTOP_READY
```

This means:

- Note frontend is an applet package, not a Desktop page.
- Note service is a DDD-led applet service, not a Desktop command.
- Desktop loads Note through applet Host infrastructure.
- `sdk.network.request({ service: "note" })` reaches a real Note service.
- CRUD/search persist and survive applet reload.
- forbidden raw backend access and legacy `notebook_*` paths are absent from the product path.

## 2. Non-Negotiable Boundaries

- Applet product source lives under `apps/applets/note`.
- Cross-process schema source lives under `model/domain/note/**`.
- Desktop and Mobile may only load Note through artifact/manifest/Host Gateway.
- Station may bundle Note through `service/stationadapter`, but Station main-program code must not absorb Note domain/application logic.
- Note frontend must use `@peers-touch/applet-sdk` for Host capabilities.
- Note frontend must not use raw backend URLs.
- Note service must support Station-bundled deployment; standalone deployment must be either implemented or explicitly marked planned.
- Evidence must label mocked harnesses separately from real product paths.

## 3. Workstream Overview

| Workstream | Purpose | Blocks |
|------------|---------|--------|
| O0 Official Applet Contract | Land `apps/applets` product-unit rules and validation baseline | All Note work |
| O1 Official Applet Scaffold | Generate official applet skeleton from the contract | Note contract and implementation |
| C1 Note Contract | Define proto, manifests, service binding, error surface | Service, SDK, Gateway |
| S2 Note Service | Implement DDD Note service and Station-bundled adapter | Gateway, product smoke |
| F3 Framework SDK/Gateway Enhancements | Add required service binding, UI, nav, events, storage, error behavior | Note frontend |
| A4 Note Frontend | Implement Lynx/TS applet using SDK only | Desktop smoke |
| D5 Desktop Injection | Load Note artifact and bind service through Desktop Host Gateway | L3 readiness |
| M6 Mobile Contract Preparation | Keep Note portable and define Mobile Host expectations | later Mobile gate |
| T7 Evidence and Gates | Prove real path, forbidden paths, and failure paths | release decision |

Dependency order:

```text
O0 -> O1 -> C1 -> S2
                -> F3 -> A4 -> D5 -> T7
                       -> M6
```

## 4. O0 Official Applet Contract

### Write Scope

- `docs/architecture/platform/applet-runtime/official-applet-architecture-contract.md`
- `apps/applets/README.md`
- existing applet runtime README/module-layout docs

### Deliverables

- Official applet directory contract.
- Frontend/service/contract/doc/test ownership rules.
- Station-bundled and standalone deployment contract.
- Desktop/Mobile/Web injection rules.
- Forbidden dependency and raw access rules.

### Pass Criteria

- AI read order points to the official applet contract before Note implementation.
- `apps/applets/README.md` references the architecture source instead of redefining it.
- Existing docs no longer imply official applets must live under `packages/applets`.

## 5. O1 Official Applet Scaffold

### Write Scope

- `tooling/scripts/create-official-applet.mjs`
- `tooling/scripts/README.md`
- package scripts that expose the command
- scaffold templates under `tooling/templates/official-applet/` or a co-located script-owned template directory
- `apps/applets/README.md`

### Deliverables

- non-interactive scaffold command:

```bash
pnpm applet:create-official --id peers.note --service note --name Note
```

- generated official applet product unit:

```text
apps/applets/note/
├── README.md
├── applet.manifest.json
├── service.manifest.json
├── frontend/
├── service/
├── contracts/
├── docs/
└── tests/
```

- optional proto skeleton generation behind an explicit flag:

```bash
pnpm applet:create-official --id peers.note --service note --name Note --with-proto
```

- idempotency behavior: rerun without `--force` reports existing files and does not overwrite non-empty files.
- scaffold contract gate that validates required directories, required manifests, service binding, and forbidden Host coupling.

### Pass Criteria

- scaffold can generate `apps/applets/note` from an empty state.
- generated `applet.manifest.json` includes a canonical `services[]` entry for `note`, `permissions: ["network.request"]`, and `platformPermissions: ["network:service:note"]`.
- generated `service.manifest.json` declares Station-bundled deployment and explicitly marks standalone as implemented or planned.
- generated frontend imports only `@peers-touch/applet-sdk` for Host capabilities.
- generated service structure follows `domain/application/infrastructure/transport/stationadapter/standalone`.
- scaffold does not create Desktop pages, Mobile screens, Desktop commands, or Station main-program business code.
- rerunning the scaffold without `--force` is safe.

## 6. C1 Note Contract

### Write Scope

- `model/domain/note/v1/note.proto`
- `apps/applets/note/applet.manifest.json`
- `apps/applets/note/service.manifest.json`
- `apps/applets/note/contracts/`
- generated code only through approved proto scripts

### Deliverables

- `NoteService` proto with list/get/create/update/delete/search.
- typed errors for invalid input, not found, permission denied, service unavailable, conflict, timeout.
- applet manifest with a canonical `services[]` entry for `note` and required permissions.
- service manifest with Station-bundled and standalone deployment declarations.
- API mapping document from proto to HTTP route shape.

### Pass Criteria

- `./model/build.sh` succeeds for shared/server-side proto generation.
- manifest validation rejects a missing canonical `services[]` entry for `note`.
- applet manifest does not expose raw upstream URL.
- service manifest names deployment modes explicitly.
- generated skeleton changes from O1 are refined rather than hand-recreated.

## 7. S2 Note Service

### Write Scope

- `apps/applets/note/service/`
- `apps/station/` composition root only for mounting adapter
- migrations owned by the Station persistence standard

### Deliverables

- DDD domain aggregate and repository interface.
- application command/query service.
- persistence repository.
- transport handler.
- `stationadapter` subserver mount.
- `standalone` entry if standalone is claimed in `service.manifest.json`.
- service tests for domain/application/persistence/transport.

### Pass Criteria

- `cd apps/station && gofmt -l . && go test ./...` succeeds or failures are documented if unrelated.
- handlers contain no business rules beyond decoding, validation handoff, and response encoding.
- Station only mounts `stationadapter`.
- Note CRUD/search work through service transport, not direct repository calls from Host code.

## 8. F3 Framework SDK/Gateway Enhancements

### Write Scope

- `packages/applet-contract/`
- `packages/applet-sdk/`
- `apps/desktop/src-tauri/src/application/applets/`
- `apps/desktop/src/applet/`
- mobile contract docs only unless implementing Mobile Host

### Deliverables

- `AppletManifest.services` schema support.
- `network.request` service-binding params.
- Gateway route resolver for `service: note`.
- Gateway identity context injection without token exposure.
- unified applet error model with `messageKey` and `traceId`.
- `sdk.ui.showToast`, `sdk.ui.confirm`, `sdk.ui.showLoading`, `sdk.ui.hideLoading`.
- applet-internal `sdk.navigation`.
- real or explicitly gated `sdk.events.emit/subscribe`.
- applet-scoped `sdk.storage`.
- metadata-only telemetry path or explicit `NOT_IMPLEMENTED` readiness status.

### Pass Criteria

- raw URL network request from applet product path is denied unless a separate policy explicitly allows external network.
- `service=note` without manifest permission returns typed `PERMISSION_DENIED`.
- stopped/unreachable Note service returns typed service error.
- applet errors do not leak tokens, credentials, or internal upstream URLs.

## 9. A4 Note Frontend

### Write Scope

- `apps/applets/note/frontend/`
- `apps/applets/note/docs/`
- `apps/applets/note/tests/`

### Deliverables

- Note list page.
- Note editor page.
- Note applet routes.
- SDK-backed `noteClient`.
- local draft storage only.
- localized UI keys.
- save/delete/search flows.
- failure UI for permission denied, unavailable service, timeout, not found.

### Pass Criteria

- No imports from `apps/desktop`, `apps/mobile`, or `apps/station`.
- No raw backend `fetch`, `axios`, `baseUrl`, or hardcoded service URL.
- No user-facing hardcoded text.
- formal data goes through `sdk.network.request({ service: "note" })`.
- `pnpm applet:note-frontend-sdk-gate` writes passing frontend SDK evidence.

## 10. D5 Desktop Injection

### Write Scope

- Desktop applet registry/loader only.
- Desktop Gateway service binding.
- Desktop launch entry for `appletId = "peers.note"` only if needed.

### Deliverables

- Desktop can discover/load built Note applet artifact.
- Desktop Host session injects SDK bridge.
- Gateway binds `note` service to Station-bundled Note subserver.
- existing Desktop Note page is not part of applet acceptance.

### Pass Criteria

- Product path does not call `notebook_*` Desktop commands.
- CRUD/search operate from Note applet through Gateway.
- audit records include applet id, method, service, request id, result, and sanitized error metadata.

## 11. M6 Mobile Contract Preparation

### Write Scope

- Mobile applet Host contract docs.
- shared applet manifest validation.
- no Note-specific Mobile business code.

### Deliverables

- Note artifact remains Mobile-targetable.
- Mobile unsupported/missing host behavior is explicit.
- Mobile does not require Note-specific service/store/screen modules.

### Pass Criteria

- Mobile gate is either real and passing, or readiness is marked `L2 MOBILE_CONTRACT_READY`.
- No false claim of Mobile product readiness.

## 12. T7 Evidence and Gates

### Required Commands

Initial command names may be implemented as scripts during the workstream:

```bash
pnpm applet:validate apps/applets/note
pnpm applet:create-official --id peers.note --service note --name Note --dry-run
pnpm applet:official-contract-gate apps/applets/note
pnpm applet:official-skill-discovery-gate
pnpm applet:note-frontend-sdk-gate
pnpm applet:note-desktop-injection-gate
pnpm applet:note-real-product-gate
pnpm applet:note-forbidden-scan
pnpm applet:note-service-gate
pnpm applet:note-desktop-real-gateway-gate
pnpm applet:note-desktop-live-smoke
```

Station verification:

```bash
cd apps/station
gofmt -l .
go test ./...
```

Desktop verification:

```bash
cd apps/desktop
pnpm run check
pnpm run test
pnpm run build
```

### Evidence Bundle

The evidence bundle must include:

```text
note-package-validation.json
note-service-test-output.txt
note-gateway-binding-output.json
note-frontend-sdk-gate.json
note-desktop-injection-gate.json
note-desktop-live-smoke.json
note-forbidden-scan.txt
official-applet-skill-discovery.json
note-readiness-summary.md
```

Each evidence item must label the path:

```text
REAL_PRODUCT_PATH
CONTROLLED_LOCAL_UPSTREAM
MOCKED_HARNESS
NOT_IMPLEMENTED
```

### Final Pass Criteria

- create note through applet, reload applet, list still shows note.
- edit note through applet, reload applet, new content persists.
- search finds the note through service API.
- delete note through applet, reload applet, note is absent.
- denied service permission fails with typed error.
- stopped service fails with typed error and UI feedback.
- forbidden scans prove no raw backend and no legacy Desktop notebook path.
- skill discovery gate proves `pt-official-applet-development` exists under `tooling/skills/`, is registered in `AGENTS.md`, is referenced from the applet-runtime architecture docs, and describes official applet/scaffold/service-binding trigger scenarios.
- progress docs do not overstate readiness.
