# NCP-04: Durable Cross-Node Event Delivery

## Task Slice

```json
{
  "kind": "peers-touch-task-slice", "planId": "NCP-UNIFIED-STATION-20261011",
  "taskId": "NCP-04", "workstreamId": "NCP-SHARED-TRUTH",
  "title": "Make ordered device-safe events recoverable on any subscriber node",
  "workClass": "refactor", "completionClass": "functional", "executionMode": "build",
  "closureId": "ncp-durable-events", "journeyId": "NCP-G04", "runtimeClass": "service",
  "writeSet": ["apps/station/app/subserver/events", "apps/station/frame/core/store", "model/domain/realtime", "apps/station/frame/touch/model", "tooling/acceptance", "tooling/scripts", "docs"],
  "readSet": ["apps/station/frame", "apps/station/app"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 300, "cleanupSeconds": 60},
  "checks": [
    {"id": "events-source", "command": "go test ./apps/station/app/subserver/events/... -count=1", "verificationClass": "SOURCE_CHECK"},
    {"id": "events-functional", "command": "python3 tooling/scripts/node-connectivity-journey.py --closure ncp-durable-events --functional", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "events-proof", "command": "python3 tooling/scripts/acceptance-run.py --gate NCP-G04", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "runtimeReuse": {"scope": "suite", "entryCheckId": "events-functional", "scenarioIds": ["NCP-G04-ORDER", "NCP-G04-DEVICE", "NCP-G04-WAKE-LOSS"], "maxProvisioningRuns": 1, "maxClientLaunches": 2, "minWarmReuseRate": 0.66, "requireAttachOnlyScenarios": true, "requireReceiverVisibleProof": true, "allowClientReplacement": false},
  "doneWhen": ["Events allocate per-Actor sequence and persist payload/target in the emitting transaction.", "Two processes deliver through high-watermark replay with missed-wake repair and durable device filtering.", "Ephemeral events cannot advance durable cursor; retention gaps invoke explicit Resync."],
  "failureBehavior": ["Do not sort replay by process ULID or lose target device on persistence.", "No Relay business pubsub or silent dropped committed event.", "This closure does not claim complete cluster readiness."],
  "updatedAt": "2026-10-11T00:00:00.000Z"
}
```

## Current Snapshot

Bus fanout and IDs are local; durable event rows do not persist target device.

## Verification Contract

Harness emits a committed event on A while B owns subscriptions; assert ordered
payload at B, rollback exclusion, concurrent actor ordering, replay/live boundary
and targeted event privacy. Drop NOTIFY, reconnect and restart the subscriber
process; authoritative shared log readback is the independent oracle.
All steps use the Suite harness; integrated native rendering is NCP-08.
