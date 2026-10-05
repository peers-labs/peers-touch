# W6B-WIRE - Moments Wire Decoding

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W6B-WIRE",
  "workstreamId": "W6B",
  "title": "Moments generated wire decoding",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "W6B-wire-source",
  "journeyId": "MS-J05-wire",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/services/gateways/gatewayTypes.ts",
    "apps/mobile/src/services/gateways/momentsGateway.test.ts",
    "apps/mobile/src/services/gateways/momentsGateway.ts",
    "apps/mobile/src/features/social/socialNormalizers.ts"
  ],
  "readSet": [
    "apps/station/frame/core/server/serializer.go",
    "docs/architecture/platform/client/mobile",
    "docs/architecture/domains/social/runtime",
    "model/domain/social"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 300,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "moments-wire-focused",
      "command": "pnpm --dir apps/mobile exec vitest run src/services/gateways/momentsGateway.test.ts src/features/social/momentsFeedStore.test.ts",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Station protobuf JSON responses are decoded into generated Moments shapes",
    "Snake-case wire fixtures prove parity with Station serialization",
    "No unchecked raw JSON cast crosses the Moments gateway boundary"
  ],
  "failureBehavior": [
    "Do not normalize wire incompatibility inside UI components",
    "Malformed Station payloads fail visibly",
    "Native receiver proof remains in W6B-PROOF"
  ],
  "updatedAt": "2026-09-16T14:38:17.000Z"
}
```

## Objective

Make the Moments gateway consume the real Station protobuf JSON shape rather
than test-only camelCase objects.

## Current Snapshot

- All seven JSON Moments response paths now decode through their generated
  protobuf response schemas at the gateway quarantine boundary.
- Station command failures pass through unchanged; malformed protobuf JSON
  fails with `INVALID_MOMENTS_RESPONSE` and an operation-specific locale key.
- Snake-case fixtures cover nested posts, oneofs, timestamps, int64 values,
  authors, reactions, explanations, comments, and cursor fields.

## Concurrency Decision

- Execution is serial. One shared generated-JSON decoder and the Moments
  endpoint adapters form one gateway boundary with one focused test suite.
- The integrator owns gateway contracts, tests, manifest advancement, and the
  final reconcile. `W7-SOURCE-SYNC` remains ready but is not a concurrent
  current Task.

## Verification Snapshot

- `momentsGateway.test.ts` plus `momentsFeedStore.test.ts`: 40/40 PASS.
- `pnpm --dir apps/mobile run check:web`: PASS, including Social wire and
  runtime-boundary checks plus TypeScript.
- Source scan finds generated schemas on timeline, post, reaction, comment,
  comment-create, and comment-delete paths; no typed Moments response is
  returned directly from raw `command<T>()`.
