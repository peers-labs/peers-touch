# CHAT-05A Presence And Conversation Layout Stability

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CHAT-LIFECYCLE-20260916",
  "taskId": "CHAT-05A-presence-layout",
  "workstreamId": "CHAT-W04A",
  "title": "Authoritative peer presence and stable conversation geometry",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "chat-presence-layout",
  "journeyId": "CHAT-J02",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "docs/architecture/chat-lifecycle",
    "docs/architecture/identity",
    "apps/station/app/subserver/presence",
    "apps/station/frame/core/federation",
    "apps/desktop",
    "packages/client-chat-core",
    "tooling/acceptance",
    "packages/locales"
  ],
  "readSet": [
    "docs/architecture/chat-lifecycle",
    "docs/architecture/federation",
    "docs/architecture/social-runtime",
    "docs/client/chat"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "chat-presence-layout-source",
      "command": "go test ./apps/station/app/subserver/presence/... ./apps/station/frame/core/federation/... && pnpm --dir apps/desktop exec vitest run src/services/chatPresence.test.ts src/services/socialRealtime.test.ts src/components/chat",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "chat-presence-layout-functional",
      "command": "python3 -m tooling.acceptance.gates.chat.lifecycle_presence_layout",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-presence-layout-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-presence-layout-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "CHAT-UR14: both active native peers show snapshot-plus-event authoritative online presence across focus changes and beyond one lease interval; omitted or failed presence remains unavailable rather than guessed offline",
    "The local Station partitions presence queries by verified actor Home Station and uses authenticated Federation peer calls for remote authoritative snapshots without direct client access to foreign Stations",
    "Presence snapshot, realtime flip, reconnect reconciliation, actor teardown, and rendering share one canonical PTID-keyed projection",
    "CHAT-UR15: zero, single-digit, and capped multi-digit unread badge states never change conversation-row height, vertical position, or text-column geometry",
    "CHAT-UR16: thread counts, reactions, stickers, and message actions never change neighboring message-row geometry or the visible scroll anchor",
    "Two-peer native functional proof observes the receiver perspective and deterministic before/after layout measurements",
    "No debug telemetry or local instrumentation endpoint remains in the production presence path"
  ],
  "failureBehavior": [
    "Preserve unknown presence as unavailable and retry bounded authoritative reconciliation",
    "Stop on guessed offline state, stale online state beyond the accepted lease, layout shift, scroll-anchor drift, or hidden overflow"
  ],
  "updatedAt": "2026-09-20T08:30:00Z",
  "status": "done",
  "durableEvidence": [
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "chat-presence-layout-e2e/20260920T082204451246Z-6b649986fcd0d6ac54724ff0d8ceb586 (23/23 PROVEN at af518b787)"
    }
  ]
}
```

## Objective

Close the reported presence and geometry regressions at their owning projection
and component-layout layers without weakening authoritative presence semantics.

## Current Snapshot

- Active two-peer conversations can render both peers as offline.
- Unread badges and interaction metadata can resize rows and shift adjacent
  conversation or message content.
- Existing Direct and interaction Gates do not measure these regressions.
