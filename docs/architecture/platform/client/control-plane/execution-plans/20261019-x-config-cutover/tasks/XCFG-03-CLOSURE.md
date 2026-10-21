# XCFG-03-CLOSURE - Current-Source Cutover Audit

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "XCFG-CUTOVER-20261019",
  "taskId": "XCFG-03-CLOSURE",
  "workstreamId": "XCFG-PROOF",
  "title": "Audit the X Config single source and Preview evidence without promoting Production",
  "workClass": "refactor",
  "completionClass": "acceptance-aggregate",
  "executionMode": "build",
  "closureId": "x-config-cutover-closure",
  "journeyId": "XCFG-CUTOVER-CLOSURE",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/acceptance",
    "docs/architecture/platform/client/x-config"
  ],
  "readSet": [
    "apps/x-config",
    "apps/desktop",
    "apps/mobile",
    "apps/oauth2-client",
    "model/domain/x_config",
    "packages/x-config-core",
    "tooling/skills/pt-x-config-2-vercel",
    "docs/architecture/engineering/architecture-governance/architecture-modules.json"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "x-config-single-source-audit",
      "command": "test -z \"$(git grep -l -E '(client-control|client_control|ClientControl|CLIENT_CONTROL|Client Control)' -- ':!docs/architecture/platform/client/control-plane/execution-plans/**')\" && node tooling/scripts/architecture/module-governance.mjs validate && python3 tooling/scripts/acceptance-validate.py --domain x-config",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "x-config-aggregate-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate x-config-api-aggregate-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Current active source, documentation, generated output, tooling and evidence expose one X Config identity",
    "Architecture governance and the X Config Acceptance graph validate",
    "Current-source admin and distribution Preview evidence is classified independently and missing proof remains UNPROVEN",
    "No task-owned unaliased Preview, temporary artifact, secret material or stale runtime process remains",
    "Production aliases, push, pull request and merge remain untouched"
  ],
  "failureBehavior": [
    "Do not aggregate stale Client Control evidence into an X Config PASS",
    "Do not claim full closure when the distribution Preview or positive operator login is unproven",
    "Do not promote Production as cleanup or as a substitute for missing evidence"
  ],
  "updatedAt": "2026-10-19T07:07:32.000Z"
}
```

## Claim Boundary

The aggregate may remain UNPROVEN. Source completion and Preview evidence are
reported separately from Production readiness and native UI proof.

## Current Snapshot

- Existing Client Control evidence is bound to old paths and identifiers and
  cannot prove X Config after the source digest changes.
- Production promotion and native UI proof are outside this Plan.
- Closure must preserve missing external distribution or operator proof as
  `UNPROVEN`.
