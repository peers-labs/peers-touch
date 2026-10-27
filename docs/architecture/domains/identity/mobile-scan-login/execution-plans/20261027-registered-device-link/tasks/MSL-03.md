# MSL-03：有限网络引导

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MSL-20261027",
  "taskId": "MSL-03",
  "workstreamId": "BOOTSTRAP",
  "title": "私有 grant 兑换前取回可信 sealed bootstrap",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "msl-bootstrap",
  "journeyId": "MSL-A02",
  "runtimeClass": "service",
  "writeSet": ["apps/station/frame/core/plugin/native/relay", "apps/station/frame/core/plugin/native/federation", "model/domain/peer", "packages/station-trust", "apps/desktop/src-tauri", "apps/mobile/src-tauri", "docs/architecture/platform/runtime/node-connectivity"],
  "readSet": ["docs/architecture/domains/identity/mobile-scan-login", "docs/knowledge"],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 600, "cleanupSeconds": 60},
  "checks": [
    {"id": "msl03-source", "command": "go -C apps/station/frame test ./core/plugin/native/relay/... -timeout=180s", "verificationClass": "SOURCE_CHECK"},
    {"id": "msl03-service", "command": "python3 tooling/acceptance/gates/device_link/bootstrap_journey.py", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["Station 和 Relay bootstrap 各自按 endpoint 身份校验且不重定向", "Node 上传 proof、16KiB、TTL、源名额和清理生效", "新设备获得 fresh 限用途材料，旧 Desktop grant 不导出"],
  "failureBehavior": ["Relay 不获得 Actor 或登录 API", "无可达引导不得生成伪可用码"],
  "updatedAt": "2026-10-27T01:00:00.000Z"
}
```
