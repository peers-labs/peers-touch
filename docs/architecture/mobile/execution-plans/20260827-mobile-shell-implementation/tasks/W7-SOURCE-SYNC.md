# W7-SOURCE-SYNC - Native Project Source Parity

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W7-SOURCE-SYNC",
  "workstreamId": "W7",
  "title": "Native project source and generated-project parity",
  "workClass": "infrastructure",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "W7-source-sync",
  "journeyId": "MS-J02..MS-J07-native-source",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/scripts",
    "apps/mobile/src-tauri/gen/apple/project.yml",
    "apps/mobile/src-tauri/gen/apple/peers-touch-mobile.xcodeproj/project.pbxproj",
    "apps/mobile/src-tauri/plugins/platform-permissions"
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
      "id": "native-source-focused",
      "command": "pnpm --dir apps/mobile run check:native-platforms",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "XcodeGen source and committed Xcode project are semantically synchronized",
    "Existing Android and iOS permission, lifecycle, network, deep-link, and secure-storage ports pass declared source/parity checks",
    "Synthetic native events remain Acceptance-only"
  ],
  "failureBehavior": [
    "Do not hardcode a signing team in generated project output",
    "Do not claim APNs, scheduled background work, or media-picker completion",
    "Required simulator platform proof remains in W7-PROOF; physical execution is optional diagnostics"
  ],
  "updatedAt": "2026-09-16T14:50:22.000Z"
}
```

## Objective

Close the dependency-ready native source integrity slice without inventing the
still-undefined push, scheduled-work, or media-result contracts.

## Current Snapshot

- Permission, lifecycle, network, deep-link, secure-storage, and
  Acceptance-only synthetic-event source checks pass.
- The committed Xcode project was regenerated from `project.yml`; project and
  target build settings now preserve `$(APPLE_DEVELOPMENT_TEAM)` instead of a
  concrete local team identifier.

## Concurrency Decision

- Execution is serial. `project.yml` is the source of truth and XcodeGen is the
  sole writer of the committed Xcode project; parallel edits to generated
  output would invalidate parity.
- Existing Swift, Kotlin, Rust, and TypeScript checks are read-only verification
  lanes after regeneration. The integrator owns generated output, this Task
  snapshot, manifest advancement, and final reconciliation.
- No subagent lane is justified because the only failing source check is one
  deterministic generator drift and the generated project shares all relevant
  inputs.

## Verification Snapshot

- `pnpm --dir apps/mobile run check:native-platforms`: PASS (`17` TypeScript,
  `9` Python source/parity, and `23` Rust platform tests); this command does not
  compile Swift or Kotlin and makes no such claim.
- `pnpm --dir apps/mobile run check:ios-project`: PASS; Xcode lists the
  `peers-touch-mobile_iOS` target and scheme with debug/release configurations.
- No physical APNs, scheduled background work, media-picker, or device behavior
  is claimed by this source-only closure; those paths are optional diagnostics.

## Queue Exhaustion

- After this source closure, the manifest has no dependency-ready pending Task.
- `W2`, `W3-PROOF`, `W4-PROOF`, `CA-HC-PROOF`, and `W5-OWNER` remain the
  blocking roots; all other pending Tasks depend transitively on those roots.
- Adding synthetic tasks would inflate progress without closing a source,
  owner-contract, or required simulator-proof requirement, so the package must
  enter its declared blocked state under DWF-D13/DWF-D14.
