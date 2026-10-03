# OLB-FINAL-02: Bound GitHub Response Handling

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "OLB-FINAL-20260930",
  "taskId": "OLB-FINAL-02",
  "workstreamId": "OLB-SERVICE",
  "title": "Keep GitHub-backed storage readable beyond one response cap",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "olb-final-response-bounds",
  "journeyId": "OLB-J01",
  "runtimeClass": "service",
  "writeSet": [
    "apps/oauth2-client/internal/infrastructure/persistence/github",
    "docs/architecture/oauth-login-broker"
  ],
  "readSet": [
    "docs/knowledge"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "olb-final-github-bounds",
      "command": "cd apps/oauth2-client && go test -race ./internal/infrastructure/persistence/github",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-final-github-functional",
      "command": "make dev-functional-result WORK_ITEM=OLB-FINAL-02 RUNTIME_CELL=oauth2-client-local-service REASON='verify bounded GitHub storage'",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "olb-final-github-acceptance",
      "command": "make acceptance-run",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Oversized successful responses are detected instead of decoded as truncated JSON",
    "Large repository trees are loaded through bounded traversal",
    "GitHub request and tree tests cover overflow and truncated-tree behavior"
  ],
  "failureBehavior": [
    "Do not remove response-size limits",
    "Do not treat truncated JSON as a valid empty result",
    "Do not leak GitHub response bodies"
  ],
  "updatedAt": "2026-09-30T00:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- GitHub response bodies are bounded explicitly, oversized responses fail
  closed, and oversized or truncated recursive trees fall back to bounded
  non-recursive traversal.

## Closure

GitHub-backed reads remain bounded and fail or traverse explicitly at response
and recursive-tree limits.

## Concurrency Decision

- Mode: serial.
- Reason: later store operations depend on the corrected snapshot primitive.
