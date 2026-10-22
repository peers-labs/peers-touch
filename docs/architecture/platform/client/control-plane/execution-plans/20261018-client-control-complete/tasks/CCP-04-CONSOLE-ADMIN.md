# CCP-04-CONSOLE-ADMIN - Typed Draft And Admin API

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCP-COMPLETE-20261018",
  "taskId": "CCP-04-CONSOLE-ADMIN",
  "workstreamId": "CCP-CONSOLE",
  "title": "Deliver typed catalog drafts, validation, Git CAS, publication requests, status, history, and recovery APIs",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ccp-console-admin",
  "journeyId": "CCP-J02-CCP-J05-ADMIN",
  "runtimeClass": "service",
  "writeSet": [
    "apps/client-control",
    "tooling/acceptance",
    "docs/architecture/platform/client/control-plane"
  ],
  "readSet": [
    "packages/github-repository",
    "model/domain/client_control",
    "model/domain/oauth"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "ccp-console-source",
      "command": "go test ./apps/client-control/... -run 'Admin|Catalog|Validation|Draft|PublicationRequest' -count=1",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccp-console-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate client-control-admin-api-contract",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "ccp-console-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate client-control-admin-api-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "ccp-console-functional",
    "scenarioIds": [
      "admin-endpoint-release-validation",
      "admin-draft-cas-conflict",
      "admin-publication-request-history-recovery"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 1,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "Typed Relay, Direct Station, and release mutations preserve draft input and return field-level plus owner-level findings",
    "Public endpoint validation blocks private, loopback, link-local, metadata, redirect, credential, role, identity, consent, and trust-material abuse",
    "Draft Git CAS, exact grouped diff acknowledgement, publication request, approval waiting, status, history, retry, and restore-as-new are durable",
    "Admin responses contain no GitHub App key, endpoint credential, signing key, deployment token, or raw provider credential",
    "Admin failure cannot affect static client reads"
  ],
  "failureBehavior": [
    "Do not accept arbitrary maps, executable fields, unbounded payloads, or unknown catalog sections",
    "Do not report publication success before approval, signing, preview verification, promotion, and production readback converge",
    "Do not add Station, Relay attachment, certificate, environment-variable, or update-installation administration"
  ],
  "updatedAt": "2026-10-18T13:54:42.000Z"
}
```

## Objective

Close the bounded backend owner that the production console consumes.

## Current Snapshot

- No admin API, catalog domain, Git draft repository adapter, validator, or
  publication-request store exists.
- Production console implementation is deferred to CCP-04B.
