# CCP-03B-TRUSTED-PUBLISHER - Independent Admission And Ledger

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCP-COMPLETE-20261018",
  "taskId": "CCP-03B-TRUSTED-PUBLISHER",
  "workstreamId": "CCP-PUBLICATION",
  "title": "Build exact-source approval admission, immutable statement reservation, signing, preview verification, and promotion",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ccp-trusted-publisher",
  "journeyId": "CCP-J04-CCP-J05",
  "runtimeClass": "service",
  "writeSet": [
    "apps/client-control",
    "go.work",
    "tooling/acceptance",
    "docs/architecture/platform/client/control-plane"
  ],
  "readSet": [
    "model/domain/client_control",
    "packages/client-control-core",
    "packages/github-repository"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "ccp-publisher-source",
      "command": "go test ./apps/client-control/... -run 'Publisher|Signer|Ledger|Promotion' -count=1",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccp-publisher-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate client-control-snapshot-publication-contract",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "ccp-publisher-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate client-control-snapshot-publication-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "ccp-publisher-functional",
    "scenarioIds": [
      "publisher-exact-source-admission",
      "publisher-concurrency-retry-renewal",
      "publisher-preview-mismatch-promotion"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 1,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "Trusted admission binds exact data revision, content digest, publisher revision, distribution target, approver, and renewal policy outside Vercel admin authority",
    "The signer executes pinned code and never loads executable source or dependencies from the data repository",
    "Sequence, timestamps, and exact statement bytes are reserved durably before signing and cannot be reused for different bytes",
    "Concurrent dispatch has one winner; retry reuses reserved bytes and restore-as-new allocates a higher sequence",
    "Scheduled renewal admits only previously approved unchanged content within consent and material lifetimes",
    "Preview byte and header verification precedes promotion and production readback is required for success"
  ],
  "failureBehavior": [
    "Never let an admin commit, webhook, acknowledgement, or session dispatch the signer",
    "Never sign changed source under an earlier approval or regenerate timestamps during retry",
    "Never report success or move production when preview or production bytes differ"
  ],
  "updatedAt": "2026-10-18T13:54:42.000Z"
}
```

## Objective

Make publication authority independently reviewable before the console exposes
publication workflows.

## Current Snapshot

- No trusted approval entry, signer ledger, signing workflow, or promotion
  owner exists.
- Admin credential isolation is accepted architecture but has no executable
  negative control.
