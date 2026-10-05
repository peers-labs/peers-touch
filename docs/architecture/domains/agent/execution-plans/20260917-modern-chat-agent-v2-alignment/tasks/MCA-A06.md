# MCA-A06 - Connector Formal Candidate Closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-A06",
  "workstreamId": "MCA-A06",
  "title": "Produce the complete V2-J05 Connector candidate",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "V2-J05-formal-candidate",
  "journeyId": "V2-J05",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src-tauri",
    "apps/desktop/src/acceptance/agent",
    "apps/mobile",
    "apps/station/app/subserver/agent",
    "apps/station/frame/touch",
    "docs/architecture/agent",
    "go.work.sum",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/station/app/subserver/agent",
    "model/domain/agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 7200,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "connector-candidate-tests",
      "command": "python3 -m unittest tooling.acceptance.gates.agent.connector_invocation_development_test tooling.acceptance.gates.agent.connector_invocation_candidate_test",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "connector-runtime-matrix",
      "command": "python3 tooling/scripts/expand-agent-v2-runtime-matrix.py --check tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml && python3 -m unittest tooling.acceptance.tests.test_agent_v2_runtime_matrix tooling.acceptance.tests.test_gate_proof_contract",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "connector-station-scenario",
      "command": "cd apps/station && go test ./app/subserver/agent/service -run 'TestCapabilityAcceptanceScenario.*Connector|TestConnector' -count=1",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "connector-station-build",
      "command": "cd apps/station/frame && go test ./touch ./touch/accessgate ./touch/accessgate/gatekeeper && cd ../app && go build ./...",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "connector-candidate-functional",
      "command": "python3 tooling/acceptance/gates/agent/connector_invocation_development.py --formal-candidate",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "All 37 reviewed Desktop, Browser, and Mobile-contract tuples execute with unique identities",
    "Executed Connector tuples bind the real OAuth-owner client capability session, lease, receipt, provider revoke, replay, receiver, side-effect, and cleanup facts",
    "ERR-CON01 through ERR-CON04, R-06/A, and R-07/A prove zero dispatch without fabricated executor receipts",
    "Provider revocation_unconfirmed semantics preserve the observed provider result without weakening the formal terminal state",
    "The integrated Station Access Gate owner compiles with its submission and finalization contracts intact",
    "Station decodes JSON and protobuf Access Gate requests through the canonical proto-aware serializer",
    "The exact-source candidate passes the full semantic validator"
  ],
  "failureBehavior": [
    "Keep agent-v2-connector-invocation-e2e UNPROVEN",
    "Reject credential-bearing evidence and detached OAuth resource revisions",
    "Do not represent the OAuth-owner client executor as a Station executor"
  ],
  "updatedAt": "2026-09-21T00:00:00Z",
  "durableEvidence": []
}
```

## Objective

Close Connector invocation evidence from OAuth resource through Station-owned
ToolCall lineage, Browser parity, Mobile contract, provider revoke, and cleanup.

## Current Snapshot

- MCA-D23 and MCA-D26 are accepted; MCA-A04 owns the shared J03-J05
  scenario-control prerequisite, while this Task owns the J05-specific
  Connector state setup and evidence adaptation.
- One Native Connector Journey passes.
- Browser, Mobile-contract, exact tuple identity, and full validator coverage
  are incomplete.
- Integration commit `2eb2499b8` exposed an omitted Access Gate owner file set;
  MCA-A06 includes the accepted Access Gate package only to restore a buildable
  exact-source Station before rerunning J05.
- Final `PROVEN` promotion remains owned by MCA-A08.
