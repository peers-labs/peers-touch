# SAL-02：Federation Context 与 Relay 边界

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "SAL-20260926",
  "taskId": "SAL-02-federation-relay-boundary",
  "workstreamId": "SAL-W02",
  "title": "统一 Federation context 并移除普通客户端治理与 Relay 暴露",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "sal-federation-relay-boundary",
  "journeyId": "SAL-J04-J05",
  "runtimeClass": "service",
  "writeSet": [
    "model/domain/federation",
    "apps/station/frame/touch/actor",
    "apps/station/frame/touch/federation",
    "apps/station/app/subserver/federation",
    "apps/desktop",
    "apps/mobile",
    "docs/architecture/federation",
    "docs/architecture/api-ownership",
    "docs/knowledge/invariants/locator-publisher-symmetry.md",
    "packages/locales",
    "tooling/acceptance",
    "tooling/skills/pt-github-review/FRESHNESS.md"
  ],
  "readSet": [
    "docs/architecture/station-access-lifecycle",
    "docs/architecture/service-coordination.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 3000,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "station-federation-unit",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-federation-unit",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "federation-three-node-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate federation-three-node-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "station-access-federation-boundary-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-access-federation-boundary-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "station-api-ownership",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-api-ownership",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "Desktop and Mobile select and send the same explicit federation_id",
    "Scoped search and Direct or Group creation remain functional",
    "Ordinary clients expose no Federation create, join, leave, delete or member management",
    "Ordinary clients expose no Relay token, invite, mount or direct endpoint",
    "Actor visibility has one canonical profile owner",
    "Federation D-05 Settings Join or Leave clause is superseded",
    "Operator Federation and Relay flows remain functional"
  ],
  "failureBehavior": [
    "Do not invent a default Federation",
    "Do not delete operator APIs with a verified Dashboard or CLI consumer",
    "Do not move Federation or Relay truth into clients"
  ],
  "updatedAt": "2026-09-26T11:36:10.000Z",
  "durableEvidence": [
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "acceptance-run 20260926T111207959347Z-954df736a40dd1ece23fafa431f124e9"
    }
  ]
}
```

## Current Snapshot

- State: done。
- 普通客户端仅保留显式 Federation context 与发现能力；治理和 Relay surface
  已收回 Station owner，并通过 exact-source boundary proof。

## Closure

普通用户路径只保留明确 context 与连接状态，同时证明 Station operator plane 未被误删。

## Concurrency Decision

- Mode: serial after SAL-01。
- Reason: Station governance、客户端 consumers 和 route ownership 必须原子收口。
