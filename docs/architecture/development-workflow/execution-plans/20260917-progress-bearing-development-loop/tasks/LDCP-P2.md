# LDCP-P2: Read-Only Environment Dashboard

## Task Slice

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-task-slice",
  "planId": "DWF-PROGRESS-20260917",
  "taskId": "LDCP-P2",
  "workstreamId": "LDCP-DASHBOARD",
  "title": "Read-only environment dashboard",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ldcp-dashboard",
  "journeyId": "LDCP-J02-environment-occupancy-dashboard",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/local-dev-control-plane",
    "tooling/scripts/README.md",
    "tooling/scripts/local-dev",
    "tooling/make/local-dev.mk",
    "Makefile"
  ],
  "readSet": [
    "docs/architecture/development-workflow"
  ],
  "budgets": {
    "focusedCheckSeconds": 120,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "ldcp-dashboard-syntax",
      "command": "node --check tooling/scripts/local-dev/environment-dashboard.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ldcp-dashboard-tests",
      "command": "node --test tooling/scripts/local-dev/environment-dashboard.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "dashboard snapshot joins profiles, registrations, declarations and leases",
    "profile and cluster occupancy are explicit",
    "secret-bearing profile values are absent",
    "the served dashboard exposes no mutation endpoint"
  ],
  "failureBehavior": [
    "surface malformed sources as typed blocked state",
    "never rewrite registry, work ledger, lease or profile state",
    "never expose raw profile documents or credentials"
  ],
  "updatedAt": "2026-09-17T04:18:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "node --check tooling/scripts/local-dev/environment-dashboard.mjs"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "node --test tooling/scripts/local-dev/environment-dashboard.test.mjs (2/2)"
    },
    {
      "verificationClass": "UX_REVIEW",
      "result": "PASS",
      "ref": "Headless Chrome 1440x1000 and 390x844 dashboard renders"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "make env-dashboard-snapshot ENV_REPO=../env"
    }
  ]
}
```

## Objective

Provide a small operational dashboard backed only by read-only projections from
the existing environment and machine control-plane owners.

## Current Snapshot

- Architecture decisions are accepted.
- LDCP-P1 is complete.
- Redacted live snapshot and HTTP dashboard are implemented.
- Desktop and narrow viewport renders are verified.
