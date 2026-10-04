# Native-Only Workflow Proof And Delivery

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-NONBLOCKING-INTEGRATION-20261004",
  "taskId": "DWF-NBI03-PROOF-DELIVERY",
  "workstreamId": "DWF-INTEGRATION-DELIVERY",
  "title": "Prove native-only workflow isolation and prepare delivery",
  "workClass": "infrastructure",
  "completionClass": "acceptance-aggregate",
  "executionMode": "fix",
  "closureId": "nonblocking-control-proof",
  "journeyId": "DEV-J04",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/development-workflow/execution-plans/20261004-nonblocking-agent-integration",
    "tooling/acceptance",
    "tooling/scripts/review",
    "tooling/skills/pt-github-review"
  ],
  "readSet": [
    "AGENTS.md",
    "Makefile",
    "apps/desktop",
    "apps/dev",
    "docs",
    "tooling/development/secure_content",
    "tooling/devctl",
    "tooling/make",
    "tooling/plugins/pt-ew-plugin",
    "tooling/scripts",
    "tooling/skills"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "native-workflow-complete-source",
      "command": "python3 -m unittest tooling/scripts/agent-integration-audit-test.py && node --test tooling/scripts/plan/*.test.mjs tooling/scripts/local-dev/*.test.mjs tooling/plugins/pt-ew-plugin/scripts/hook-entry.test.mjs tooling/devctl/test/desktop.test.mjs tooling/devctl/test/wrapper-policy.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "native-workflow-structure",
      "command": "tooling/scripts/review/skill-check.sh && node tooling/scripts/architecture/module-governance.mjs validate",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "native-workflow-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-infra-validation --gate acceptance-plan-self --gate acceptance-runtime-provisioning-self --gate acceptance-workflow-contract --gate development-workflow-control-plane --gate machine-dev-registry-self --gate desktop-check --gate desktop-dev-runtime-isolation-static --gate desktop-primary-navigation-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "DWF-D34 through DWF-D39, LDCP-D19, and D-18 agree with implementation",
    "Plan mount, native Desktop launch, and native Acceptance pass on exact source",
    "No supported command, schema, registry entry, provisioner, Gate, or product matrix retains Desktop browser mode or the Peers Dev 4177 dashboard",
    "Review finds no ownership weakening, browser compatibility shim, or stale dual authority",
    "Commit and pull request exclude the pre-existing federation data-model change"
  ],
  "failureBehavior": [
    "Do not run the real machine hard cut or GC as source proof",
    "Do not claim native product behavior from source-only checks",
    "Do not include docs/architecture/federation/data-model.md in the commit",
    "Do not merge or rewrite history"
  ],
  "updatedAt": "2026-10-04T14:35:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: pending on `DWF-NBI02-NATIVE-PLAN-MOUNT-CUTOVER`.
- No formal evidence recorded.
