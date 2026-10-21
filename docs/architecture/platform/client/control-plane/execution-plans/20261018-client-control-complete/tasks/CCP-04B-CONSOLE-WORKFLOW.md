# CCP-04B-CONSOLE-WORKFLOW - Confirmed Operator Experience

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCP-COMPLETE-20261018",
  "taskId": "CCP-04B-CONSOLE-WORKFLOW",
  "workstreamId": "CCP-CONSOLE",
  "title": "Implement the confirmed operator console against real admin and publisher projections",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ccp-console-workflow",
  "journeyId": "CCP-J01-CCP-J05-CONSOLE",
  "runtimeClass": "service",
  "writeSet": [
    "apps/client-control",
    "package.json",
    "pnpm-lock.yaml",
    "tooling/acceptance",
    "docs/architecture/platform/client/control-plane"
  ],
  "readSet": [
    "packages/prototypes/control/client-control",
    "model/domain/client_control",
    "model/domain/oauth"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "ccp-console-workflow-source",
      "command": "pnpm --dir apps/client-control/console run check && pnpm --dir apps/client-control/console run test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccp-console-workflow-ux",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate client-control-console-admin-e2e",
      "verificationClass": "UX_REVIEW"
    },
    {
      "id": "ccp-console-workflow-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate client-control-console-admin-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "ccp-console-workflow-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate client-control-console-admin-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "ccp-console-workflow-functional",
    "scenarioIds": [
      "console-endpoint-release-edit",
      "console-diff-request-approval-wait",
      "console-failure-conflict-recovery"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 1,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "Production console matches the confirmed prototype's hierarchy, revision strip, state coverage, action placement, keyboard behavior, focus restoration, and narrow layout",
    "Endpoint and release forms preserve input, render typed validation, and distinguish trust, source, approval, deployment, and production states without color-only meaning",
    "Exact grouped diff acknowledgement gates publication request and waiting for independent approval remains explicit",
    "Signing, deploy, readback, source conflict, stale production, and restore-as-new recovery identify the owning system without losing the draft",
    "No browser bundle, response, local storage, or telemetry contains admin or publisher credentials"
  ],
  "failureBehavior": [
    "Do not turn the console into a marketing page, raw YAML editor, or dashboard card grid",
    "Do not let browser state infer success or hide a failed owner",
    "Do not duplicate API validation, signature verification, or publication authority in TypeScript"
  ],
  "updatedAt": "2026-10-18T13:54:42.000Z"
}
```

## Objective

Land one production UI closure after the admin and publisher owners are
independently functional.

## Current Snapshot

- The top-level `control` prototype is confirmed and covers all required
  interaction and recovery states.
- No production console consumes the accepted admin and publisher contracts.
