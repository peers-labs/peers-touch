# OLB-FINAL-04: Make OAuth Proof Honest And Complete

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "OLB-FINAL-20260930",
  "taskId": "OLB-FINAL-04",
  "workstreamId": "OLB-SERVICE",
  "title": "Close persistence scaling and Acceptance proof gaps",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "olb-final-proof",
  "journeyId": "OLB-J01",
  "runtimeClass": "browser",
  "writeSet": [
    "apps/oauth2-client/internal/infrastructure/persistence/github",
    "docs/architecture/oauth-login-broker",
    "tooling/acceptance/capabilities/oauth-login-broker.yaml",
    "tooling/acceptance/domains/index.yaml",
    "tooling/acceptance/domains/oauth-login-broker.yaml",
    "tooling/acceptance/environments/oauth2-client-local-browser.yaml",
    "tooling/acceptance/environments/oauth2-client-local-service.yaml",
    "tooling/acceptance/features/oauth2-client-durability.yaml",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/gates/oauth2_client",
    "tooling/acceptance/provisioners/__init__.py",
    "tooling/acceptance/provisioners/oauth2_client_local.py",
    "tooling/acceptance/registry.yaml",
    "tooling/acceptance/tests/test_provisioning_model.py",
    "tooling/scripts/acceptance-plan-test.py"
  ],
  "readSet": [
    "apps/oauth2-client",
    "docs/knowledge"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "olb-final-proof-tests",
      "command": "cd apps/oauth2-client && go test -race ./...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-final-proof-functional",
      "command": "make dev-functional-result WORK_ITEM=OLB-FINAL-04 RUNTIME_CELL=oauth2-client-local-browser REASON='verify complete OAuth proof contract'",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "olb-final-proof-completion",
      "command": "make acceptance-run-completion",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Admin readback applies its limit before fetching encrypted audit blobs",
    "Rotation avoids repeated full-history reads within one bounded pass",
    "Rotation counts only records confirmed by successful commits",
    "OAuth source changes select architecture and domain-contract Gates",
    "Acceptance-tooling changes select all required self-validation Gates",
    "Provisioned actor identities match environment contracts",
    "Full-range completion review and code review contain no P1/P2 finding"
  ],
  "failureBehavior": [
    "Do not introduce a new audit index or rotation continuation protocol",
    "Do not count attempted rotations as committed records",
    "Do not publish an unwitnessed capability or specification claim",
    "Do not omit required governance, provisioning, or workflow checks"
  ],
  "updatedAt": "2026-09-30T00:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: pending.
- Admin and rotation scans perform avoidable repeated reads, OAuth path rules
  omit architecture and domain Gates, Acceptance changes omit self-validation
  Gates, and the service provisioner actor differs from its environment
  contract.

## Closure

Persistence maintenance remains bounded, and every final OAuth claim is
selected, source-bound, and traceable to the declared runtime identity.

## Concurrency Decision

- Mode: serial.
- Reason: final proof consumes every preceding remediation closure.
