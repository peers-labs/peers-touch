# Android Host Architecture

> **Status**: source-complete, runtime-unproven
> **Owner**: Mobile Architecture Team
> **Updated**: 2026-10-17

## Boundary

Android is a Host for the single Mobile Client Form. Kotlin owns Android API
adaptation only:

```text
Android API
  -> platform-permissions Kotlin adapter
  -> typed Tauri plugin response/callback
  -> Mobile Rust validation and generation fence
  -> shared Mobile runtime projection
```

Kotlin does not own navigation state, Station policy, business retries,
reconciliation, or provider DTOs.

## Contracts

- System back uses Tauri's app-level `back-button` event. `MobileShell` closes
  overlay first, then detail, and invokes the typed `return_to_system` action
  only at root. The navigation store does not import Android APIs.
- `PeersFirebaseMessagingService` receives FCM token rotation and data
  notifications. Provider data is drained directly into Rust and never enters
  Web state.
- Push registration, receipt, tap, and registration failure use one durable
  native callback queue. Rust remains the sole generation fence and
  reconciliation owner.
- `ReconcileWorker` records a durable wake marker without requiring an
  Activity or plugin instance. The next current-generation Host activation
  materializes the wake callback for Rust reconciliation. Rust supplies an
  opaque Station/PTID/session/device scope token: a generation-only restart
  rebinds durable callbacks, while a real scope change clears them.
- Camera capture uses `FileProvider` plus `MediaStore.EXTRA_OUTPUT`; picker and
  camera results copy full streams into bounded native staging. Thumbnail
  extras are forbidden.
- Capability observation returns only
  `available | unavailable | denied | restricted | unsupported | unknown`.
  Product admission remains outside Kotlin.

## Provider Admission

FCM is available only when Firebase has a real application configuration and
notification admission is not denied. Missing provider configuration returns
`unavailable`; `armPush` returns `armed=false`. Source presence never implies
provider readiness.

The Host Suite parent validates private configuration files before acquisition:
the Firebase application must match the Mobile bundle ID and service-account
project, and the account must contain a valid RSA signing key. Only the
validated Firebase application resources enter the controlled Gradle build
environment and its digest. Provider signing credentials remain parent-only.
Both Acceptance and release builds use the same application resource input.

## Evidence

Source checks cover the adapter, manifest, typed Rust/TypeScript boundary,
durable handoff, back ordering, and full-resolution media path. Runtime support
requires one source-bound physical Android Suite proving build, install,
launch, background recovery, FCM token/receipt/tap, system back, picker/camera,
receiver-visible outcomes, and cleanup.

The current machine has no Android SDK/NDK or connected physical Android
device. `unified-client-android-host-e2e` therefore remains
`BLOCKED/UNPROVEN`.
