# CHAT-06 Group Live Voice And Video

## Task Slice

```json
{

  "kind": "peers-touch-task-slice",
  "planId": "CHAT-LIFECYCLE-20260916",
  "taskId": "CHAT-06-group-live",
  "workstreamId": "CHAT-W05B",
  "title": "Product-grade group live voice and video",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "chat-group-live",
  "journeyId": "CHAT-J09",
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
    "docs/architecture/messaging-platform"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "chat-group-live-source",
      "command": "python3 -m unittest tooling.acceptance.gates.chat.lifecycle_group_live_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "chat-group-live-functional",
      "command": "python3 -m tooling.acceptance.gates.chat.lifecycle_group_live",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-group-live-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-group-live-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Three or more authorized members complete one group audio and one group video call from an active Group conversation",
    "Invite, join, decline, late join, leave, reconnect, and room end converge on one room and participant identity",
    "Participant roster, active speaker, mute, camera, reconnecting, removed, and revoked states agree across clients",
    "Membership removal and device revoke stop future signaling and media without affecting retained members",
    "Desktop proves native permission, camera, layout, reconnect, and cleanup behavior",
    "Same-Station and cross-Station Desktop calls use the accepted authenticated SFU boundary"
  ],
  "failureBehavior": [
    "Keep the Group conversation usable and expose permission, capacity, membership, network, and media failures distinctly",
    "Never fall back to unbounded peer-to-peer mesh, duplicate participant truth, or continued delivery to removed or revoked endpoints"
  ],
  "updatedAt": "2026-09-18T01:38:00Z",
  "durableEvidence": []
}
```

## Objective

Add lightweight group voice and video calls to the normal Group Chat lifecycle
without turning Chat into a scheduled webinar or enterprise meeting product.

## Current Snapshot

- Product scope and receiver-visible Journey are accepted as `CHAT-C12` and
  `CHAT-J09`.
- One-to-one signaling, WebRTC/TURN, Group membership, and MLS foundations are
  reusable only after their ownership boundaries are mapped explicitly.
- Activation is prohibited until a reviewed SFU/room architecture defines
  authorization, encryption, capacity, cross-Station routing, and cleanup.
