# MSL-05：设备与 Session 原子交付

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MSL-20261027",
  "taskId": "MSL-05",
  "workstreamId": "COMMIT",
  "title": "受限 enrollment、当前 Access 和 inactive credential ack",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "msl-commit",
  "journeyId": "MSL-A04",
  "runtimeClass": "service",
  "writeSet": ["apps/station/app/subserver/device_link", "apps/station/app/subserver/actor_identity", "apps/station/frame/touch/auth", "apps/station/frame/touch/accessgate", "apps/station/app/subserver/oauth", "packages/device-link-core", "tooling/acceptance"],
  "readSet": ["docs/architecture/domains/identity/mobile-scan-login", "docs/knowledge"],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 600, "cleanupSeconds": 60},
  "checks": [
    {"id": "msl05-source", "command": "go -C apps/station/app test ./subserver/device_link/... ./subserver/actor_identity/... -timeout=180s", "verificationClass": "SOURCE_CHECK"},
    {"id": "msl05-service", "command": "python3 tooling/acceptance/gates/device_link/commit_journey.py", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["Actor offer Access device Session 统一锁序，策略 profile approver 从同一事务校验", "手机证书 pending，ack 前设备与 Session 均不活跃", "ack 丢失幂等读回，凭据安全存储失败不 ack，旧身份不得覆盖"],
  "failureBehavior": ["事务内不打开第二条 DB 连接", "不绕过 Access 或冒用 OAuth candidate"],
  "updatedAt": "2026-10-27T01:00:00.000Z"
}
```
