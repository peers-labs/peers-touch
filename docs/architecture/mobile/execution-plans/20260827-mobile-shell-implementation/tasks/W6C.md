# W6C - Profile And Settings Product Closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W6C",
  "workstreamId": "W6C",
  "title": "Profile, Notification, and Settings cross-client CAS hard cut",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "W6C-source",
  "journeyId": "MS-J06-source",
  "runtimeClass": "source-only",
  "writeSet": [
    "model/domain/actor",
    "model/domain/notification",
    "apps/station/frame/touch/actor",
    "apps/station/frame/touch/actor_handler.go",
    "apps/station/frame/touch/model",
    "apps/station/frame/touch/model/db",
    "apps/station/app/subserver/notification",
    "apps/desktop/src-tauri/src/application/profile",
    "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
    "apps/desktop/src-tauri/src/interface/tauri_commands/notification.rs",
    "apps/desktop/src-tauri/src/messaging/conversation_state.rs",
    "apps/desktop/src-tauri/src/messaging/engine.rs",
    "apps/desktop/src-tauri/src/messaging/store.rs",
    "apps/desktop/src-tauri/src/messaging/transport.rs",
    "apps/desktop/src-tauri/src/model",
    "apps/desktop/src/gen/proto/domain/actor",
    "apps/desktop/src/gen/proto/domain/notification",
    "apps/mobile/src-tauri/src/runtime/station_transport",
    "apps/mobile/src/gen/proto/domain/actor",
    "apps/mobile/src/gen/proto/domain/notification",
    "apps/mobile/src/pages/SettingsPage.tsx",
    "apps/mobile/src/pages/settings",
    "apps/mobile/src/features/social/socialRuntime.ts",
    "apps/mobile/src/features/social/socialRuntime.test.ts",
    "apps/mobile/src/features/social/socialStore.ts",
    "apps/mobile/src/features/social/socialTypes.ts",
    "apps/mobile/src/runtimes",
    "apps/mobile/src/services/gateways",
    "apps/mobile/src/styles.css",
    "packages/prototypes/mobile/chat",
    "docs/architecture/mobile",
    "docs/architecture/notification/notification-architecture.md",
    "tooling/acceptance/gates/mobile"
  ],
  "readSet": [
    "docs/architecture/api-ownership",
    "docs/architecture/messaging-platform",
    "docs/architecture/mobile",
    "docs/architecture/notification",
    "docs/architecture/social-runtime",
    "docs/client/mobile",
    "docs/client/desktop"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 600,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "settings-proto",
      "command": "./model/build.sh && ./tooling/scripts/proto-gen-mobile.sh web",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "settings-station",
      "command": "cd apps/station && go test ./frame/touch/actor ./app/subserver/notification/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "settings-desktop",
      "command": "pnpm --dir apps/desktop run check && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "settings-source",
      "command": "pnpm --dir apps/mobile run check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "settings-focused",
      "command": "pnpm --dir apps/mobile exec vitest run src/features/social/socialRuntime.test.ts src/features/social/socialStore.profileSessionFence.test.ts src/runtimes/profileProjectionDescriptor.test.ts src/pages/settings/SettingsPage.test.ts src/pages/settings/SettingsSections.test.tsx src/pages/settings/devicePreferences.test.ts src/pages/settings/useSettingsController.test.ts src/services/gateways/profileGateway.test.ts",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "settings-prototype-sync",
      "command": "pnpm --dir packages/prototypes/mobile/chat build --configLoader runner",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "No additional account-preference owner or placeholder section exists",
    "Profile uses one dedicated editable-state revision and atomic Actor/meta CAS",
    "Notification uses one aggregate revision and atomic multi-category batch CAS",
    "Desktop and Mobile use the generated revisioned contracts with no unrevisioned mutation path",
    "Each Settings detail saves only its selected owner and preserves draft/conflict state through lost-response reconciliation",
    "Social blocked users and device settings remain at their canonical owners"
  ],
  "failureBehavior": [
    "Missing or zero revisions fail closed",
    "Profile counters never advance the editable Profile revision",
    "Notification batches never partially commit",
    "Unavailable Station owners remain explicit without local fallback truth",
    "Do not collapse settings into ActorPreferences or a generic settings store",
    "Do not project an empty blocked list when Social is unavailable",
    "Native second-device conflict proof remains in W6C-PROOF"
  ],
  "updatedAt": "2026-09-19T00:49:00.000Z"
}
```

## Objective

Complete profile, account, device, and settings source through explicit owner boundaries.

## Current Snapshot

- `MS-D22A` is accepted: no additional account-preference owner exists in this
  release; Profile and Notification require one cross-client CAS hard cut.
- Existing Actor Profile privacy, Notification, and device-setting source
  closures are preserved; divergent post-write readback remains conflict.
- Settings consumes the W5-SOCIAL blocked-list and revisioned unblock owner
  through Social runtime intents. Unavailable and empty remain distinct.
- The confirmed Mobile prototype reflects the blocked-user owner and removes
  the nonexistent additional account-preference section.
- The source slice covers Model, Station, Desktop, Mobile Rust/Web, and
  generated bindings so revision enforcement has no compatibility path.
- Desktop command preparation and interaction projections consume the current
  generated Chat contract without untyped or wildcard compatibility handling.
- Native conflict and second-device proof belongs to W6C-PROOF.
