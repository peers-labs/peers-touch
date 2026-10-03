# OLB-HARDEN-01: Harden Login Transport And Storage

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "OLB-HARDEN-20260930",
  "taskId": "OLB-HARDEN-01",
  "workstreamId": "OLB-SERVICE",
  "title": "Require production HTTPS and bounded GitHub storage calls",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "olb-login-hardening",
  "journeyId": "OLB-J01",
  "runtimeClass": "service",
  "writeSet": [
    "apps/oauth2-client",
    "tooling/acceptance/gates/oauth2_client"
  ],
  "readSet": [
    "docs/architecture/oauth-login-broker",
    "docs/knowledge"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "olb-review-focused",
      "command": "cd apps/oauth2-client && go test -race ./...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-review-functional",
      "command": "cd apps/oauth2-client && go test ./internal/integration -run TestOAuthLoginBrokerJourney",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "olb-review-acceptance",
      "command": "make acceptance-run",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Production provider redirects require HTTPS",
    "GitHub storage uses a bounded HTTP client",
    "The exact-source durable-login and architecture Gates pass"
  ],
  "failureBehavior": [
    "Do not weaken credential encryption or callback validation",
    "Do not expose provider, GitHub, admin, or bridge secrets",
    "Do not broaden unrelated Chat, Mobile, Desktop, or Station gates",
    "Do not mutate the target integration worktree"
  ],
  "updatedAt": "2026-09-30T00:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: done.
- Production rejects non-HTTPS provider redirects and requires signed,
  allowlisted callback destinations.
- GitHub storage uses a bounded HTTP client, and the exact-source login and
  architecture Gates pass.

## Closure

The OAuth broker enforces production transport and bounded GitHub storage
resource behavior.

## Concurrency Decision

- Mode: serial.
- Reason: production callback and storage bootstrap share the login Journey.
