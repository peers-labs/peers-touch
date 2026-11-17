# RES-04：Acceptance 的 ID 选择、共享与收尾

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "LDCP-RES-20261114",
  "taskId": "RES-04",
  "workstreamId": "ACCEPTANCE-IDS",
  "title": "全部 iOS Provisioner 消费显式 ID、共享内容与 owned cleanup",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "acceptance-id-sharing",
  "journeyId": "LDCP-R02-R05-R07-acceptance",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "tooling/acceptance/provisioners/mobile_simulator.py",
    "tooling/acceptance/core/provisioner.py",
    "tooling/acceptance/tests/test_mobile_simulator_provisioner.py",
    "tooling/acceptance/environments",
    "tooling/acceptance/gates/mobile/resource_dependencies_functional.py",
    "docs/knowledge/pitfalls/ios-simulator-uninstall-retains-keychain.md",
    "docs/knowledge/invariants/profile-resources-use-machine-owner.md",
    "docs/architecture/engineering/local-dev"
  ],
  "readSet": ["tooling/scripts/local-dev", "tooling/acceptance/runtime", "tooling/acceptance/fixtures", "docs/architecture/engineering/acceptance", "docs/knowledge"],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 2400, "cleanupSeconds": 120},
  "checks": [
    {"id": "res04-source", "command": "python3 -m unittest tooling.acceptance.tests.test_mobile_simulator_provisioner", "verificationClass": "SOURCE_CHECK"},
    {"id": "res04-native", "command": "python3 tooling/acceptance/gates/mobile/resource_dependencies_functional.py --scenario acceptance-id-sharing", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "base/selected/layout 全消费显式 ID，角色由 Profile 自由安排，iOS direct create/select/cleanup 完整删除",
    "共享 Suite 看到实际 contents/references，不假定不同 Profile 是隔离副本",
    "冲突 source/credential/keychain/database 变更遵循明确 overwrite decision，原 data owner 读回实际影响",
    "普通 contract/cleanup 单测、独立 provider/data oracle、native Journey 通过后才删除旧隔离机制",
    "generic cleanup 只释放 owned session/引用，别人内容/设备保留，失败不丢 machine retry record",
    "原 Keychain pitfall/测试与当前 ID/notice/data 规则同步，Fixture/Harness/Evidence Store owner 保留"
  ],
  "failureBehavior": [
    "不按数量自动派生 per-run devices，不给真实用户资源伪造测试 force",
    "未知/用户持有资源未获具体操作许可不覆盖，shared data effects 明示",
    "iOS proof 不推导 Android PASS，不改 Station"
  ],
  "updatedAt": "2026-11-15T00:00:00.000Z"
}
```

解锁 RES-05。Acceptance infra owner 审查狭窄 cleanup 改动；新报告不能替代
独立 provider/credential oracle。
