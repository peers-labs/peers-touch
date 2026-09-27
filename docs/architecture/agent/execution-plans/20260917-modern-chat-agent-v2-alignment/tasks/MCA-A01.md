# MCA-A01 - D21 Formal Evidence Contract Hard Cut

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-A01",
  "workstreamId": "MCA-A01",
  "title": "Cut over the runtime-truthful formal evidence contract",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "V2-A01-contract",
  "journeyId": "V2-acceptance",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/agent",
    "tooling/acceptance",
    "tooling/scripts/acceptance-validate.py",
    "tooling/scripts/expand-agent-v2-runtime-matrix.py"
  ],
  "readSet": [
    "apps/desktop",
    "apps/station/app/subserver/agent",
    "model/domain/agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "d21-contract",
      "command": "python3 -m unittest tooling.acceptance.tests.test_agent_v2_runtime_matrix tooling.acceptance.tests.test_gate_proof_contract tooling.acceptance.gates.agent.agent_v2_candidate_producer_test tooling.acceptance.gates.agent.foundation_candidate_producer_test && make acceptance-validate DOMAIN=agent",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "alignment-plan",
      "command": "node tooling/scripts/plan/planctl.mjs validate --plan docs/architecture/agent/execution-plans/20260917-modern-chat-agent-v2-alignment/plan.md",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "Every Agent V2 matrix row declares one accepted runtime-truthful profile and a complete disjoint role policy",
    "Schemas, validator, and one shared candidate assembler support MCA-D21 profiles and reject cross-tuple execution identity reuse",
    "The implicit J01-J06 legacy direct-runtime fallback is removed and registration-only candidates cannot satisfy semantic validation",
    "The amended Plan Package validates with V2-acceptance as the aggregate Journey identity"
  ],
  "failureBehavior": [
    "Keep every J01-J06 Gate UNPROVEN",
    "Reject any profile that requires an entity its production path does not create",
    "Reject any producer fixture that relabels one execution across tuple keys",
    "Return matrix/profile semantic gaps to MCA-D21 instead of weakening the validator"
  ],
  "updatedAt": "2026-09-18T08:45:00Z",
  "durableEvidence": []
}
```

## Objective

Land the accepted MCA-D21 contract as the single source for J01-J06 formal
tuple identity, runtime attestation, role applicability, and candidate
assembly.

## Current Snapshot

- MCA-D21 was approved on 2026-09-18.
- J01-J06 still use an implicit legacy attestation fallback.
- Existing J06 candidate output passes only the shallow registration check.
- No J01-J06 Gate may become `PROVEN` in this Task.
