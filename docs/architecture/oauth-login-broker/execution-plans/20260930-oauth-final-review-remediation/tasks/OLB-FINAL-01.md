# OLB-FINAL-01: Secure Configuration And Provider Time

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "OLB-FINAL-20260930",
  "taskId": "OLB-FINAL-01",
  "workstreamId": "OLB-SERVICE",
  "title": "Honor deployment overrides and secure provider transport",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "olb-final-config",
  "journeyId": "OLB-J01",
  "runtimeClass": "service",
  "writeSet": [
    "apps/oauth2-client/internal/bootstrap",
    "apps/oauth2-client/internal/integration",
    "apps/oauth2-client/internal/infrastructure/provider/weixin",
    "docs/architecture/oauth-login-broker",
    "tooling/acceptance/gates/oauth2_client"
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
      "id": "olb-final-config-tests",
      "command": "cd apps/oauth2-client && go test -race ./...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-final-config-functional",
      "command": "make dev-functional-result WORK_ITEM=OLB-FINAL-01 RUNTIME_CELL=oauth2-client-local-service REASON='verify OAuth configuration closure'",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "olb-final-config-acceptance",
      "command": "make acceptance-run",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "File-backed sites honor the documented OAUTH_ALLOWED_RETURN_TO override",
    "Vercel rejects plaintext GitHub API endpoints",
    "Weixin expiry is measured from token receipt rather than userinfo completion",
    "Cross-instance HTTP proof uses separate adapters over durable shared state",
    "OLB-G05B has assembled-route and complete-bootstrap witnesses",
    "Formal OAuth Go test commands use the race detector",
    "Configuration and provider regression tests pass"
  ],
  "failureBehavior": [
    "Do not weaken local HTTP fixture support",
    "Do not expose provider or GitHub credentials",
    "Do not broaden return destinations beyond normalized exact values"
  ],
  "updatedAt": "2026-09-30T00:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: pending.
- The default file-backed deployment ignores the environment allowlist,
  production accepts an HTTP GitHub API base, Weixin expiry begins late, and
  login proof omits assembled-route and true cross-instance witnesses.

## Closure

Production configuration and provider timing match the accepted transport and
credential contracts.

## Concurrency Decision

- Mode: serial.
- Reason: the configuration and provider changes share the login Gate.
