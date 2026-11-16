# RES-02：覆盖决定、锁后重验与恢复

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "LDCP-RES-20261114",
  "taskId": "RES-02",
  "workstreamId": "OVERWRITE",
  "title": "ID 覆盖告知、具体 force/decline、实际变更与恢复",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "resource-overwrite",
  "journeyId": "LDCP-R04-R08-R09-overwrite",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/scripts/local-dev/machine-dev-resource-contract.mjs",
    "tooling/scripts/local-dev/machine-dev-resource-store.mjs",
    "tooling/scripts/local-dev/machine-dev-ios-provider.mjs",
    "tooling/scripts/local-dev/machine-dev.mjs",
    "tooling/scripts/local-dev/machine-dev-lease.py",
    "tooling/scripts/local-dev/machine-dev-resource-overwrite.test.mjs",
    "docs/architecture/engineering/local-dev"
  ],
  "readSet": ["tooling/scripts/local-dev/machine-dev-registry.mjs", "docs/knowledge", "docs/global/workflow.md"],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 600, "cleanupSeconds": 60},
  "checks": [
    {"id": "res02-source", "command": "node --test tooling/scripts/local-dev/machine-dev-resource-overwrite.test.mjs", "verificationClass": "SOURCE_CHECK"},
    {"id": "res02-overwrite", "command": "node --test --test-name-pattern=ResourceOverwriteJourney tooling/scripts/local-dev/machine-dev-resource-overwrite.test.mjs", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "notice 显示 exact ID/provider、所有共享 Profiles、holder、当前/目标 content/source 和 data/session effects",
    "引用/inspect/同内容无冲突不提示覆盖；拒绝/取消/未响应不变更，具体 force 才进入该次操作",
    "force 非默认值且不跨操作复用，不绕 OS 锁；锁后 references/content/holder 变化重新告知",
    "成功或部分失败以 canonical content/last writer 投影给全部 Profiles",
    "creation/overwrite/release crash、SIGKILL/child hold 有界恢复；cleanup-failed 保留身份/原因/retry",
    "detach/release 不删共享资源，explicit delete 有独立 device/directory absence readback"
  ],
  "failureBehavior": [
    "本次架构要求不是实际 force 许可；不默认停止活跃进程或接管 unknown",
    "活跃 user process 的停止须具体确认，force 不绕锁",
    "fake failure fixtures 不替代真实 provider/native 证据，四不操作"
  ],
  "updatedAt": "2026-11-15T00:00:00.000Z"
}
```

解锁 RES-03。覆盖确认只限定具体资源操作，不引入 task/Plan 授权系统，也不改
Station 原非 stable reset 政策。
