# CAV-01：授权文件访问与 Native 副本操作

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CAV-20261024",
  "taskId": "CAV-01",
  "workstreamId": "NATIVE-ACCESS",
  "title": "双端从当前 Engine 访问 verified 文件并原生打开导出隔离副本",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "chat-attachment-native-access",
  "journeyId": "CHAT-J03",
  "runtimeClass": "source-only",
  "writeSet": ["model/domain/chat/attachment.proto", "packages/secure-content-core", "packages/messaging-core", "packages/messaging-native-filesystem", "apps/desktop/src-tauri", "apps/mobile/src-tauri"],
  "readSet": ["docs/architecture/domains/chat/lifecycle", "docs/architecture/domains/chat/messaging", "docs/client/mobile/native-plugin-layer.md", "docs/knowledge"],
  "budgets": {"focusedCheckSeconds": 600, "functionalRunSeconds": 900, "cleanupSeconds": 120},
  "checks": [
    {"id": "verified-file-core", "command": "cargo test --manifest-path packages/secure-content-core/Cargo.toml file_access --offline", "verificationClass": "SOURCE_CHECK"},
    {"id": "native-access-check", "command": "cargo check --manifest-path apps/mobile/src-tauri/Cargo.toml --offline", "verificationClass": "SOURCE_CHECK"}
  ],
  "doneWhen": [
    "双方均能访问自己有权限的 attachment，缺失缓存按现有 checkpoint 下载",
    "访问返回 protobuf 定义的 metadata、opaque handle、asset URL 与 transfer 状态",
    "取消重试保留 attachment identity，terminal 与 retry wait 状态明确",
    "系统打开及导出使用 verified 副本，文件名扩展名保持，外部修改不影响 cache",
    "iOS Quick Look/export 与 Android FileProvider/SAF 在既有插件中实现"
  ],
  "failureBehavior": ["权限或 hash 不匹配 fail closed", "picker 取消与失败分开", "未知平台返回 unavailable"],
  "updatedAt": "2026-10-24T00:00:00.000Z"
}
```
