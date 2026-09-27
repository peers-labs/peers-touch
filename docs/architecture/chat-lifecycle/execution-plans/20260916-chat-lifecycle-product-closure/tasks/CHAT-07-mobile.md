# CHAT-07 Mobile Product Parity

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CHAT-LIFECYCLE-20260916",
  "taskId": "CHAT-07-mobile",
  "workstreamId": "CHAT-W06",
  "title": "Mobile full-lifecycle Chat parity",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "chat-mobile",
  "journeyId": "CHAT-J06",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile",
    "packages/messaging-core",
    "packages/client-chat-core",
    "tooling/acceptance",
    "packages/locales"
  ],
  "readSet": [
    "docs/architecture/chat-lifecycle",
    "docs/architecture/messaging-platform",
    "docs/architecture/realtime",
    "docs/client/chat"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 3000,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "chat-mobile-source",
      "command": "pnpm --filter @peers-touch/mobile check && cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "chat-mobile-functional",
      "command": "python3 -m tooling.acceptance.gates.mobile.lifecycle_chat",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-mobile-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-mobile-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Mobile completes discovery, relationship, Direct, Group, interaction, and projection journeys",
    "Recorded voice capture/playback, one-to-one calls, and group audio/video calls use real native permission, camera, background, and audio-route lifecycle",
    "Three or more Mobile participants converge on one authorized group-call room and participant roster",
    "Failed messages never render as read and actionable retry is visible",
    "Registered native scenarios execute on required iOS and Android cells"
  ],
  "failureBehavior": [
    "Report unavailable hardware or authorization as typed blocked evidence",
    "Do not substitute fake-memory, injected identity, screenshots, or Desktop proof"
  ],
  "updatedAt": "2026-09-16T07:45:00Z",
  "durableEvidence": []
}
```

## Objective

Make Mobile a real consumer of the same product contract instead of a
contract-only or Desktop-derived claim.

## Current Snapshot

- Core Mobile messaging implementation is substantial.
- Required native Chat gates are unimplemented or unrun.
- Voice message UI/playback and live calls are missing.
