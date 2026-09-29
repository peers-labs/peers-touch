# OLB-01: Durable OAuth Core

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "OLB-20260930",
  "taskId": "OLB-01-DURABLE-CORE",
  "workstreamId": "OLB-SERVICE",
  "title": "Complete durable cross-instance OAuth login",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "olb-durable-login",
  "journeyId": "OLB-J01",
  "runtimeClass": "service",
  "writeSet": [
    "apps/oauth2-client",
    "docs/architecture/oauth-login-broker",
    "tooling/acceptance/capabilities/oauth-login-broker.yaml",
    "tooling/acceptance/domains/index.yaml",
    "tooling/acceptance/domains/oauth-login-broker.yaml",
    "tooling/acceptance/environments/oauth2-client-local-service.yaml",
    "tooling/acceptance/environments/oauth2-client-local-browser.yaml",
    "tooling/acceptance/features/oauth2-client-durability.yaml",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/gates/oauth2_client",
    "tooling/acceptance/provisioners/__init__.py",
    "tooling/acceptance/provisioners/oauth2_client_local.py",
    "tooling/acceptance/registry.yaml"
  ],
  "readSet": [
    "docs/architecture/mobile",
    "docs/architecture/station-access-lifecycle"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "olb-go-test",
      "command": "cd apps/oauth2-client && go test ./...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-go-race",
      "command": "cd apps/oauth2-client && go test -race ./...",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "olb-cross-container",
      "command": "cd apps/oauth2-client && go test ./internal/infrastructure/persistence/github -run TestStoreCompletesAuthorizationAcrossInstances",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "olb-durable-login-acceptance",
      "command": "make acceptance-run",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Authorization transactions survive separate container instances and are consumed once",
    "GitHub App Git Data adapter atomically writes transaction, identity, credential, and audit records with bounded CAS retry",
    "All repository payloads use versioned path-bound AES-256-GCM envelopes",
    "GitHub and Google use PKCE and all providers return normalized token sets",
    "Start, success, and typed failure audit events contain no secrets",
    "Unapproved return destinations and unsigned Vercel configuration fail closed"
  ],
  "failureBehavior": [
    "Never persist raw authorization code or raw state",
    "Never fall back to memory storage on Vercel",
    "Never redirect success after a partial or failed durable completion",
    "Never overwrite a consumed transaction during conflict retry"
  ],
  "updatedAt": "2026-09-30T00:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: ready.
- Existing session storage is process-local and provider token metadata is
  discarded.
- Product and architecture contracts are accepted.
- Implementation and focused source evidence remain.

## Closure

The OAuth application layer completes one cross-instance login through a
provider-neutral durable store with no replay or redirect-exfiltration path.

## Concurrency Decision

- Mode: serial.
- Reason: domain interfaces, storage transaction semantics, provider adapters,
  and bootstrap selection change as one compile-time boundary.
