# OLB-02: Refresh And Idempotency

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "OLB-20260930",
  "taskId": "OLB-02-REFRESH-IDEMPOTENCY",
  "workstreamId": "OLB-SERVICE",
  "title": "Complete provider refresh and uncertain-response idempotency",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "olb-refresh-idempotency",
  "journeyId": "OLB-J02",
  "runtimeClass": "service",
  "writeSet": [
    "apps/oauth2-client",
    "docs/architecture/oauth-login-broker"
  ],
  "readSet": [],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "olb-provider-refresh",
      "command": "cd apps/oauth2-client && go test ./internal/infrastructure/provider/... ./internal/application/oauth/usecase/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-idempotency",
      "command": "cd apps/oauth2-client && go test ./internal/application/oauth/usecase ./internal/infrastructure/persistence/github -run 'TestRefreshCredential|TestStoreConvergesRefreshAfterLostRefUpdateResponse'",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "olb-refresh-acceptance",
      "command": "make acceptance-run",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "GitHub, Google, and Weixin refresh contracts normalize expiry, type, and scope",
    "A provider refresh response that omits refresh_token retains the existing value",
    "Duplicate callback completion after a lost response creates one login event",
    "Duplicate refresh operation creates one credential generation and one audit event",
    "Provider secrets, verifier, GitHub JWT, installation token, and OAuth tokens are absent from errors and serialized plaintext"
  ],
  "failureBehavior": [
    "Do not expose a public token or refresh endpoint",
    "Do not convert an unknown retry into success",
    "Do not replace an existing refresh token with an omitted provider value",
    "Do not leak upstream response bodies"
  ],
  "updatedAt": "2026-09-30T00:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: done.
- Provider refresh, omitted refresh-token retention, duplicate-operation
  short-circuiting, generation fencing, and lost Git ref response convergence
  are implemented.
- Provider metadata, stale-response retry, and error-redaction assertions pass
  on the completed source.

## Closure

Provider credentials can be refreshed and retried idempotently without token
loss or duplicate audit.

## Concurrency Decision

- Mode: serial.
- Reason: refresh reuses the credential generation and Git commit transaction
  introduced by OLB-01.
