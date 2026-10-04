# W7-RUNTIME-FENCING - Native Lifecycle And Permission Truth

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W7-RUNTIME-FENCING",
  "workstreamId": "W7",
  "title": "Native readiness, lifecycle fencing, and permission truth",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "W7-runtime-fencing-source",
  "journeyId": "MS-J02..MS-J07-native-runtime",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/runtimes/mobileNativeEventBridge.ts",
    "apps/mobile/src/runtimes/mobileNativeEventBridge.test.ts",
    "apps/mobile/src/runtimes/nativeLifecycleBridge.ts",
    "apps/mobile/src/runtimes/nativeLifecycleBridge.test.ts",
    "apps/mobile/src/runtimes/runtimeRegistry.ts",
    "apps/mobile/src/runtimes/runtimeRegistry.test.ts",
    "apps/mobile/src-tauri/src/commands/mod.rs",
    "apps/mobile/src-tauri/src/commands/platform_bridge.rs",
    "apps/mobile/src-tauri/src/platform/background_bridge.rs",
    "apps/mobile/src-tauri/src/platform/lifecycle_bridge.rs",
    "apps/mobile/src-tauri/src/platform/network_bridge.rs",
    "apps/mobile/src-tauri/plugins/platform-permissions/android/src/main/java/PlatformPermissionsPlugin.kt",
    "apps/mobile/src-tauri/plugins/platform-permissions/ios/Sources/PlatformPermissionsPlugin.swift",
    "apps/mobile/scripts/ios_native_correctness_test.py"
  ],
  "readSet": [
    "docs/architecture/mobile",
    "docs/client/mobile"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 600,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "native-runtime-focused",
      "command": "pnpm --dir apps/mobile run check:native-platforms",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mobile-runtime-focused",
      "command": "pnpm --dir apps/mobile exec vitest run src/runtimes/mobileNativeEventBridge.test.ts src/runtimes/nativeLifecycleBridge.test.ts",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Native readiness resolves only after listeners and the initial network snapshot are active",
    "Lifecycle and network callbacks are fenced to the current Rust-owned generation",
    "Foreground resume occurs before authoritative reconciliation and callers cannot fabricate reconciliation reports",
    "Android selected-photo and iOS permission request states are internally consistent and main-thread safe",
    "Native source checks claim only checks they actually execute"
  ],
  "failureBehavior": [
    "Do not invent APNs, FCM, BGTaskScheduler, scheduled-work, or media-picker result semantics",
    "Do not accept simulator evidence as physical native proof",
    "Required simulator platform proof remains in W7-PROOF; physical execution is optional diagnostics"
  ],
  "updatedAt": "2026-09-17T02:55:00.000Z"
}
```

## Objective

Close the accepted native lifecycle, network, permission, and reconciliation
source semantics without expanding into owner-undefined push, scheduled-work, or
media-picker contracts.

## Current Snapshot

- Native start currently acknowledges readiness before every listener and the
  first network snapshot are observably active.
- Callback sequence checks exist, but generation binding and resume-before-
  reconcile ordering remain incomplete.
- The Rust reconciliation reader exists while a public command can still build
  a caller-supplied report.
- Android selected-photo state contradicts its own requestability branch; iOS
  permission completion can leave main-thread-owned state from an async callback.

## Source Closure

- The native-event runtime awaits all bridge listener installations and the
  first native network observation before bootstrap completes.
- Native lifecycle callbacks continue through Rust generation ownership;
  network ingest now returns the current Rust generation and TS drops stale
  results.
- Foreground handling awaits lifecycle resume before invoking Rust-owned
  reconciliation. Callers can provide only session validity; Reliability owns
  pending, unknown, and draft readback counts.
- Android selected-photo access is usable and non-requestable. iOS permission
  request state and completion return to the main queue.
- Native source checks describe source/parity and Rust tests only; no Swift or
  Kotlin compile proof is claimed.

## Verification Snapshot

- Native TS runtime suite: 24/24 PASS.
- Native source/parity suite: 13/13 PASS.
- Rust platform suite: 23/23 PASS.
- TypeScript and Plan Package validation: PASS.
- Required simulator native-platform proof remains deferred to `W7-PROOF`;
  physical native execution is optional diagnostics.

## Concurrency Decision

- Execute serially because native plugin readiness, Rust generation fencing, and
  TS resume ordering form one lifecycle transition.
- Keep optional physical diagnostics and owner-undefined native capabilities
  parked.
