# DLA-05：Mobile 原生 login_approval 能力

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DLA-20261112",
  "taskId": "DLA-05",
  "workstreamId": "MOBILE-NATIVE",
  "title": "移动 runtime 双角色：claimant 持票流程与 approver 密封签名",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "dla-mobile-native",
  "journeyId": "DLA-J05",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile/src-tauri/src/runtime/login_approval",
    "apps/mobile/src-tauri/src/commands",
    "packages/device-link-core"
  ],
  "readSet": [
    "apps/mobile/src-tauri/src/runtime/device_link",
    "apps/mobile/src-tauri/src/runtime/oauth",
    "apps/mobile/src-tauri/src/platform/push_bridge.rs",
    "docs/knowledge"
  ],
  "budgets": {"focusedCheckSeconds": 600, "functionalRunSeconds": 900, "cleanupSeconds": 60},
  "checks": [
    {"id": "dla05-source", "command": "cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml --lib runtime::login_approval --locked", "verificationClass": "SOURCE_CHECK"},
    {"id": "dla05-journey", "command": "cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml --lib runtime::login_approval::journeys --locked", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "intake/delivery/actions/protocol/projection 模块落地，claimant 持票、ack 与终态恢复有 native 测试",
    "approver 侧密封/签名能力落地（移动此前只有 claimant 实现），与桌面共用 device-link-core 原语",
    "Session 与 Messaging 继续共享同一 device_id，enrollment 与凭据接纳走既有 oauth link_session owner",
    "前后台切换时相机/轮询/临时密钥受生命周期 fence，迟到结果不污染新 admission"
  ],
  "failureBehavior": [
    "安全存储失败、root 不匹配、approver 撤销均返回类型化错误且不留半安装凭据",
    "无 bearer 请求只能在自己事务 scope 内活动，不能枚举或操作其他 claim",
    "COMMITTED 后仍走普通 Access 重验证与 PIN/Shell，不替代生命周期"
  ],
  "updatedAt": "2026-11-12T01:00:00.000Z"
}
```
