# CHAT-01 Safety And Evidence Baseline

## Task Slice

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-task-slice",
  "planId": "CHAT-LIFECYCLE-20260916",
  "taskId": "CHAT-01-safety",
  "workstreamId": "CHAT-W00",
  "title": "Safety and current-evidence baseline",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "chat-safety",
  "journeyId": "CHAT-J00",
  "runtimeClass": "service",
  "writeSet": [
    "apps/station/app/subserver/conversation",
    "apps/station/app/subserver/social/private_content_ports.go",
    "apps/station/app/subserver/social/private_content_ports_test.go",
    "apps/mobile/src",
    "apps/mobile/src-tauri/src",
    "tooling/acceptance",
    "tooling/scripts/lib/machine-dev-paths.mjs",
    "tooling/scripts/deploy/source_sync.py",
    "docs/architecture/chat-lifecycle/current-capability-audit.md"
  ],
  "readSet": [
    "docs/architecture/chat-lifecycle",
    "docs/architecture/messaging-platform",
    "docs/architecture/social-runtime"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "chat-safety-source",
      "command": "python3 -m unittest tooling.acceptance.gates.chat.lifecycle_safety_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "chat-safety-functional",
      "command": "python3 -m tooling.acceptance.gates.chat.lifecycle_safety",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-safety-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-safety-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Production source has no undeclared debug HTTP egress",
    "Mobile and Desktop evidence derives identity from observed production output",
    "Registered required Chat scenarios execute or return typed blocked evidence",
    "Current capability audit is regenerated without historical-proof promotion"
  ],
  "failureBehavior": [
    "Stop on any remaining hard-coded collector or fabricated evidence oracle",
    "Do not start feature work while safety or evidence integrity is unresolved"
  ],
  "updatedAt": "2026-09-16T10:13:00Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "development://CHAT-01-safety-20260916/chat-safety-focused"
    }
  ]
}
```

## Objective

Remove committed debug egress and establish trustworthy current-source evidence
before any product capability is promoted.

## Current Snapshot

- Hard-coded collector egress and temporary debug-point blocks are removed
  from the declared Station and Mobile production paths.
- Mobile people-search evidence projects the observed Federation identity;
  Desktop Federation context remains production-readback based.
- Every registered Mobile native scenario now emits typed blocked evidence
  when its physical implementation is unavailable.
- The machine Dev path helper exports the registry and lease paths required by
  remote Profile preflight; the fix is reused from commit `513fa3316`.
- Exact-source continuation preserves the outer Station deployment lease; the
  fix is reused from commit `575a5e328`.
- Social private-content startup now binds the exact Actor Identity capability
  signature, including independently resolved Home Station identity.
- Focused Go, Rust, TypeScript, and Python checks pass. No Chat product
  capability is promoted by this safety closure.
