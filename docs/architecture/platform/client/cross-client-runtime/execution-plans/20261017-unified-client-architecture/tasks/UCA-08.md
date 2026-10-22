# UCA-08：统一架构冒烟收口

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UCA-20261017",
  "taskId": "UCA-08",
  "workstreamId": "ARCHITECTURE-PROOF",
  "title": "证明旧 owner 归零、三端可组合并更新实际效果对比",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "uca-architecture-proof",
  "journeyId": "CCR-J08-architecture-proof",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "docs/architecture/platform/client/cross-client-runtime/execution-plans/20261017-unified-client-architecture/outcome-comparison.md",
    "tooling/scripts/uca_smoke"
  ],
  "readSet": [
    "apps/desktop",
    "apps/mobile",
    "apps/station",
    "model",
    "packages/client-chat-core",
    "packages/client-media-security",
    "packages/client-storage",
    "packages/messaging-core",
    "packages/secure-content-core",
    "docs/architecture/domains/chat/messaging",
    "docs/architecture/engineering/acceptance",
    "docs/architecture/engineering/architecture-governance",
    "docs/architecture/platform/client/cross-client-runtime",
    "docs/architecture/platform/client/mobile",
    "docs/client/common",
    "docs/client/mobile",
    "tooling/acceptance",
    "tooling/scripts/architecture"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 14400,
    "cleanupSeconds": 900
  },
  "checks": [
    {
      "id": "uca08-structure",
      "command": "node tooling/scripts/architecture/module-governance.mjs validate && make plan-validate PLAN=docs/architecture/platform/client/cross-client-runtime/execution-plans/20261017-unified-client-architecture/plan.md",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "uca08-smoke",
      "command": "python3 tooling/scripts/uca_smoke.py --platform all",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "架构 registry 中每个共享能力只有一个 canonical root，所有 direct consumer、allowed dependency、Gate 与 divergence 均可追踪",
    "Messaging 与 Secure Content 的旧 Desktop/Mobile semantic owner inventory 为零，不存在双写、compatibility facade 或隐藏 fallback",
    "Desktop native、Android Emulator、iOS Simulator 的 build、launch、进程重启与 adapter smoke 均绑定同一 current source revision",
    "Android 与 iOS 共享一个 Mobile product/runtime projection，Host 差异只表现为 typed capability fact 与 adapter",
    "outcome-comparison.md 的 UCA-O01 至 UCA-O10 逐项记录实际结果、精确 Gate/evidence 引用和未完成项；未证明项不得写成已完成",
    "outcome-comparison.md 记录当前源码、聚焦 Gate 与 smoke 引用；计划区受 Plan digest 保护，结果区快照可审计",
    "只运行 Plan 声明的聚焦源码闭环和三端 smoke，不执行 Completion、Full 或 release aggregate",
    "本次启动的 Desktop、Emulator、Simulator 与临时构建资源完成清理"
  ],
  "failureBehavior": [
    "冒烟收口不修产品源码；发现缺陷必须退回 UCA-01 至 UCA-06 的对应 owner",
    "历史 evidence、其他 commit、iOS 代 Android 或 package test 代 Host smoke 均不接受",
    "任何旧 owner 引用、缺失三端 smoke、stale evidence 或 cleanup failure 都保持 Plan incomplete",
    "不把 smoke 结果扩大为 APNs、FCM、物理设备、OEM 调度器或发布就绪证明",
    "outcome-comparison.md 只记录事实，不用预期效果掩盖实际未达成"
  ],
  "updatedAt": "2026-10-19T16:52:14.000Z"
}
```

## 完整闭环

先运行 source/owner inventory，再执行 Desktop native、Android Emulator 与
iOS Simulator 的 bounded smoke。缺失、过期或失败的结果退回对应 functional
Task。完成后更新 companion report 的实际结果栏。

## Amendment 2026-10-18

用户于 2026-10-20 明确将本 Plan 的完成证明收紧为当前改动面的三端 smoke：
Desktop native、Android Emulator、iOS Simulator。推送 provider、物理设备和
Completion/Full Acceptance 不属于本次完成条件。
