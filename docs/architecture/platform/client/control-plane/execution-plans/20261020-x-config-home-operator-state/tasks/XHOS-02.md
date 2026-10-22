# Exact-source Home cutover and OAuth proof

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "x-config-home-operator-state-20261020",
  "taskId": "XHOS-02",
  "workstreamId": "XHOS",
  "title": "Deploy and prove the exact Home X Config release",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "XHOS-home-closure",
  "journeyId": "CCP-J01-home-closure",
  "runtimeClass": "service",
  "writeSet": [
    "apps/x-config/api",
    "apps/x-config/bridge",
    "apps/x-config/vercel.json",
    "docs/architecture/platform/client/control-plane",
    "tooling/acceptance",
    "tooling/skills/pt-x-config-2-vercel"
  ],
  "readSet": [
    "apps/x-config/cmd/server",
    "apps/oauth2-client",
    "packages/x-config-core",
    "packages/github-repository"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "x-config-home-source",
      "command": "sh -c 'go test ./apps/x-config/... -count=1 && python3 -m unittest tooling.acceptance.gates.x_config.contracts_test'",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "x-config-home-legacy-removal",
      "command": "sh -c 'test ! -e apps/x-config/vercel.json && test ! -d apps/x-config/api && test ! -d apps/x-config/bridge && test ! -d tooling/skills/pt-x-config-2-vercel'",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "x-config-home-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate x-config-home-operator-login-e2e --gate x-config-home-publication-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "x-config-home-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate x-config-home-operator-login-e2e --gate x-config-home-publication-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "x-config-home-functional",
    "scenarioIds": [
      "operator-login-restart",
      "publication-readback"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 1,
    "minWarmReuseRate": 0.5,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "One release binds exact application and env commits and runs only on the declared Home origin.",
    "The API owns one persistent operator-state mount and becomes ready only after schema validation.",
    "Real GitHub login succeeds for the allowlisted subject, survives API restart, rejects replay and CSRF failure, and remains revoked after logout and restart.",
    "Git path diff proves the Journey creates no X Config admin-auth mutation while Broker-owned oauth-data changes remain isolated.",
    "Catalog save, direct publication, latest and immutable readback, and x-config-core verification pass against the same release.",
    "Twenty warm samples attribute X Config start, Broker/provider, redemption, local finalization, and session readback; each X Config-local span has P95 below one second.",
    "After all proof passes, the Vercel X Config project is deleted while the OAuth Broker project and shared GitHub repository remain."
  ],
  "failureBehavior": [
    "A failed source/env identity check blocks deployment.",
    "A failed login, restart, replay, publication, or byte-readback oracle preserves the Vercel rollback project and reports the exact owner.",
    "No test or deployment command prints OAuth, GitHub, session, signing, or operator-record secrets.",
    "Database recreation signs the operator out and never mutates Git-backed publication state.",
    "Vercel cleanup is forbidden before current-source Home proof and explicit Plan authorization."
  ],
  "updatedAt": "2026-10-20T14:05:27.000Z"
}
```

## Current Snapshot

Home currently serves the exact X Config application through the owned edge,
and real GitHub login succeeds after Broker redemption moved to the configured
OAuth Broker edge. The release still uses GitHub for operator state, keeps
Vercel Function wrappers and deployment tooling in active source, and retains
the Vercel project as rollback. Existing Home API evidence does not prove local
session persistence, restart continuity, absence of `admin-auth` Git writes, or
segmented login latency.
