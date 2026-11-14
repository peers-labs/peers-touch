# DLA-01：协议与 Station 事务核心

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DLA-20261112",
  "taskId": "DLA-01",
  "workstreamId": "STATION-CORE",
  "title": "login_approval proto、事务状态机、持久化与持票面",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "dla-protocol",
  "journeyId": "DLA-J01",
  "runtimeClass": "service",
  "writeSet": [
    "model/domain/auth/login_approval.proto",
    "model/domain/access_gate/access_gate.proto",
    "apps/station/app/subserver/login_approval",
    "docs/architecture/domains/identity/device-login-approval"
  ],
  "readSet": [
    "apps/station/app/subserver/device_link",
    "packages/device-link-core",
    "apps/station/frame/core/facility/session",
    "docs/knowledge"
  ],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 600, "cleanupSeconds": 60},
  "checks": [
    {"id": "dla01-source", "command": "go -C apps/station/app test ./subserver/login_approval/... -timeout=180s", "verificationClass": "SOURCE_CHECK"},
    {"id": "dla01-journey", "command": "go -C apps/station/app test ./subserver/login_approval/... -run TestLoginApprovalJourney -timeout=180s", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "login_approval.proto 与 access_gate 新 gate 类型经 model/build.sh 生成且无手工模型",
    "事务表、capability 哈希表与 audit 表迁移落地，PENDING 到 COMMITTED/终态的 CAS 状态机有 Go 测试",
    "无会话 create/status/cancel 与认证 list/approve/deny 两面服务可用，TTL 回收、pending 上限与幂等有测试"
  ],
  "failureBehavior": [
    "无有效 credential-passed attempt 的 create 必须拒绝",
    "capability 错误访问、revision 冲突、并发批准只产生一个 COMMITTED 必须 fail-closed",
    "Station 不持有 seed 明文与 claimant capability 明文"
  ],
  "updatedAt": "2026-11-12T01:00:00.000Z"
}
```
