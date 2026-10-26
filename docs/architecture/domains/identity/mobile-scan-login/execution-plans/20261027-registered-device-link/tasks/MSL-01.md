# MSL-01：多设备 Session 真源

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MSL-20261027",
  "taskId": "MSL-01",
  "workstreamId": "SESSION",
  "title": "同 Station Actor device 唯一会话与其他设备共存",
  "workClass": "refactor",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "msl-session",
  "journeyId": "MSL-A09",
  "runtimeClass": "source-only",
  "writeSet": ["apps/station/frame/core/facility/session", "apps/station/frame/touch/auth", "apps/station/frame/touch/accessgate", "apps/station/app/subserver/oauth", "tooling/acceptance", "tooling/scripts/node-connectivity-journey.py", "docs/architecture/platform/station/access", "docs/station/api-documentation.md"],
  "readSet": ["docs/architecture/domains/identity/mobile-scan-login", "docs/knowledge"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 180, "cleanupSeconds": 30},
  "checks": [
    {"id": "msl01-source", "command": "go -C apps/station/frame test ./core/facility/session ./touch/accessgate ./touch/auth -count=1 -timeout=90s", "verificationClass": "SOURCE_CHECK"},
    {"id": "msl01-suite-contract", "command": "python3 -m unittest tooling.acceptance.gates.station_access.session_class_suite_e2e_test", "verificationClass": "SOURCE_CHECK"}
  ],
  "doneWhen": ["所有发行入口使用同一个 device 替换合同", "旧 class 索引删除，存量可信绑定保留，无绑定强制重登", "两个 Mobile 加 Desktop 的源码回归通过且 native Suite 预置五个独立客户端"],
  "failureBehavior": ["不能从 User-Agent 猜 device", "源码回归不证明原生共存"],
  "updatedAt": "2026-10-27T01:00:00.000Z"
}
```
