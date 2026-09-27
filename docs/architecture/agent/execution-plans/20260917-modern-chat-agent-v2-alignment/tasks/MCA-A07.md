# MCA-A07 - Evaluation Formal Candidate Closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-A07",
  "workstreamId": "MCA-A07",
  "title": "Land Evaluation scenario control and close V2-J06",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "V2-J06-formal-candidate",
  "journeyId": "V2-J06",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent",
    "apps/station/app/subserver/agent",
    "apps/station/app/subserver/conversation",
    "apps/station/app/subserver/social",
    "apps/desktop/src/acceptance/agent",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/mobile",
    "packages/messaging-core",
    "tooling/acceptance"
  ],
  "readSet": [],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 10800,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "evaluation-candidate-tests",
      "command": "python3 -m unittest tooling.acceptance.gates.agent.evaluation_development_test tooling.acceptance.gates.agent.evaluation_candidate_test",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "evaluation-candidate-functional",
      "command": "python3 tooling/acceptance/gates/agent/evaluation_development.py --formal-candidate",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "The single MCA-D22 scenario controller implements the accepted MCA-D24 Evaluation family without a parallel authority",
    "Production Station cannot activate scenario control",
    "All 57 reviewed Desktop, Browser, and Mobile-contract tuples execute independently",
    "Cell, runtime-event, TurnTrace, metrics, Station, replay, receiver, side-effect, and cleanup observations bind one Evaluation execution per tuple",
    "The shallow synthetic 57-entry writer is removed and duplicate execution identities are rejected",
    "The exact-source Station preserves the reviewed Conversation receiver and Social private-content hard cuts",
    "The exact-source candidate passes the full semantic validator"
  ],
  "failureBehavior": [
    "Keep agent-v2-evaluation-lab-e2e UNPROVEN",
    "Reject empty or synthesized cell-results",
    "Do not reuse one Evaluation run or Turn lineage across tuple keys"
  ],
  "updatedAt": "2026-09-19T01:34:00Z",
  "durableEvidence": []
}
```

## Objective

Land the MCA-D24 Evaluation scenario boundary, then close durable Evaluation
evidence across exact tuple cells, cancellation, retry, metrics lineage,
restart, actor isolation, Browser parity, Mobile contract, and cleanup.

## Current Snapshot

- MCA-D24 is accepted for deterministic J06 races, failures, and restart.
- The composite Native J06 Journey is `FUNCTIONAL_PASS`; formal
  `cell-results` remains empty.
- Exact-source deployment exposed integration regressions in the Conversation
  receiver and Social private-content owners; this Task includes their
  source-backed hard-cut restoration before the candidate rerun.
- Exact-source native launch exposed rebased Messaging Core projection drift
  and a non-fail-fast WebDriver startup wait; this Task includes their bounded
  repair before the candidate rerun.
- Final `PROVEN` promotion remains owned by MCA-A08.
