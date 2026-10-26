# MSL-06：Desktop 设备授权面板

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MSL-20261027",
  "taskId": "MSL-06",
  "workstreamId": "DESKTOP",
  "title": "全局 Settings 入口、窗口 scope 授权与添加另一设备",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "msl-desktop",
  "journeyId": "MSL-A05",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/desktop", "packages/device-link-core", "packages/locales", "packages/prototypes", "docs/architecture/domains/identity/mobile-scan-login", "tooling/acceptance/gates/device_link"],
  "readSet": ["docs/client/desktop", "docs/knowledge", "packages/schema"],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 900, "cleanupSeconds": 60},
  "checks": [
    {"id": "msl06-source", "command": "pnpm --dir apps/desktop run check", "verificationClass": "SOURCE_CHECK"},
    {"id": "msl06-native", "command": "python3 tooling/acceptance/gates/device_link/desktop_journey.py", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["runtime 拥有临时密钥轮询，UI 只投影", "离开锁定换账号撤销审批能力", "码可见、核对选择、失败恢复与添加另一设备符合体验合同"],
  "failureBehavior": ["禁止 renderer 保存 seed token scan capability", "不承诺恢复全部历史"],
  "updatedAt": "2026-10-27T01:00:00.000Z"
}
```
