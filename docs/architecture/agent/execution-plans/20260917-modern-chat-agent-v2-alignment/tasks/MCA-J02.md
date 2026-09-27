# MCA-J02 - Capability Inventory And Binding

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-J02",
  "workstreamId": "MCA-J02",
  "title": "Unified capability inventory and binding functional closure",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "V2-J02-functional",
  "journeyId": "V2-J02",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop",
    "apps/station/app/subserver/agent",
    "model/domain/agent",
    "packages/locales",
    "tooling/acceptance",
    "docs/architecture/agent"
  ],
  "readSet": [
    "docs/architecture/agent/modern-chat-agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "capability-focused",
      "command": "pnpm --dir apps/desktop exec vitest run src/store/agentCapabilities.test.ts src/runtimes/agentCapabilityRuntime.test.ts src/components/agent/AgentCapabilityInventoryPanel.test.ts src/store/agentConnectors.test.ts && (cd apps/station && go test ./app/subserver/agent/service -run 'Capability')",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "capability-native-journey",
      "command": "python3 tooling/acceptance/gates/agent/capability_binding_development.py",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "One inventory exposes source, version, compatibility, readiness, risk, and binding state",
    "Binding and policy writes use Station CAS and authoritative readback",
    "Incompatible, stale, disconnected, and deleted capabilities reject before execution",
    "The selected model/runtime snapshot is visible before send and the exact-source native Journey passes"
  ],
  "failureBehavior": [
    "Do not restore source-specific readiness authorities",
    "Do not mark a capability ready from installation or connection labels alone",
    "Preserve immutable historical snapshots when manifests or Agents are deleted"
  ],
  "updatedAt": "2026-09-17T00:41:51Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "apps/desktop:tsc-pass;apps/desktop:vitest:89-pass;apps/station:capability-tests-pass;tooling/acceptance:j02-tests-9-pass"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "workspace://65e7b6da4dc9be85/workflow/MCA-V2-ALIGNMENT-J02/artifacts/20260916T225645270058Z/result.json"
    }
  ]
}
```

## Objective

Reverify and complete V2-J02 against the Station capability manifest, binding,
and readiness authorities.

## Current Snapshot

- Canonical Station manifest/binding/readiness services and Desktop projection
  are implemented.
- The Agent Profile inventory UI is present in the current dirty source.
- The first focused source run exposed pre-admission failure-message
  persistence. The Station owner-layer correction now leaves no assistant
  message when a Turn is rejected before its user message is admitted.
- Knowledge inventory coverage, explicit compatibility and model/runtime
  readiness projection, and rejection of every enabled non-ready binding
  before execution are implemented in the current source.
- The J02 functional check uses one exact-source Native Development Journey;
  the 69-tuple candidate is owned by MCA-A03.
- Exact-source V2-J02 functional evidence passes at checkpoint
  `0cd4a977040cac9a36fb73cd91aed95fba3a7c2d`; aggregate formal proof remains
  owned by MCA-A08.

## Concurrency Decision

- **Mode**: hybrid.
- **Station lane**: capability readiness/admission and zero-execution
  regression tests under `apps/station/app/subserver/agent/service`.
- **Desktop lane**: unified inventory and composer projection under
  `apps/desktop/src`, plus matching locale entries.
- **Journey lane**: deterministic J02 producer and native readback under
  `tooling/acceptance/gates/agent` and its Provisioner support.
- **Integrator-owned**: this Plan Package, Task/Session projection, generated
  files, commits, Profile `two` deployment, cross-lane reconciliation, and
  final focused/functional Gates.
- The lanes share accepted proto and architecture contracts as read-only
  sources. They must serialize if implementation requires a shared generated
  contract or if a lane changes another lane's expected interface.
