# CHAT-06 Live One-To-One Voice

## Task Slice

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-task-slice",
  "planId": "CHAT-LIFECYCLE-20260916",
  "taskId": "CHAT-06-live-voice",
  "workstreamId": "CHAT-W05",
  "title": "Product-grade one-to-one live voice",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "chat-live-voice",
  "journeyId": "CHAT-J05",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/realtime",
    "apps/station/app/subserver/events",
    "apps/station/frame/core/federation",
    "apps/desktop",
    "tooling/acceptance",
    "packages/locales"
  ],
  "readSet": [
    "docs/architecture/chat-lifecycle",
    "docs/architecture/realtime",
    "docs/client/chat"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 240
  },
  "checks": [
    {
      "id": "chat-live-voice-source",
      "command": "pnpm --dir apps/desktop exec vitest run src/modules/p2p src/components/chat",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "chat-live-voice-functional",
      "command": "python3 -m tooling.acceptance.gates.chat.lifecycle_live_voice",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-live-voice-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-live-voice-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Native clients prove ring, accept, reject, no-answer, active audio, reconnect, and hangup",
    "Direct ICE and TURN fallback use the same authenticated discovery path",
    "Calls work from a valid Direct conversation without unrelated P2P readiness",
    "Text remains usable and all call resources are released"
  ],
  "failureBehavior": [
    "Expose permission, timeout, network, and relay failures as distinct states",
    "Never restore ICE polling, a second signaling channel, or foreign-Station client access"
  ],
  "updatedAt": "2026-09-16T07:45:00Z",
  "durableEvidence": []
}
```

## Objective

Turn the existing Desktop WebRTC skeleton into a proven Chat capability using
the accepted Realtime and TURN boundaries.

## Current Snapshot

- WebRTC, sealed signaling, TURN discovery, and call UI exist.
- Call entry is gated by unrelated P2P connection state.
- No executable two-profile live-call evidence exists.
