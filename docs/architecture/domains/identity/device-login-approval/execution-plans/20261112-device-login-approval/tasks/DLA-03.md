# DLA-03：Desktop 原生 login_approval 能力

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DLA-20261112",
  "taskId": "DLA-03",
  "workstreamId": "DESKTOP-NATIVE",
  "title": "claimant 持票安全存储、approver HPKE 密封签名与 Tauri 命令",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "dla-desktop-native",
  "journeyId": "DLA-J03",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src-tauri/src/application/login_approval",
    "apps/desktop/src-tauri/src/interface/tauri_commands/login_approval.rs",
    "apps/desktop/src-tauri/src/main.rs",
    "packages/device-link-core"
  ],
  "readSet": [
    "apps/desktop/src-tauri/src/application/device_link",
    "apps/desktop/src-tauri/src/application/account",
    "docs/knowledge"
  ],
  "budgets": {"focusedCheckSeconds": 600, "functionalRunSeconds": 900, "cleanupSeconds": 60},
  "checks": [
    {"id": "dla03-source", "command": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib application::login_approval --locked", "verificationClass": "SOURCE_CHECK"},
    {"id": "dla03-journey", "command": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib application::login_approval::journeys --locked", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "claimant capability 只存安全存储且 Tauri 命令只发布去秘密投影",
    "approver 经 device-link-core 完成 transcript 构造、HPKE 密封与设备 PoP 签名，无第二套密码学",
    "sessionEpoch/登出/换站时 fence 本地持票与临时密钥，迟到结果不复活等待态",
    "macOS 用户通知调度具备 native 单测，权限缺失时显式降级不阻断弹窗"
  ],
  "failureBehavior": [
    "安全存储读写失败返回类型化错误且不安装半成品凭据",
    "approver 不得指定其他 Actor 或修改 claimant 公钥",
    "renderer 永远拿不到 capability 明文、HPKE 私钥与 seed"
  ],
  "updatedAt": "2026-11-12T01:00:00.000Z"
}
```
