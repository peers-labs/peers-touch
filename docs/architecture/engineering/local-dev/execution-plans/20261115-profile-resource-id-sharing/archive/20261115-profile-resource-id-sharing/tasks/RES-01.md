# RES-01：用户 ID 分配到共享实例绑定

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "LDCP-RES-20261114",
  "taskId": "RES-01",
  "workstreamId": "RESOURCE-IDS",
  "title": "用户指定 Profile ID 集合到统一实例绑定与共享可见性",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "resource-id-assignment",
  "journeyId": "LDCP-R01-R03-resource-ids",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/scripts/local-dev/machine-dev-registry.mjs",
    "tooling/scripts/local-dev/machine-dev.mjs",
    "tooling/scripts/local-dev/machine-dev-lease.py",
    "tooling/scripts/local-dev/machine-dev-resource-contract.mjs",
    "tooling/scripts/local-dev/machine-dev-resource-store.mjs",
    "tooling/scripts/local-dev/machine-dev-ios-provider.mjs",
    "tooling/scripts/local-dev/machine-dev-resources.test.mjs",
    "tooling/scripts/lib/machine-dev-paths.mjs",
    "tooling/scripts/lib/machine-dev-paths.test.mjs",
    "docs/architecture/engineering/local-dev",
    "docs/architecture/engineering/architecture-governance/architecture-modules.json"
  ],
  "readSet": ["tooling/acceptance/environments", "docs/global/local-dev-environment.md", "docs/knowledge"],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 300, "cleanupSeconds": 60},
  "checks": [
    {"id": "res01-source", "command": "node --test tooling/scripts/lib/machine-dev-paths.test.mjs tooling/scripts/local-dev/machine-dev-resources.test.mjs", "verificationClass": "SOURCE_CHECK"},
    {"id": "res01-ids", "command": "node --test --test-name-pattern=ResourceIdAssignmentJourney tooling/scripts/local-dev/machine-dev-resources.test.mjs", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "原 Profile parser 唯一投影 requirements；machine assignment 唯一记录用户的 Profile-to-ID 集合，reverse references 派生",
    "用户可选择数量、已有/共享 ID 或显式新建 ID，内部标签自由安排，无默认上限或固定角色",
    "相同 ID 同一实例并显示共享方/content/holder；相同数量不推导共享或覆盖权限",
    "provider UUID 锁与 slot 分离，alias/provider collision 不绕锁；创建前持久化 ID/nonce/intent",
    "字段编码、projection 与新增路径在原模块登记；逻辑 Journey 证明输入/ID/sharing/partial lock failure"
  ],
  "failureBehavior": [
    "无明确资源选择不隐式分配/替换，unknown/provider identity/source 冲突 fail closed",
    "compatibility 失败不偷换设备；fake provider 只证明逻辑",
    "不分配 four 或操作历史设备"
  ],
  "updatedAt": "2026-11-15T00:00:00.000Z"
}
```

解锁 RES-02。新文件是待交付的内部模块；数量只是输入/显示，身份与排他由
ID/provider 事实判断。
