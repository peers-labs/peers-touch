# XCFG-02-VERCEL-PREVIEWS - Admin And Signed Distribution Previews

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "XCFG-CUTOVER-20261019",
  "taskId": "XCFG-02-VERCEL-PREVIEWS",
  "workstreamId": "XCFG-HOSTING",
  "title": "Rename both empty projects and prove X Config admin and signed distribution Previews in one Suite",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "x-config-vercel-previews",
  "journeyId": "XCFG-OPERATOR-AND-DISTRIBUTION-PREVIEWS",
  "runtimeClass": "service",
  "writeSet": [
    "apps/x-config",
    "apps/oauth2-client",
    "tooling/skills/pt-x-config-2-vercel",
    "tooling/acceptance"
  ],
  "readSet": [
    "model/domain/x_config",
    "packages/x-config-core",
    "packages/github-repository",
    "docs/architecture/platform/client/x-config",
    "docs/architecture/domains/identity/oauth-login-broker"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "x-config-vercel-preflight",
      "command": "bash tooling/skills/pt-x-config-2-vercel/scripts/preflight.sh --repo-root . --dry-run && bash tooling/skills/pt-x-config-2-vercel/scripts/verify.sh --self-test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "x-config-console-source",
      "command": "pnpm --dir apps/x-config/console run check && pnpm --dir apps/x-config/console run test && pnpm --dir apps/x-config/console run build && go test ./apps/x-config/internal/publication ./apps/x-config/cmd/publisher -count=1",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "x-config-vercel-preview-journey",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate x-config-vercel-publication-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "x-config-vercel-preview-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate x-config-console-admin-e2e --gate x-config-vercel-publication-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "x-config-vercel-preview-journey",
    "scenarioIds": [
      "x-config-project-rename",
      "x-config-admin-unauthenticated-boundary",
      "x-config-operator-login",
      "x-config-signed-artifact-build",
      "x-config-distribution-preview-readback",
      "x-config-preview-cleanup"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 1,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "Both empty Vercel projects are renamed in place to peers-x-config-admin and peers-x-config-distribution",
    "Admin Root Directory is apps/x-config and environment names use only X_CONFIG prefixes",
    "Admin receives only operator session, OAuth receiver and dedicated data-repository credentials; distribution receives no runtime secret or Function authority",
    "One immutable admin Preview serves the console and protected Functions from current source",
    "The trusted publisher emits a signed temporary artifact from exact approved catalog input",
    "Distribution Preview readback binds deployment ID, exact protobuf bytes, digest, application/protobuf and immutable cache policy",
    "Positive operator login and distribution publication are PASS or explicitly UNPROVEN at their exact external blocker"
  ],
  "failureBehavior": [
    "Do not rename a project if either gains a deployment or Production alias before mutation",
    "Do not expose environment, OAuth, session, catalog approval or signing values",
    "Do not fabricate catalog material, deploy unsigned bytes or weaken canonical HTTPS validation",
    "Do not promote Production or delete either Vercel project"
  ],
  "updatedAt": "2026-10-19T07:07:32.000Z"
}
```

## Claim Boundary

This Task shares one hosting Suite across both projects. Missing positive OAuth,
catalog or signer authority remains `UNPROVEN`; source checks cannot substitute
for live Preview readback.

## Current Snapshot

- Vercel CLI `63.1.0` matches the source pin and read-only preflight passes.
- Both old-name projects exist, have zero deployments and no observed target.
- Distribution verification self-test passes.
- Positive live operator login, canonical public Direct Station catalog
  material and complete independent signer/data authority are not proven.
