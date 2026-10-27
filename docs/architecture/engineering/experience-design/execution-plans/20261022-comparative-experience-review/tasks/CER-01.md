# CER-01：Paired Experience Evaluation

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CER-20261022",
  "taskId": "CER-01",
  "workstreamId": "PAIRED-EVALUATION",
  "title": "关闭 Oracle、JourneyObservation、Leg Review 与 paired differential",
  "workClass": "infrastructure",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "cer-paired-evaluation",
  "journeyId": "experience.compare.same-journey",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/engineering/experience-design",
    "tooling/scripts/experience-design/comparative-schema.mjs",
    "tooling/scripts/experience-design/comparative-evaluator.mjs",
    "tooling/scripts/experience-design/comparative-test-fixture.mjs",
    "tooling/scripts/experience-design/comparative-schema.test.mjs",
    "tooling/scripts/experience-design/comparative-evaluator.test.mjs"
  ],
  "readSet": [
    "docs/client/common/interaction-design-methodology.md",
    "docs/client/common/ui-identity/grammar-bindings.json",
    "tooling/scripts/experience-design/canonical.mjs",
    "tooling/scripts/experience-design/evaluator.mjs",
    "tooling/scripts/experience-design/review-result-schema.mjs",
    "tooling/scripts/experience-design/validator.mjs"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 300,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "cer01-schema",
      "command": "node --test tooling/scripts/experience-design/comparative-schema.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "cer01-evaluator",
      "command": "node --test tooling/scripts/experience-design/comparative-evaluator.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Oracle、Context、Evidence Ledger、JourneyObservation、OracleEvaluation、LegReview 和 PairedExperienceCase 使用闭合 schema 与 canonical digest",
    "所有 package-relative path 都被显式 package root 包含，symlink 或 traversal 逃逸失败",
    "两条 leg 字段完全同形且不包含 Peers identity 或 Peers-only binding",
    "pair evaluator 对每个 Oracle assertion 产生 met/not-met/unproven differential，并重算 observed path cost 与最早 divergent state",
    "输入 A/B 顺序置换只改变 alias 方向，不改变 materiality、priority 或语义集合",
    "context mismatch、stale leg、review overlap 和 evidence gap fail closed"
  ],
  "failureBehavior": [
    "不把 reference product 放进 Peers UI Grammar 或 Product Contract",
    "不从截图推断动态、恢复、authority 或 backend root cause",
    "任一 required evidence 缺失时保持 UNPROVEN",
    "本 Task 不读取 IdentityMap 或生成 Peers disposition"
  ],
  "updatedAt": "2026-10-22T03:00:00.000Z"
}
```

## 完整闭环

本 Task 让两个同条件体验实现能够先独立冻结，再由机器产生 identity-neutral
differential。输出只证明“哪里不同、证据是否可比”，不批准因果解释或 Peers
产品取舍。
