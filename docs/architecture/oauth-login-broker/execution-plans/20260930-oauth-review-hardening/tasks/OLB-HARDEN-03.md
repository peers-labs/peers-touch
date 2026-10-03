# OLB-HARDEN-03: Harden Operator And Completion State

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "OLB-HARDEN-20260930",
  "taskId": "OLB-HARDEN-03",
  "workstreamId": "OLB-SERVICE",
  "title": "Bound unauthenticated admin work and reconcile status",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "olb-operator-hardening",
  "journeyId": "OLB-J03",
  "runtimeClass": "browser",
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
      "id": "olb-admin-auth",
      "command": "cd apps/oauth2-client && go test -race ./internal/interfaces/http/handler ./api/admin ./api/admin/data",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-admin-browser",
      "command": "cd apps/oauth2-client && go test ./internal/integration -run TestOAuthLoginBrokerJourney",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "olb-hardening-completion",
      "command": "make acceptance-run-completion",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Missing Basic credentials return before password derivation",
    "Authenticated admin behavior and security headers remain unchanged",
    "OAuth task and module status projections match completed delivery",
    "The exact-source operator and completion Acceptance Gates pass"
  ],
  "failureBehavior": [
    "Do not weaken wrong-credential comparison behavior",
    "Do not expose credential or configuration material",
    "Do not mutate unrelated module status"
  ],
  "updatedAt": "2026-09-30T00:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: done.
- Missing Basic credentials return before PBKDF2, concurrent derivations are
  bounded per instance, and supplied wrong credentials retain the normal
  constant-time comparison path.
- OAuth task and module status projections match the completed implementation,
  and exact-source operator and completion Acceptance checks pass.

## Closure

Unauthenticated operator requests are bounded and formal OAuth status documents
match the completed implementation.

## Concurrency Decision

- Mode: serial.
- Reason: final browser and completion proof depend on the login and refresh
  hardening Tasks.
