# WE-S7：受控部署 exact-source 沙盒 Native Journey + compose 集成

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "WE-20261104",
  "taskId": "WE-S7",
  "workstreamId": "WE-VERIFY",
  "title": "compose 集成 provisioner+egress；沙盒 fail→fix→retest、越界 OS 拒绝、不回落、重建持久 native journey",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "we-j07-workspace-sandbox",
  "closureId": "we-s7-sandbox-native-journey",
  "runtimeClass": "service",
  "writeSet": ["tooling/docker", "apps/desktop/e2e", "tooling/acceptance/reports"],
  "readSet": ["docs/architecture/domains/agent/workspace-execution"],
  "budgets": { "focusedCheckSeconds": 3000, "functionalRunSeconds": 3600, "cleanupSeconds": 900 },
  "checks": [
    { "id": "we-s7-station", "command": "cd apps/station && gofmt -l . && go test ./app/subserver/agent/...", "verificationClass": "SOURCE_CHECK" },
    { "id": "we-s7-provisioner", "command": "cd apps/workspace-sandbox-provisioner && go test ./...", "verificationClass": "SOURCE_CHECK" },
    { "id": "we-s7-native", "command": "cd apps/desktop && PT_PLAYWRIGHT_SOCKET=/tmp/tw-d1.sock PT_STATION_URL=http://127.0.0.1:18092 pnpm exec playwright test --config e2e/playwright.config.ts e2e/tests/we-sandbox-journey.spec.ts --project=performance --workers=1", "verificationClass": "FUNCTIONAL_CHECK" }
  ],
  "doneWhen": [
    "受控 compose profile 一键起 station(无sock)+provisioner(独占sock)+egress proxy+隔离网络；Probe 返回 oci_linux 可用",
    "exact-source native journey：绑定 workspace.sandbox capability 的 agent 在沙盒内 write→grep(exit1)→edit(diff -fail/+ok)→grep(exit0)，回执/digest/artifact check 与 D4 同构",
    "越界 journey：沙盒内写 / 与只读 rootfs 被拒（真实 errno/非零退出）；访问 Station Postgres:端口超时拒绝；跨沙盒互访拒绝",
    "不回落 journey：令 provisioner Probe=false / binding 未 READY，WORKSPACE_SANDBOX turn fail-closed，Station/审计无 desktop 执行记录",
    "持久 journey：DORMANT→冷启动后 /workspace 文件仍在；容器重建 pid 变化，Terminal 先 UNKNOWN 后以 live proof 恢复并可 cursor 回看",
    "证据绑定当前 commit（json+必要截图）落 tooling/acceptance/reports，隔离事实来自真实容器而非 mock"
  ],
  "failureBehavior": [
    "不在生产/共享环境跑破坏性隔离测试，使用一次性受控 cell 与独立网络",
    "不放宽 egress/rootfs 以让测试通过",
    "Browser 跨域验证合同不在本切片（仅上报沙盒服务 URL）"
  ],
  "updatedAt": "2026-11-04T00:00:00.000Z"
}
```

## 完整闭环

在与生产拓扑同构的受控部署上，用当前源码证明 Station 沙盒模式端到端可用且边界真实：能干活、失败如实、越界被 OS/网络挡住、绝不回落本机、工作区跨重建持久、终端状态诚实。
