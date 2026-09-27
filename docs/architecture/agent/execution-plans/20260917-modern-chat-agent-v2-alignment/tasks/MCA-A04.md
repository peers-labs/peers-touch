# MCA-A04 - Governed Tool Formal Candidate Closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-A04",
  "workstreamId": "MCA-A04",
  "title": "Land shared operation scenario control and close V2-J03",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "V2-J03-formal-candidate",
  "journeyId": "V2-J03",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent",
    "apps/station/app/subserver/agent",
    "apps/desktop/src-tauri",
    "apps/desktop/src/acceptance/agent",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/mobile",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 10800,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "tool-candidate-tests",
      "command": "python3 -m unittest tooling.acceptance.gates.agent.governed_tool_development_test",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "tool-candidate-functional",
      "command": "python3 tooling/acceptance/gates/agent/governed_tool_development.py --formal-candidate",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "tool-candidate-unit",
      "command": "python3 -m unittest tooling.acceptance.gates.agent.governed_tool_candidate_test tooling.acceptance.gates.agent.agent_v2_candidate_producer_test",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "tool-runtime-matrix",
      "command": "python3 tooling/scripts/expand-agent-v2-runtime-matrix.py --check tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "tool-proof-contract",
      "command": "python3 -m unittest tooling.acceptance.tests.test_agent_v2_runtime_matrix tooling.acceptance.tests.test_gate_proof_contract",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "The single MCA-D22 scenario controller implements the accepted MCA-D23 J03-J05 families without a parallel authority",
    "Production Station and release Desktop builds cannot activate scenario control",
    "All 86 reviewed tuples execute with distinct station_turn, client_capability_turn, station_capability_turn, or contract_only identities",
    "ERR-O01, ERR-O05, R-05/A, and R-07/A prove zero execution without fabricated executor receipts",
    "J03 ERR-O06 expires the ToolCall receipt-recovery credential rather than a CapabilityOperation cleanup lease",
    "Decision, claim, continuation, replay, side-effect, receiver, cleanup, and either executor-receipt or bound zero-execution evidence remain one lineage per tuple",
    "Both race orderings execute independently and the candidate passes the full semantic validator",
    "A Station executor is never represented as a Browser client lease"
  ],
  "failureBehavior": [
    "Keep agent-v2-governed-tool-loop-e2e UNPROVEN",
    "Reject detached receipt, fence, TurnAttempt, or execution identities",
    "Do not replay one governed turn under multiple cells or orderings"
  ],
  "updatedAt": "2026-09-19T03:20:00Z",
  "durableEvidence": []
}
```

## Objective

Land the shared MCA-D23 capability-operation scenario boundary, then close the
governed ToolCall formal-candidate surface across Desktop local execution,
Browser Station execution, Mobile contract semantics, races, and replay.

## Current Snapshot

- MCA-D23 and MCA-D25 are accepted for the shared J03-J05 scenario-control
  boundary and J03 zero-execution evidence semantics.
- One deterministic Native governed ToolCall Journey passes; the 86 tuple
  candidate is not yet produced.
- Final `PROVEN` promotion remains owned by MCA-A08.
