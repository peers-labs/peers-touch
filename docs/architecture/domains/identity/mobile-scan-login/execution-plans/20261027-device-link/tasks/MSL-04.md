# MSL-04：设备邀请与签名授权

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MSL-20261027",
  "taskId": "MSL-04",
  "workstreamId": "AUTHORIZATION",
  "title": "有限 claim、SAS 与可恢复的选定设备审批",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "msl-authorization",
  "journeyId": "MSL-A03",
  "runtimeClass": "service",
  "writeSet": ["model/domain/auth/device_link.proto", "apps/station/app/subserver/device_link", "apps/station/app/main.go", "apps/station/frame/touch/model", "packages/device-link-core", "docs/architecture/domains/identity/mobile-scan-login", "docs/architecture/engineering/api-governance", "tooling/acceptance"],
  "readSet": ["apps/station/app/subserver/actor_identity", "apps/station/frame/touch/auth", "docs/knowledge"],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 600, "cleanupSeconds": 60},
  "checks": [
    {"id": "msl04-source", "command": "go -C apps/station/app test ./subserver/device_link/... -timeout=180s", "verificationClass": "SOURCE_CHECK"},
    {"id": "msl04-service", "command": "python3 tooling/acceptance/gates/device_link/authorization_journey.py", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["Station 从认证 Desktop 推导 Actor 和 root", "PoP claim 与审批 CAS 绑定完整 transcript、注册设备签名和同屏核对码", "重启幂等、终态不复活，取消过期清理临时密文"],
  "failureBehavior": ["HPKE Base 不替代来源认证", "未选定 claim 无法取身份密文或枚举其他 claim"],
  "updatedAt": "2026-10-27T01:00:00.000Z"
}
```
