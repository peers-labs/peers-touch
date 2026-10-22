# CCP-10-API-CLOSURE - Exact-Source Aggregate And Claim Boundary

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCP-COMPLETE-20261018",
  "taskId": "CCP-10-API-CLOSURE",
  "workstreamId": "CCP-PROOF",
  "title": "Aggregate current-source Client Control, publication, client-kernel, and Home/corpstable API proof",
  "workClass": "product-behavior",
  "completionClass": "acceptance-aggregate",
  "executionMode": "build",
  "closureId": "ccp-api-closure",
  "journeyId": "CCP-J01-CCP-J07-API-AGGREGATE",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/acceptance",
    "docs/architecture/platform/client/control-plane"
  ],
  "readSet": [
    "apps/client-control",
    "apps/oauth2-client",
    "apps/desktop",
    "apps/mobile",
    "apps/station",
    "model",
    "packages/client-control-core",
    "packages/github-repository",
    "tooling/scripts",
    "tooling/skills/pt-client-control-2-vercel"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 5400,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "ccp-aggregate-source",
      "command": "node tooling/scripts/architecture/module-governance.mjs validate && make plan-validate PLAN=docs/architecture/platform/client/control-plane/execution-plans/20261018-client-control-complete/plan.md",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "ccp-aggregate-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate client-control-api-aggregate-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "All completion Gates bind the same final source digest, generated contracts, publisher revision, deployment IDs, snapshot bytes, Home Relay identity, and corpstable Station identity",
    "Negative controls prove admin compromise cannot sign or deploy distribution and cloud data cannot mutate verified Station state",
    "Console browser, admin API, signer, Vercel static reads, Desktop/Mobile kernel adapters, Relay attachment, protobuf roundtrip, restart, and cleanup evidence are current",
    "The reusable deployment Skill passes its source, secret-redaction, preview, production, rollback, and cleanup checks",
    "Only task-owned processes, leases, previews, temporary files, and verification aliases are released or explicitly retained",
    "Native Desktop/Mobile selector UI, commercial scale, router mutation, and update installation remain explicitly unproven"
  ],
  "failureBehavior": [
    "Do not convert source checks, prototype evidence, or API observations into native UI proof",
    "Do not reuse stale evidence from another source, deployment, endpoint identity, or snapshot sequence",
    "Do not report completion while production readback, stable restart, resource cleanup, or any required negative control is missing"
  ],
  "updatedAt": "2026-10-18T13:54:42.000Z"
}
```

## Objective

Provide one bounded final verdict that distinguishes implemented, proved,
unproven, and externally blocked scope.

## Current Snapshot

- No Client Control runtime or formal Gate exists.
- Prototype evidence is interaction-only.
- Current Home/corpstable observations are historical planning inputs, not
  exact-source acceptance evidence.
