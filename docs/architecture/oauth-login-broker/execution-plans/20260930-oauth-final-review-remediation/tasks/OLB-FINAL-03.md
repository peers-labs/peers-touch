# OLB-FINAL-03: Converge Concurrent Refresh

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "OLB-FINAL-20260930",
  "taskId": "OLB-FINAL-03",
  "workstreamId": "OLB-SERVICE",
  "title": "Converge duplicate refresh after provider failure",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "olb-final-refresh",
  "journeyId": "OLB-J02",
  "runtimeClass": "service",
  "writeSet": [
    "apps/oauth2-client/internal/application/oauth/usecase",
    "docs/architecture/oauth-login-broker"
  ],
  "readSet": [
    "docs/knowledge"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "olb-final-refresh-race",
      "command": "cd apps/oauth2-client && go test -race ./internal/application/oauth/usecase",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-final-refresh-functional",
      "command": "make dev-functional-result WORK_ITEM=OLB-FINAL-03 RUNTIME_CELL=oauth2-client-local-service REASON='verify concurrent refresh convergence'",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "olb-final-refresh-acceptance",
      "command": "make acceptance-run",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "A duplicate refresh rechecks durable operation state after provider failure",
    "A concurrent winner makes the losing duplicate return the committed credential",
    "Provider failures with no committed winner remain failures",
    "Race and refresh-idempotency tests pass"
  ],
  "failureBehavior": [
    "Do not treat an unrelated completed operation as success",
    "Do not retry provider calls without the bounded attempt policy",
    "Do not return stale credential material"
  ],
  "updatedAt": "2026-09-30T00:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- Duplicate refresh requests recheck the durable operation marker after a
  provider failure and converge to a concurrently committed credential without
  another provider call.

## Closure

Concurrent duplicate refresh requests converge to the committed operation
result across both provider-success and provider-failure interleavings.

## Concurrency Decision

- Mode: serial.
- Reason: this changes the refresh state machine and its retry boundary.
