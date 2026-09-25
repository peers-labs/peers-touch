# LDCP-P1: Agent-Managed Profile Policy

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-PROGRESS-20260917",
  "taskId": "LDCP-P1",
  "workstreamId": "LDCP-AGENT-POLICY",
  "title": "Agent-managed profile policy",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ldcp-agent-policy",
  "journeyId": "LDCP-J01-agent-managed-profile",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/local-dev-control-plane",
    "tooling/scripts/lib",
    "tooling/scripts/local-dev",
    "tooling/scripts/local_dev_profile_resolution_test.py",
    "tooling/skills/pt-local-dev-env"
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
      "id": "ldcp-policy-syntax",
      "command": "node --check tooling/scripts/local-dev/machine-dev-registry.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ldcp-policy-tests",
      "command": "node --test tooling/scripts/local-dev/machine-dev.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "every profile has one explicit Agent control mode",
    "profile resolution exposes the mode",
    "missing or invalid modes fail closed",
    "skills stop requesting repeated approval inside managed authority"
  ],
  "failureBehavior": [
    "never infer Agent authority from a profile name",
    "never let managed mode authorize destructive reset",
    "never let disposable mode bypass declaration, capability or lease checks"
  ],
  "updatedAt": "2026-09-17T04:18:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "node --test tooling/scripts/lib/machine-dev-paths.test.mjs (5/5)"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "node --test tooling/scripts/local-dev/machine-dev.test.mjs (12/12)"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "python3 tooling/scripts/local_dev_profile_resolution_test.py (12/12)"
    },
    {
      "verificationClass": "STRUCTURAL_CHECK",
      "result": "PASS",
      "ref": "env profile Agent control scan (9/9)"
    }
  ]
}
```

## Objective

Make reviewed profile policy the explicit upper bound for autonomous Agent
environment operations.

## Current Snapshot

- Architecture decisions are accepted.
- DWF-P1 is complete.
- Canonical and generated profiles require an explicit control mode.
- Full policy, registration, slot, lease, path, and profile-resolution suites pass.
