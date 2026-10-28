# MSL-07：Mobile 原生扫码与登录

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MSL-20261027",
  "taskId": "MSL-07",
  "workstreamId": "MOBILE",
  "title": "原生相机扫码、同 Station 验证和普通 PIN Shell 生命周期",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "msl-mobile",
  "journeyId": "MSL-A01",
  "runtimeClass": "native-mobile",
  "writeSet": ["apps/mobile", "packages/device-link-core", "packages/locales", "packages/prototypes", "tooling/acceptance/gates/device_link", "docs/architecture/domains/identity/mobile-scan-login"],
  "readSet": ["packages/schema-core", "packages/station-trust", "docs/knowledge"],
  "budgets": {"focusedCheckSeconds": 600, "functionalRunSeconds": 1200, "cleanupSeconds": 120},
  "checks": [
    {"id": "msl07-source", "command": "pnpm --dir apps/mobile run check", "verificationClass": "SOURCE_CHECK"},
    {"id": "msl07-native", "command": "python3 tooling/acceptance/gates/device_link/mobile_journey.py", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["Android iOS 成熟 decoder 接入独立 native camera adapter", "首次解码暂停，后台释放相机，恢复重新握手查询", "同 root、seed fingerprint、设备 PoP、安全存储和 ack 后正常进入 Shell"],
  "failureBehavior": ["输入字符串或网页预览不作为相机证据", "无硬件或权限明确保留对应格 UNPROVEN"],
  "updatedAt": "2026-10-27T01:00:00.000Z"
}
```
