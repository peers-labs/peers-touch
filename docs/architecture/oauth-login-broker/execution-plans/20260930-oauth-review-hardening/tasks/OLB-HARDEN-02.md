# OLB-HARDEN-02: Fence Concurrent Refresh

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "OLB-HARDEN-20260930",
  "taskId": "OLB-HARDEN-02",
  "workstreamId": "OLB-SERVICE",
  "title": "Reject stale provider refresh results",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "olb-refresh-hardening",
  "journeyId": "OLB-J02",
  "runtimeClass": "service",
  "writeSet": [
    "apps/oauth2-client",
    "docs/architecture/oauth-login-broker",
    "tooling/acceptance/gates/oauth2_client"
  ],
  "readSet": [
    "docs/knowledge"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "olb-refresh-race",
      "command": "cd apps/oauth2-client && go test -race ./internal/application/oauth/usecase ./internal/infrastructure/persistence/github ./internal/infrastructure/persistence/memory",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-refresh-functional",
      "command": "cd apps/oauth2-client && go test ./internal/integration -run TestOAuthLoginBrokerJourney",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "olb-refresh-acceptance",
      "command": "make acceptance-run",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "A provider result cannot overwrite a newer credential generation",
    "Concurrent duplicate operations converge to one committed mutation",
    "The exact-source refresh-idempotency Gate passes"
  ],
  "failureBehavior": [
    "Do not reuse a stale provider result after a generation conflict",
    "Do not weaken refresh-token retention or operation idempotency",
    "Do not expose credential material"
  ],
  "updatedAt": "2026-09-30T00:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: pending.
- Refresh reads credential generation before an external provider call but does
  not fence replacement against a newer generation.

## Closure

Concurrent refresh operations cannot replace credentials derived from a newer
generation.

## Concurrency Decision

- Mode: serial.
- Reason: expected-generation semantics must land atomically across use case,
  memory adapter, GitHub adapter, and tests.
