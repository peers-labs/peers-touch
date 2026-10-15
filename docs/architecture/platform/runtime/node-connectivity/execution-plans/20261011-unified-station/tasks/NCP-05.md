# NCP-05: Shared Access And Session Continuity

## Task Slice

```json
{
  "kind": "peers-touch-task-slice", "planId": "NCP-UNIFIED-STATION-20261011",
  "taskId": "NCP-05", "workstreamId": "NCP-SHARED-TRUTH",
  "title": "Complete Access and Session transactions across two nodes of one Station",
  "workClass": "refactor", "completionClass": "functional", "executionMode": "build",
  "closureId": "ncp-shared-access", "journeyId": "NCP-G05", "runtimeClass": "service",
  "writeSet": ["apps/station/frame/touch", "apps/station/frame/core/facility/session", "apps/station/frame/core/auth", "apps/station/app/subserver/oauth", "apps/station/app/conf", "model/domain/peer", "tooling/acceptance", "tooling/scripts", "docs"],
  "readSet": ["apps/station/frame", "apps/station/app"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 300, "cleanupSeconds": 60},
  "checks": [
    {"id": "session-source", "command": "go test ./apps/station/frame/core/facility/session/... ./apps/station/frame/touch/auth/... -count=1", "verificationClass": "SOURCE_CHECK"},
    {"id": "access-functional", "command": "python3 tooling/scripts/node-connectivity-journey.py --closure ncp-shared-access --functional", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "access-proof", "command": "python3 tooling/scripts/acceptance-run.py --gate NCP-G05", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "runtimeReuse": {"scope": "suite", "entryCheckId": "access-functional", "scenarioIds": ["NCP-G05-ACK", "NCP-G05-CLASS", "NCP-G05-REVOKE"], "maxProvisioningRuns": 1, "maxClientLaunches": 2, "minWarmReuseRate": 0.66, "requireAttachOnlyScenarios": true, "requireReceiverVisibleProof": true, "allowClientReplacement": false},
  "doneWhen": ["Access attempts, OAuth acknowledgement and Session validation share canonical DB truth and Station-scoped keyring.", "Start on A and finish/use on B preserves logical identity and one idempotent Session.", "Concurrent class activation has one winner and revocation is enforced on either node."],
  "failureBehavior": ["Retain real DBStore and row locking; do not add memory Session truth.", "Keyring or schema mismatch rejects readiness.", "No actual external OAuth provider or Mobile parity claim from harness checks."],
  "updatedAt": "2026-10-11T00:00:00.000Z"
}
```

## Current Snapshot

Live Touch auth already uses DBStore. Key material and every finalization path
must be inventoried; stored DB records alone do not prove cross-node recovery.

## Verification Contract

Harness invokes canonical Access start/submit/decision/ack on alternating nodes,
with shared-authority readback. Check identical Session ID on idempotent replay,
same-class concurrent activation, other-class coexistence and remote revocation.
No provider credentials are invented; native login/failover rendering is NCP-08.
