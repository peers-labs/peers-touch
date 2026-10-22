# XCFG-U02-PREVIEW - Unified Preview Journey

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "XCFG-UNIFIED-20261019",
  "taskId": "XCFG-U02-PREVIEW",
  "workstreamId": "XCFG-PREVIEW",
  "title": "Deploy and prove the unified X Config Preview",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "x-config-unified-preview",
  "journeyId": "XCFG-PREVIEW-OAUTH-PUBLISH-READ",
  "runtimeClass": "service",
  "writeSet": [
    "apps/x-config",
    "apps/oauth2-client",
    "tooling/skills/pt-x-config-2-vercel",
    "tooling/acceptance"
  ],
  "readSet": [
    "packages/x-config-core",
    "packages/github-repository",
    "docs/architecture/platform/client/control-plane"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "x-config-vercel-preflight",
      "command": "bash tooling/skills/pt-x-config-2-vercel/scripts/preflight.sh --repo-root . --personal-use-attested",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "x-config-live-preview",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate x-config-vercel-publication-e2e --gate x-config-production-catalog-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "x-config-live-preview-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate x-config-operator-login-contract --gate x-config-vercel-publication-e2e --gate x-config-production-catalog-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "x-config-live-preview",
    "scenarioIds": [
      "x-config-exact-source-deployment",
      "x-config-operator-login",
      "x-config-repository-persistence",
      "x-config-direct-publication",
      "x-config-public-readback",
      "x-config-client-verification"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 1,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": false,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "The existing admin project is renamed in place to peers-x-config",
    "Preview environment matches the committed env source",
    "OAuth callback returns to the new Preview alias",
    "Draft and publication bytes persist under x-config in the shared repository",
    "Latest and immutable endpoints return the exact signed envelope",
    "The shared client core verifies the deployed envelope"
  ],
  "failureBehavior": [
    "Do not remove old cloud resources before this journey passes",
    "Do not promote Production",
    "Do not print OAuth, GitHub, session or signing values"
  ],
  "updatedAt": "2026-10-19T10:47:00.000Z"
}
```

## Claim Boundary

This Task proves Preview service behavior. It does not authorize or prove
Production promotion or native Desktop/Mobile UI.

## Current Snapshot

- Two non-Production X Config Vercel projects exist from the superseded design.
- The existing OAuth broker and selected-repository GitHub App are reusable.
- No unified `peers-x-config` deployment has been proven by this Plan.
