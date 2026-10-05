# CCU-07 零引用与聚合验收

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCU-20260922",
  "taskId": "CCU-07-zero-aggregate",
  "workstreamId": "CCU-W07",
  "title": "九维零引用与 CCU 聚合验收",
  "workClass": "refactor",
  "completionClass": "acceptance-aggregate",
  "executionMode": "build",
  "closureId": "ccu-zero-aggregate",
  "journeyId": "CCU-J06",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/runtimes/socialProjectionRuntime.ts",
    "tooling/acceptance",
    "docs/architecture/chat-lifecycle"
  ],
  "readSet": [
    "apps/desktop",
    "apps/mobile",
    "apps/station",
    "model/domain/chat",
    "model/domain/realtime",
    "packages/messaging-core"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 14400,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "ccu-07-tree-zero-ref-structural",
      "command": "python3 tooling/acceptance/gates/chat/lifecycle_tree_zero_reference.py",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "ccu-07-tree-zero-ref-regression",
      "command": "python3 -m unittest tooling.acceptance.gates.chat.lifecycle_tree_zero_reference_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccu-07-aggregate-evidence-contract",
      "command": "python3 -m unittest tooling.acceptance.gates.chat.lifecycle_ccu_aggregate_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccu-07-chat-safety",
      "command": "python3 -m unittest tooling.acceptance.gates.chat.lifecycle_safety_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccu-07-receiver-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-native-two-client-e2e --runtime-cell desktop-macos-native",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "ccu-07-tree-zero-ref",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-tree-zero-reference-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "ccu-07-aggregate",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-ccu-aggregate-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "CHAT-G21 的九个维度各自有零计数和 current exact-source evidence",
    "renamed wrapper、generic dispatch、alias、bridge、compatibility flag 均视为违规",
    "legacy store、repository、schema、table、test、fixture、script、Gate 和 current docs 引用归零",
    "CCU aggregate 只从 canonical Evidence Store authoritative latest 读取前置 Gate，不读写 source-tree runtime report",
    "CHAT-G15 使用已登记的 messaging-platform-contract evidence；CHAT-G16-G21 使用各自已登记 Gate evidence，不允许 phantom、optional 或 skipped prerequisite",
    "Desktop receipt projection changes have current exact-source native sender/receiver proof from chat-native-two-client-e2e",
    "既有诊断会话遗留的 Mobile debug collector 与 debug marker 已删除，生产源码无未声明 debug egress",
    "CHAT-G15-G21 全部在同一 exact source 上通过，CHAT-G22 聚合通过",
    "本 Task 只验证和聚合，不承担延迟 migration 或删除"
  ],
  "failureBehavior": [
    "任一维度缺失、不可检查或存在引用都保持 UNPROVEN",
    "任一前置 Gate 非 current exact-source PROVEN 时禁止聚合 PASS",
    "若聚合器仍依赖 source-tree runtime report，只允许在本 Task 内完成 Evidence Store hard cut，不得修改产品行为",
    "若安全检查发现既有临时诊断 instrumentation，只允许原样删除，不得借机修改 runtime 语义"
  ],
  "updatedAt": "2026-09-25T07:32:00Z",
  "durableEvidence": [
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "acceptance-run:20260925T072018954413Z-db23c515089c6e5e18f036c43ab55f77/reports/run.json"
    },
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "acceptance-gap-detect:latest/reports/gap-report.json"
    },
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "quality-evidence:20260925T072440731955Z-2b9464e56e896aac6d26113f96ab7d50/reports/quality-evidence.json"
    }
  ]
}
```

## 范围

该 closure 只证明 `CCU-J06` 和整个 CCU 的完成性。所有生产迁移与删除必须已经
在前置行为 closure 完成。

## 依赖

- CCU-06-final-cutover

## Current Snapshot

- State: done.
- G21 scans all nine required dimensions, G22 aggregates current exact-source
  CHAT-G15 through CHAT-G21 evidence, and the native two-client Gate proves the
  receiver-visible receipt path on macOS.
- The exact CCU completion claim passes the Acceptance Gap Detector with no
  blocking gaps.
