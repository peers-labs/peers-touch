# CCP-09-PRODUCTION-CATALOG - Publish Verified Initial Data

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCP-COMPLETE-20261018",
  "taskId": "CCP-09-PRODUCTION-CATALOG",
  "workstreamId": "CCP-DEPLOYMENT",
  "title": "Publish the validated Home Relay, corpstable Station, and typed release catalog through the independent authority path",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ccp-production-catalog",
  "journeyId": "CCP-J02-CCP-J04-CCP-J06-CCP-J07",
  "runtimeClass": "service",
  "writeSet": [
    "apps/client-control",
    "tooling/skills/pt-client-control-2-vercel",
    "tooling/acceptance",
    "docs/architecture/platform/client/control-plane"
  ],
  "readSet": [
    "model/domain/peer",
    "model/domain/client_control",
    "packages/client-control-core"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "ccp-production-catalog-source",
      "command": "go test ./apps/client-control/... -count=1 && cargo test --manifest-path packages/client-control-core/Cargo.toml --locked",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccp-production-catalog-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate client-control-production-catalog-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "ccp-production-catalog-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate client-control-production-catalog-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "ccp-production-catalog-functional",
    "scenarioIds": [
      "catalog-exact-source-approval",
      "catalog-static-production-readback",
      "catalog-client-verification-and-targeting"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 2,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "The dedicated data repository contains reviewed typed source for the selected Home Relay, corpstable Direct Station, and current Desktop/Mobile release descriptors",
    "Direct Station publication includes current owner-signed consent and live identity agreement; Relay publication includes current expected Relay identity and trust material",
    "The console creates a request for one exact source commit and digest but cannot admit signing",
    "Independent approval, signer reservation, signature, Preview readback, promotion, and production readback converge on one immutable snapshot",
    "Desktop and Mobile core adapters accept the production bytes for the intended channel and reject tamper, rollback, wrong target, expiry, and identity mismatch",
    "Published data remains suggestion and release metadata only; no client binding or installation is triggered"
  ],
  "failureBehavior": [
    "Do not publish an unreachable endpoint, expired consent, unsupported trust path, or unverified release key",
    "Do not bypass external approval because the same operator authored the draft",
    "Do not lower sequence or overwrite immutable history to restore prior content"
  ],
  "updatedAt": "2026-10-18T13:54:42.000Z"
}
```

## Objective

Turn the implemented control plane and deployed endpoint topology into one
real, independently admitted production snapshot.

## Current Snapshot

- No data repository, publication request, signer ledger, Client Control
  Vercel deployment, or production snapshot exists.
- Home/corpstable data cannot be published until CCP-08 proves its current
  identity, reachability, trust, consent, and restart behavior.
