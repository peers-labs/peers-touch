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
    "apps/oauth2-client/cmd/rotate-records",
    "apps/oauth2-client/internal/bootstrap",
    "apps/oauth2-client/internal/domain/oauth/entity",
    "apps/oauth2-client/internal/infrastructure/persistence/github",
    "apps/oauth2-client/internal/infrastructure/persistence/memory",
    "apps/dev/server/index.test.mjs",
    "docs/architecture/architecture-module-governance/architecture-modules.json",
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
    "tooling/scripts/acceptance-plan-test.py",
    "tooling/scripts/acceptance-run.py",
    "tooling/scripts/acceptance-run-test.py",
    "tooling/skills/pt-github-review/FRESHNESS.md"
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
      "id": "olb-final-proof-dev-server-test",
      "command": "node --test apps/dev/server/index.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-final-proof-runner-test",
      "command": "python3 tooling/scripts/acceptance-run-test.py",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-final-proof-functional",
      "command": "make dev-functional-result WORK_ITEM=OLB-FINAL-04-R1 RUNTIME_CELL=oauth2-client-local-browser REASON='verify complete OAuth proof contract'",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "olb-final-proof-completion",
      "command": "make acceptance-run-completion",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Admin readback selects the newest same-month events from chronologically sortable paths before fetching encrypted audit blobs",
    "Legacy HMAC-only audit paths fail closed before blob reads",
    "Distinct failure occurrences retain distinct event identities in durable and local stores",
    "Rotation reuses one bounded candidate set across retries",
    "Rotation counts only records confirmed by successful commits",
    "Rotation completion is explicit and cannot be inferred from the committed count",
    "OAuth source changes select architecture and domain-contract Gates",
    "Acceptance-tooling changes select all required self-validation Gates",
    "OLB-G05B selects negative bootstrap witnesses for admin auth, GitHub App credentials, repository coordinates, encryption keys, and HMAC keys",
    "Provisioned actor identities match environment contracts",
    "Review-skill freshness covers the registered OAuth architecture source",
    "Peers Dev HTTP tests inject a deterministic status snapshot",
    "Static Gate auxiliary artifacts remain distinct from canonical Gate evidence",
    "Full-range completion review and code review contain no P1/P2 finding"
  ],
  "failureBehavior": [
    "Do not introduce a separate audit index or rotation continuation protocol",
    "Do not count attempted rotations as committed records",
    "Do not publish an unwitnessed capability or specification claim",
    "Do not omit required governance, provisioning, or workflow checks"
  ],
  "updatedAt": "2026-10-01T00:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: in progress.
- Final review found that HMAC-only same-month audit paths are not
  chronological, lost successful ref-update responses undercount rotations,
  and OLB-G05B lacks complete bootstrap witnesses. The accepted remediation
  adds a sortable audit key, retry-stable rotation candidates, and explicit
  negative bootstrap tests.

## Closure

Persistence maintenance remains bounded, and every final OAuth claim is
selected, source-bound, and traceable to the declared runtime identity.

## Concurrency Decision

- Mode: serial.
- Reason: final proof consumes every preceding remediation closure.
