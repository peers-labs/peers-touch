# CCP-05-VERCEL-PUBLICATION - Isolated Vercel Projects And Deploy Skill

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCP-COMPLETE-20261018",
  "taskId": "CCP-05-VERCEL-PUBLICATION",
  "workstreamId": "CCP-PUBLICATION",
  "title": "Publish separate console-admin and credential-free distribution projects with deterministic verification and rollback",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ccp-vercel-publication",
  "journeyId": "CCP-J01-CCP-J04-CCP-J05",
  "runtimeClass": "service",
  "writeSet": [
    "apps/client-control",
    "tooling/skills/pt-client-control-2-vercel",
    "tooling/scripts",
    "tooling/acceptance",
    "docs/architecture/platform/client/control-plane"
  ],
  "readSet": [
    "apps/oauth2-client",
    "packages/github-repository"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "ccp-vercel-source",
      "command": "go test ./apps/client-control/... -count=1 && bash tooling/skills/pt-client-control-2-vercel/scripts/preflight.sh --repo-root . --dry-run",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccp-vercel-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate client-control-vercel-publication-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "ccp-vercel-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate client-control-vercel-publication-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "ccp-vercel-functional",
    "scenarioIds": [
      "vercel-console-admin-preview",
      "vercel-distribution-preview-byte-readback",
      "vercel-promotion-failure-rollback"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 1,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "Fresh Vercel plan, project count, policy, usage, build, and traffic preflight permits two projects without a paid upgrade",
    "Console-admin has only its session, OAuth receiver, and dedicated data-repository credentials; distribution has no runtime secret or Function dependency",
    "The data GitHub App is installed only on the dedicated data repository and cannot write code, OAuth data, signer ledger, approval, or distribution resources",
    "Preview deployments are verified before promotion and production readback binds deployment ID, exact snapshot bytes, digest, headers, and source",
    "The reusable project Skill performs redacted preflight, environment sync, deploy, verify, promote, rollback, and cleanup without printing secrets",
    "Static latest and immutable snapshot reads remain available while admin Functions are unavailable"
  ],
  "failureBehavior": [
    "Do not create projects or publish when Hobby eligibility, quota, policy, domain, or project ownership is ambiguous",
    "Do not pass secret values in argv, logs, chat, repository files, or evidence",
    "Do not promote a protected, unverified, byte-mismatched, or stale-source Preview"
  ],
  "updatedAt": "2026-10-18T13:54:42.000Z"
}
```

## Objective

Make the hosted read path static and independently deployable while leaving
all mutation and signing authority outside that path.

## Current Snapshot

- Vercel CLI 62.1.0 is authenticated to `<vercel-account>`.
- Four existing projects were listed on 2026-10-18; no Client Control project
  exists.
- Current quota and Hobby eligibility still require readback immediately
  before resource creation.
