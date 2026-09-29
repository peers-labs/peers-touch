# OLB-04: Operator Surface And Final Proof

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "OLB-20260930",
  "taskId": "OLB-04-OPERATOR-PROOF",
  "workstreamId": "OLB-SERVICE",
  "title": "Deliver read-only administration and final exact-source proof",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "olb-operator-proof",
  "journeyId": "OLB-J03",
  "runtimeClass": "browser",
  "writeSet": [
    "apps/oauth2-client",
    "docs/README.md",
    "docs/architecture/architecture-module-governance/architecture-modules.json",
    "docs/architecture/oauth-login-broker",
    "tooling/acceptance"
  ],
  "readSet": [
    "docs/architecture/development-workflow",
    "docs/global/architecture-document-standard.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "olb-admin-http",
      "command": "cd apps/oauth2-client && go test ./internal/interfaces/http/handler ./internal/bootstrap",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-local-browser",
      "command": "cd apps/oauth2-client && go test ./internal/integration -run TestOAuthLoginBrokerJourney",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "olb-acceptance",
      "command": "make acceptance-run",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Authenticated operator HTML and JSON show identities, credential metadata, and recent audit events",
    "Unauthenticated administration requests fail before storage access",
    "Admin responses are non-cacheable, non-indexable, frame-denied, and token-free",
    "Existing OAuth and health routes plus new admin routes compile as independent Vercel functions",
    "The exact-source start/callback/admin journey and formal Acceptance bundle pass"
  ],
  "failureBehavior": [
    "Do not expose access token, refresh token, authorization code, raw state, verifier, key, or GitHub credential",
    "Do not add mutation controls to the administration surface",
    "Do not claim live provider, GitHub App, or Vercel deployment proof",
    "Do not leave a local server running after verification"
  ],
  "updatedAt": "2026-09-30T00:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: in progress.
- The administration handler, Basic authentication, Vercel routes, and browser
  Gate are implemented.
- Exact-source browser, completion Acceptance, and final review remain.

## Closure

The operator can inspect durable login state without receiving credential
material, and the final exact source satisfies formal repository gates.

## Concurrency Decision

- Mode: serial.
- Reason: the operator projection and final Gate consume all preceding
  persistence, token, and rotation contracts.
