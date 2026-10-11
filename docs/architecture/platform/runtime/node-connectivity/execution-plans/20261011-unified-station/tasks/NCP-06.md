# NCP-06: Agent Ownership And Recovery Fencing

## Task Slice

```json
{
  "kind": "peers-touch-task-slice", "planId": "NCP-UNIFIED-STATION-20261011",
  "taskId": "NCP-06", "workstreamId": "NCP-FENCING",
  "title": "Extend existing Agent lease authority to preserve healthy work across node startup and takeover",
  "workClass": "refactor", "completionClass": "functional", "executionMode": "build",
  "closureId": "ncp-agent-fencing", "journeyId": "NCP-G06-AGENT", "runtimeClass": "service",
  "writeSet": ["apps/station/app/subserver/agent", "model/domain/agent", "apps/station/frame/touch/model", "tooling/acceptance", "tooling/scripts", "docs"],
  "readSet": ["apps/station/frame", "apps/station/app"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 300, "cleanupSeconds": 60},
  "checks": [
    {"id": "agent-lease-source", "command": "go test ./apps/station/app/subserver/agent/service/... -run 'RecoverRunningChatTasks|Lease|Fencing' -count=1", "verificationClass": "SOURCE_CHECK"},
    {"id": "agent-functional", "command": "python3 tooling/scripts/node-connectivity-journey.py --closure ncp-agent-fencing --functional", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "agent-proof", "command": "python3 tooling/scripts/acceptance-run.py --gate NCP-G06-AGENT", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "runtimeReuse": {"scope": "suite", "entryCheckId": "agent-functional", "scenarioIds": ["NCP-G06-HEALTHY", "NCP-G06-TAKEOVER", "NCP-G06-STALE"], "maxProvisioningRuns": 1, "maxClientLaunches": 2, "minWarmReuseRate": 0.66, "requireAttachOnlyScenarios": true, "requireReceiverVisibleProof": true, "allowClientReplacement": false},
  "doneWhen": ["Existing ExecutorLease includes node incarnation and monotonic token enforced on renew/release/completion.", "Peer boot excludes healthy foreign leases; expired takeover advances token.", "Stale owner completion cannot commit; ambiguous external effects retain domain recovery semantics."],
  "failureBehavior": ["No blanket settlement of every RUNNING Chat step at boot.", "No second scheduler or claim of exactly-once provider effects.", "Shared clock uses database time."],
  "updatedAt": "2026-10-11T00:00:00.000Z"
}
```

## Current Snapshot

ExecutorLease exists; current RecoverRunningChatTasks scans all running Chat
steps without proving expired foreign ownership.

## Verification Contract

Harness holds real durable work and lease on A, boots B, observes no interruption,
then pauses A beyond lease expiry and lets B claim. Resume A and attempt stale
completion; assert database rejects it and exactly one terminal domain record.
Independent readback checks lease token, task/turn state and replayable events.
Actual provider effects require their separate idempotency/ambiguity oracle.
