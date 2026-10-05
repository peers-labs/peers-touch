# OLB-03: Complete Record Key Rotation

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "OLB-20260930",
  "taskId": "OLB-03-KEY-ROTATION",
  "workstreamId": "OLB-SERVICE",
  "title": "Rotate every encrypted repository record class",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "olb-key-rotation",
  "journeyId": "OLB-J04",
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
      "id": "olb-envelope-rotation",
      "command": "cd apps/oauth2-client && go test ./internal/infrastructure/crypto ./internal/infrastructure/persistence/github",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-rotation-command",
      "command": "cd apps/oauth2-client && go test ./cmd/rotate-records ./internal/infrastructure/persistence/github -run 'TestRotateRecordsRun|TestRotateEncryption'",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "olb-key-rotation-acceptance",
      "command": "make acceptance-run",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Envelope metadata and repository path are authenticated",
    "The maintenance command scans transaction, identity, credential, and audit records",
    "Every old-key envelope is rewritten under the active key",
    "A second rotation run performs zero writes",
    "Unknown keys and record failures produce sanitized non-zero outcomes"
  ],
  "failureBehavior": [
    "Do not rotate records from an admin GET request",
    "Do not remove or overwrite an old key automatically",
    "Do not print record plaintext, ciphertext, or key material",
    "Do not report success while any record failed"
  ],
  "updatedAt": "2026-09-30T00:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: done.
- Versioned envelopes, full-prefix batching, the maintenance command, and
  idempotent second-run behavior are implemented.
- Unknown-key, partial-failure, and no-op coverage pass on the completed
  source.

## Closure

All encrypted record classes can be migrated before an old key is removed.

## Concurrency Decision

- Mode: serial.
- Reason: rotation relies on the final envelope and GitHub CAS contracts.
