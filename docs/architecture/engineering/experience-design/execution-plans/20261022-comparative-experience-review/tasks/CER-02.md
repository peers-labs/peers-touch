# CER-02：Blind Review、Disposition 与 Target Projection

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CER-20261022",
  "taskId": "CER-02",
  "workstreamId": "REVIEW-AND-TARGET",
  "title": "关闭 blind delta、identity reveal、Peers disposition 与 Target projection",
  "workClass": "infrastructure",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "cer-review-and-target",
  "journeyId": "experience.compare.same-journey",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/engineering/experience-design",
    "tooling/scripts/experience-design/comparative-review.mjs",
    "tooling/scripts/experience-design/comparative-review.test.mjs",
    "tooling/scripts/experience-design/comparative-cli.test.mjs",
    "tooling/scripts/experience-design/experience-design.mjs"
  ],
  "readSet": [
    "tooling/scripts/experience-design/comparative-schema.mjs",
    "tooling/scripts/experience-design/comparative-evaluator.mjs",
    "tooling/scripts/experience-design/evaluator.mjs",
    "tooling/scripts/experience-design/review-receipt.mjs",
    "tooling/scripts/experience-design/source-fence.mjs"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 300,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "cer02-review",
      "command": "node --test tooling/scripts/experience-design/comparative-review.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "cer02-cli",
      "command": "node --test tooling/scripts/experience-design/comparative-cli.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "BlindedDeltaReport 精确覆盖全部 material differentials 并绑定 paired evaluation digest",
    "blind reviewer 与 Oracle、leg、evidence、pairing authors 全部 non-overlap",
    "blind command 的输入和输出不包含 IdentityMap、Peers owner、benchmark identity 或 disposition",
    "IdentityMap 只能在 accepted blind review 后 reveal，且 A/B 恰好映射一个 peers 与一个 reference",
    "CausalDeltaReport 只在 reveal 后增加 kind、owner、disposition 和可选 intervention evidence",
    "intervention-confirmed 必须绑定干预证据；supported mechanism 不得升级为 proven root cause",
    "Target projector 只投影 disposition review 接受的 adopt/adapt proposal，reject/defer 和未评审 delta 不产生 target",
    "任何 Oracle、Context、Leg、Pair、Blind Review、Identity 或 Disposition drift 使下游命令失败"
  ],
  "failureBehavior": [
    "不让同一 reviewer 跨 blind 与 disposition 两个独立边界",
    "不自动修改 active Product Contract",
    "不把 accepted target proposal 等同于 prototype、production 或 framework value PASS",
    "不保留绕过 staged review 的直接 compare-to-target 命令"
  ],
  "updatedAt": "2026-10-22T03:00:00.000Z"
}
```

## 完整闭环

本 Task 把“观察到差异”推进到“可独立评审的机制解释与 Peers 产品取舍”，同时
保持 blind judgment、identity reveal 和 active Product authority 三个边界互不
越权。
