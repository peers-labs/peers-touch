# OLB-LIVE-04: OAuth2 API And Repository Proof

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "OLB-LIVE-20261001",
  "taskId": "OLB-LIVE-04",
  "workstreamId": "OLB-LIVE",
  "title": "Prove the OAuth2 API and GitHub repository persistence",
  "workClass": "product-behavior",
  "completionClass": "acceptance-aggregate",
  "executionMode": "build",
  "closureId": "olb-live-proof",
  "journeyId": "OLB-J01",
  "runtimeClass": "service",
  "writeSet": [
    "docs/architecture/oauth-login-broker",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/oauth2-client",
    "docs/architecture/oauth-login-broker",
    "docs/knowledge"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "olb-live-all-go",
      "command": "cd apps/oauth2-client && go test -race ./...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-live-oauth2-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate oauth-login-broker-durable-login --gate oauth-login-broker-refresh-idempotency --gate oauth-login-broker-key-rotation --gate oauth-login-broker-operator",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "All oauth2-client race-enabled tests pass",
    "The four OAuth2 durability, refresh, rotation, and operator Gates are DONE and PROVEN",
    "Live GitHub and Google authorization callbacks return normalized signed identity data",
    "Transaction, identity, credential, refresh-operation, and audit records remain encrypted in the private GitHub repository",
    "The env handoff lists required variable names and probes without secret values"
  ],
  "failureBehavior": [
    "Do not claim Vercel or production readiness from local provider proof",
    "Do not claim Desktop or Station behavior from OAuth2 API proof",
    "Do not log or persist secret values in evidence"
  ],
  "updatedAt": "2026-10-01T00:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- The sibling environment repository contains the authorized
  `oauth2-client-test` broker configuration.
- GitHub and Google authorization have completed against isolated clients.
- GitHub-backed transactions, identities, credentials, and audit records have
  been inspected as authenticated encrypted envelopes.

## API And Repository Proof

The accepted scope is the standalone OAuth2 broker. It requires standards-based
authorization-code redirects with PKCE, state expiry and replay rejection,
provider callback normalization, authenticated operator readback, refresh
idempotency, complete key rotation, and durable encrypted GitHub persistence.
Desktop, Station, native callback delivery, and broader Peers-Touch product
Acceptance are explicitly outside this closure.

## Closure

The standalone OAuth2 API is verified against isolated provider clients and its
private GitHub repository without production reuse.

## Concurrency Decision

- Mode: serial.
- Reason: proof consumes all preceding source closures.
