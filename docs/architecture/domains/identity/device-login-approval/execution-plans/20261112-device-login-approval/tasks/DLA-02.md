# DLA-02：Access Gate 设备审批要求与 HTTP 两面接线

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DLA-20261112",
  "taskId": "DLA-02",
  "workstreamId": "STATION-ACCESS",
  "title": "DEVICE_APPROVAL_REQUIRED 求值、首设备旁路、限流与 subserver 注册",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "dla-access",
  "journeyId": "DLA-J02",
  "runtimeClass": "service",
  "writeSet": [
    "apps/station/frame/touch/accessgate",
    "apps/station/app/subserver/login_approval",
    "apps/station/app/main.go",
    "model/domain/access_gate/access_gate.proto"
  ],
  "readSet": [
    "apps/station/frame/core/facility/session",
    "apps/station/app/subserver/actor_identity",
    "docs/architecture/platform/station/access"
  ],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 600, "cleanupSeconds": 60},
  "checks": [
    {"id": "dla02-source", "command": "go -C apps/station/app test ./frame/touch/accessgate/... ./subserver/login_approval/... -timeout=180s", "verificationClass": "SOURCE_CHECK"},
    {"id": "dla02-journey", "command": "go -C apps/station/app test ./subserver/login_approval/... -run TestAccessDeviceApprovalJourney -timeout=180s", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "凭据通过且设备未登记、Actor 已有 enrolled 设备时输出 DEVICE_APPROVAL_REQUIRED 并创建事务",
    "首设备（无 enrolled 设备）不触发审批，直接走既有 GRANTED 路径",
    "审批后 Access 重裁通过才允许 Session 激活；策略开关默认关闭时行为与现状一致",
    "无会话面限流生效且不返回账号设备清单，subserver 在组合根注册一次，Relay role 不加载"
  ],
  "failureBehavior": [
    "approver 会话在批准前失效时事务归 DENIED/APPROVER_REVOKED 且不交付材料",
    "审批不得绕过当前 policy、maintenance、terms 等既有 gate",
    "设备数量上限走显式 DEVICE_LIMIT，禁止按 device_type 隐式踢人"
  ],
  "updatedAt": "2026-11-12T01:00:00.000Z"
}
```