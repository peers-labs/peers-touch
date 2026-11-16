# RES-03：Mobile 两入口按 Profile 选定 ID 启动

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "LDCP-RES-20261114",
  "taskId": "RES-03",
  "workstreamId": "MOBILE-RUN",
  "title": "Make/pnpm 消费同一 ID binding、共享视图和覆盖通知",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "mobile-id-binding",
  "journeyId": "LDCP-R02-R06-R08-mobile",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "tooling/scripts/local-dev/mobile-ios-sim.sh",
    "apps/mobile/scripts/ios-dev-sim.sh",
    "tooling/make/local-dev.mk",
    "tooling/scripts/local-dev/machine-dev-mobile-entry.test.mjs",
    "tooling/acceptance/gates/mobile/resource_dependencies_functional.py",
    "docs/global/local-dev-environment.md",
    "tooling/skills/pt-local-dev-env",
    "tooling/skills/pt-dev-runtime-handoff",
    "tooling/skills/pt-dev-workflow",
    "tooling/skills/pt-debug-space-clean",
    "docs/architecture/engineering/local-dev"
  ],
  "readSet": ["tooling/scripts/local-dev", "tooling/acceptance/environments", "apps/mobile", "docs/knowledge", "tooling/devctl"],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 2400, "cleanupSeconds": 120},
  "checks": [
    {"id": "res03-source", "command": "bash -n tooling/scripts/local-dev/mobile-ios-sim.sh apps/mobile/scripts/ios-dev-sim.sh && node --test tooling/scripts/local-dev/machine-dev-mobile-entry.test.mjs", "verificationClass": "SOURCE_CHECK"},
    {"id": "res03-native", "command": "python3 tooling/acceptance/gates/mobile/resource_dependencies_functional.py --scenario mobile-id-binding", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "两入口只消费 Profile 选定 ID 的 canonical binding/physical lease，无数量择机/随机 UUID/direct allocator fallback",
    "显示共享 Profiles/actual source，冲突变更消费 canonical notice 和具体 user decision",
    "Ensure Station deploy 分支删除，connect-only/offline 零 deploy/reset",
    "native driver 经真实入口读回 source/bundle/UUID holder/native 状态；拒绝覆盖保留内容",
    "操作 docs 和 Skills 同步 ID/共享/通知入口，只引用原 architecture owner"
  ],
  "failureBehavior": [
    "无 ID、compatibility/持有冲突、缺覆盖决定时返回具体原因，不隐式替换或创建",
    "native 场景不占用/停止四或部署 Station，缺条件准确标记未证实",
    "结束本次 operation 不 shutdown/delete 别人正在使用的共享设备"
  ],
  "updatedAt": "2026-11-15T00:00:00.000Z"
}
```

解锁 RES-04。新增 functional driver 是调用者，不拥有 allocation/decision。
所列新 test/driver 命令为待实现交付项。
