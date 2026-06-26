# Note Official Applet Progress

> **Status**: active
> **Created**: 2026-06-17
> **Updated**: 2026-06-17
> **Execution Source**: [`2026-06-17-note-official-applet-implementation-plan.md`](./2026-06-17-note-official-applet-implementation-plan.md)

---

## Current Position

```text
O0 Official Applet Contract: completed
O1 Official Applet Scaffold: completed
C1 Note Contract: completed
S2 Note Service: completed
F3 Framework SDK/Gateway Enhancements: partial (network/service binding completed)
A4 Note Frontend: partial (minimum SDK-backed list/create/search/delete UI completed)
D5 Desktop Injection: completed
M6 Mobile Contract Preparation: completed (L2 MOBILE_CONTRACT_READY, not runtime E2E)
T7 Evidence and Gates: partial
```

## Completed

- Added the `official-applet-development` skill under `tooling/skills/`.
- Registered `official-applet-development` in `AGENTS.md`.
- Added official applet architecture contract and scaffold contract.
- Added root scripts:
  - `pnpm applet:create-official`
  - `pnpm applet:official-contract-gate`
  - `pnpm applet:official-skill-discovery-gate`
- Implemented official applet scaffold script:
  - `tooling/scripts/create-official-applet.mjs`
- Implemented official applet gates:
  - `tooling/scripts/applet-official-contract-gate.mjs`
  - `tooling/scripts/applet-official-skill-discovery-gate.mjs`
- Generated Note initial architecture by scaffold:
  - `apps/applets/note/`
  - `model/domain/note/v1/note.proto`
- Refined the scaffold template and regenerated Note contract with:
  - `Note` aggregate naming instead of `NoteRecord`
  - optional update fields
  - list/search ordering
  - `include_deleted`
  - soft-delete restore API
  - HTTP mapping and error mapping contract docs
- Added Note error codes to `model/domain/error/error.proto`.
- Generated proto outputs through the shared proto pipeline:
  - `apps/applets/note/service/model/note.pb.go`
  - `apps/desktop/src/gen/proto/domain/note/v1/note_pb.ts`
  - regenerated shared error proto outputs
- Updated `model/build.sh` so official applet service protos can generate Go models into the applet service module instead of Station app internals.
- Added `apps/applets/note/service/go.mod` and registered it in `go.work`.
- Implemented Note service minimum DDD stack:
  - `domain/` repository contract, domain errors, domain events
  - `application/` use-case service
  - `infrastructure/` GORM repository
  - `transport/` HTTP handler for `/v1/notes`
  - `stationadapter/` bundle constructor for Station-bundled mounting
- Added a real SQLite/GORM integration test covering create, list, search, update, delete, and restore.
- Extended `sdk.network.request` with controlled `query` parameters so applet code does not smuggle query strings through `path`.
- Added Desktop Gateway query parsing and Note public path rewrite from `/v1/...` to Station mount path `/applets/note/v1/...`.
- Added Desktop manifest service contract fields for `publicPathPrefix` and `stationPathPrefix`.
- Added Station-bundled Note mounting through `apps/station/app/subserver/official_applets`, keeping Note business logic in `apps/applets/note/service`.
- Added a Note `stationadapter` mount test that creates and searches a note through `/applets/note/v1/...` against a real SQLite/GORM repository.
- Added `apps/applets/*/frontend` to the PNPM workspace and verified the Note frontend package can typecheck after SDK rebuild.
- Added `pnpm applet:note-real-product-gate`.
- Added a real product-path gate server under Station app tests that starts Note through JWT + `stationadapter` + SQLite/GORM.
- Added a Desktop Gateway Rust gate that creates and searches a Note via `network.request` using `service: "note"` and public `/v1/...` paths, proving Gateway rewrite to `/applets/note/v1/...`.
- Implemented the Note applet frontend minimum ReactLynx UI:
  - SDK-backed list flow
  - SDK-backed sample create flow
  - SDK-backed sample search flow
  - SDK-backed selected-note delete flow
  - localized UI catalog for English and Chinese
- Added `pnpm applet:note-frontend-sdk-gate`.
- Added frontend SDK evidence proving Note frontend has no raw backend URL, Tauri/Desktop/Mobile/Station private dependency, or direct Bridge call, and that formal data access is centralized through `sdk.network.request({ service: "note" })`.
- Added official applet packaging to `pnpm applets:build`, so `apps/applets/note` is built from its source manifest and frontend artifact into `apps/desktop/applets-dist/peers.note`.
- Updated Desktop applet manifest validation to accept canonical dotted applet ids such as `peers.note`.
- Added Desktop applet manager coverage proving the product package reader accepts `peers.note`, preserves the Note `station-resolved` service binding, and creates a Gateway session for the official applet.
- Added `pnpm applet:note-desktop-injection-gate`.
- Added Desktop injection evidence proving `apps/desktop/applets-dist/index.json` includes `peers.note`, `main.lynx.bundle` integrity matches, and the generated Desktop manifest service declaration matches the source applet manifest.
- Added `pnpm applet:note-desktop-live-smoke`.
- Updated the Note ReactLynx build to emit the Desktop/Web Lynx bundle format consumed by `@lynx-js/web-core`.
- Aligned the Desktop Lynx Web runtime dependencies with the official applet rspeedy/react-rsbuild toolchain and documented the version-alignment constraint.
- Hardened Desktop development-mode Lynx Web runtime startup so main-thread bundle sections are available before MTS script execution.
- Added live Desktop Host smoke evidence proving `peers.note` loads from `apps/desktop/applets-dist/peers.note/main.lynx.bundle` through real `AppletManager` + `<lynx-host>` + `<lynx-view>`, then calls:
  - `lifecycle.reportReady`
  - `network.request({ service: "note", method: "GET", path: "/v1/notes" })`
  - `telemetry.track`
  - `lifecycle.destroy`
- Re-ran Note official applet acceptance after D5 and confirmed all official Note evidence files are `PASS / REAL_PRODUCT_PATH`.
- Prepared the Mobile contract path for Note:
  - Note manifest declares Android/iOS `lynx-native` load entries for `main.lynx.bundle`.
  - Android native manifest parser preserves `publicPathPrefix` and `stationPathPrefix` for `station-resolved` services.
  - Android bridge sessions attach manifest service declarations to `network.request`.
  - Android network bridge has a service-bound resolver that validates service id, method, declared path policy, query parameters, and rewrites public `/v1/...` paths to Station `/applets/note/v1/...` paths.
  - Android JVM contract test source covers Note-style service-bound request rewriting and forbidden path rejection.
- Added `pnpm applet:note-mobile-contract-gate`, which writes explicit `CONTRACT_PREPARED_NOT_RUNTIME_E2E` evidence and does not claim Mobile Lynx runtime readiness.

## Verification So Far

```bash
pnpm applet:create-official --id peers.note --service note --name Note --dry-run --with-proto
pnpm applet:create-official --id peers.note --service note --name Note --with-proto
pnpm applet:create-official --id peers.note --service note --name Note --with-proto --force
pnpm applet:official-contract-gate apps/applets/note
pnpm applet:official-skill-discovery-gate
./model/build.sh
cd apps/applets/note/service && go test ./...
cd apps/station/app && go test ./...
pnpm --filter @peers-touch/applet-sdk check
pnpm --filter @peers-touch/applet-sdk build
pnpm --filter @peers-touch/applet-contract check
pnpm --filter @peers-touch/applet-contract build
pnpm --filter @peers-touch/note-official-applet check
pnpm --filter @peers-touch/note-official-applet build
pnpm applet:note-frontend-sdk-gate
pnpm applet:note-desktop-injection-gate
pnpm applet:note-desktop-live-smoke
cd apps/desktop && pnpm run check
pnpm --filter @peers-touch/app-desktop run check
cd apps/desktop/src-tauri && cargo fmt --check
cd apps/desktop/src-tauri && cargo test --bin peers-touch-desktop rewrites_note_public_service_path_to_station_mount_path -- --nocapture
cd apps/desktop/src-tauri && cargo test --bin peers-touch-desktop rejects_note_network_paths_outside_declared_service_policy -- --nocapture
cd apps/desktop/src-tauri && cargo test --bin peers-touch-desktop parses_note_network_query_without_polluting_path_policy -- --nocapture
pnpm applet:note-real-product-gate
pnpm applet:note-mobile-contract-gate
pnpm mobile:check
cd apps/mobile/android && ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools ./gradlew :app:testDebugUnitTest --tests com.peerstouch.mobile.core.applet.AppletBridgeSessionContractTest
pnpm applet:mobile-native-manifest-gate
git diff --check -- package.json tooling/scripts/create-official-applet.mjs tooling/scripts/applet-official-contract-gate.mjs tooling/scripts/applet-official-skill-discovery-gate.mjs tooling/scripts/README.md apps/applets model/domain/note docs/architecture/applet-runtime
git diff --check
```

All commands above passed.

## Evidence Files

```text
applet-readiness-evidence/official-applet/official-contract-gate.json
applet-readiness-evidence/official-applet/official-applet-skill-discovery.json
applet-readiness-evidence/official-applet/note-frontend-sdk-gate.json
applet-readiness-evidence/official-applet/note-desktop-injection-gate.json
applet-readiness-evidence/official-applet/note-desktop-live-smoke.json
applet-readiness-evidence/official-applet/note-real-product-gate.json
applet-readiness-evidence/official-applet/note-mobile-contract-gate.json
applet-readiness-evidence/mobile/native-manifest-gate-output.txt
```

## Next Step

Continue Note applet product work:

1. Finish the remaining A4 UI scope only if needed for product acceptance: editor/update flow, local draft storage, and typed failure states for permission denied, unavailable service, timeout, and not found.
2. Add remaining UI/navigation/event/storage polish only where the Note frontend needs it.
3. Start Mobile runtime evidence only when simulator/emulator/device verification is available:
   - `pnpm applet:ios-lynx-runtime-e2e`
   - `pnpm applet:android-lynx-runtime-e2e`
4. Do not hand-edit structure that should be scaffold-owned unless the scaffold is fixed first.

## Known Verification Notes

- `cd apps/station && go test ./...` currently fails before package execution because the repository `go.work` lists `apps/station/app` and `apps/station/frame`, not `apps/station` as a workspace module root.
- `cd apps/station/app && go test ./...` passed.
- `cd apps/desktop/src-tauri && cargo test --bin peers-touch-desktop application::applets::tests:: -- --nocapture` is not a passing gate. It exposed pre-existing applet test isolation/state issues around manifest mutation, audit assertions, and one long-running timeout path. The three Note/F3-specific Desktop Gateway tests above passed and are the valid evidence for this step.
- Android JVM contract tests require Android SDK env. The direct Gradle command passes when run with `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools` and `ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools`; `pnpm applet:mobile-native-manifest-gate` also detected that SDK path and executed the same contract test. This still does not claim Android Lynx runtime E2E.
