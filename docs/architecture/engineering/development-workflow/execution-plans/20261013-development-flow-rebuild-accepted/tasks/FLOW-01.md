# FLOW-01：运行请求与任务登记解耦

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-REBUILD-20261013",
  "taskId": "FLOW-01",
  "workstreamId": "FLOW-RUNTIME",
  "title": "运行请求独立保留权限、真实资源锁和清理",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "runtime-independent",
  "journeyId": "DEV-J04",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/scripts/local-dev/machine-dev-registry.mjs",
    "tooling/scripts/local-dev/machine-dev.mjs",
    "tooling/scripts/local-dev/machine-dev.test.mjs",
    "tooling/scripts/local-dev/machine-dev-lease.py",
    "tooling/scripts/local-dev/station-dev.sh",
    "tooling/scripts/local-dev/desktop-dev.sh",
    "tooling/devctl",
    "docs/architecture/engineering/local-dev",
    "docs/architecture/engineering/toolchain",
    "tooling/skills/pt-local-dev-env",
    "tooling/skills/pt-dev-runtime-handoff"
  ],
  "readSet": [
    "docs/architecture/engineering/development-workflow",
    "docs/knowledge",
    "tooling/scripts/local-dev/dev-resource-plan.mjs",
    "tooling/scripts/local-dev/dev-work-ledger.mjs"
  ],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 600, "cleanupSeconds": 60},
  "checks": [
    {
      "id": "runtime-source",
      "command": "node --test tooling/scripts/local-dev/machine-dev.test.mjs tooling/devctl/test/profile.test.mjs tooling/devctl/test/station.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "runtime-functional",
      "command": "node --test tooling/scripts/local-dev/machine-dev.test.mjs tooling/devctl/test/process-adapter.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "runtime-formal",
      "command": "python3 tooling/scripts/acceptance-run.py --gate machine-dev-registry-self",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "真实启动与资源申请入口无需开发登记、PlanMount、OWNER 或 Hook 回执",
    "复用现有 capability、操作授权和已评审 Profile，不从任务存在推导许可",
    "目标及数据范围由入口校验，资源键不能由 Profile 别名或 caller resourceId 绕开",
    "无授权、stable 自主重置、环境创建和目标不匹配在副作用前拒绝",
    "保留 OS 锁、锁内复查、PID 启动身份、进程组及所有权清理",
    "FLOW-A11—A13 在临时资源与受控副作用替身中通过"
  ],
  "failureBehavior": [
    "不扩展 ownerAction 成通用绕过，不用 caller allowed 代替授权来源",
    "不删除真实锁或在持有其他资源时无限等待",
    "不连接或部署实际 Station，不修改机器权限或其他任务资源",
    "发现未覆盖运行消费者时先补齐调用清单，不保留双权限路径",
    "替身通过不宣称真实远端、Native 产品或跨机器部署安全"
  ],
  "updatedAt": "2026-10-13T00:00:00.000Z"
}
```

## 完整闭环

先沿 `validateRuntimeIntent` 与运行入口查全调用，再以实际操作请求替代开发登记依赖。
保留锁实现仅在接口需要时修改。新增回归放入现有测试，检验副作用计数、并发竞争
及清理归属；本项不退役尚被其他消费者使用的任务模块。

## Current Snapshot

固定合同引用：FLOW-A11—A13。进度与证据在可选任务或既有证据存储，
本节不记录执行状态。命令只在实现后运行；正式现场验证另需具体授权。
