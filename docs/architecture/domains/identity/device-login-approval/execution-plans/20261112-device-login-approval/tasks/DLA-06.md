# DLA-06：Mobile 等待卡、审批弹窗与接入 AccessGateHost

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DLA-20261112",
  "taskId": "DLA-06",
  "workstreamId": "MOBILE-SURFACE",
  "title": "claimant 等待卡、approver 审批弹窗、推送桥接占位与 i18n",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "dla-mobile-surface",
  "journeyId": "DLA-J06",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/mobile/src/runtimes",
    "apps/mobile/src/features/auth",
    "apps/mobile/src/App.tsx",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/mobile/src/features/auth/AccessGateHost.tsx",
    "apps/mobile/src/features/auth/DeviceLinkScreen.tsx",
    "docs/client",
    "docs/knowledge"
  ],
  "budgets": {"focusedCheckSeconds": 600, "functionalRunSeconds": 1800, "cleanupSeconds": 120},
  "checks": [
    {"id": "dla06-source", "command": "pnpm mobile:check", "verificationClass": "SOURCE_CHECK"},
    {"id": "dla06-contract", "command": "pnpm --dir apps/mobile exec vitest run src/runtimes/loginApprovalRuntime.test.ts src/features/auth", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "dla06-journey", "command": "python3 tooling/acceptance/gates/device_login_approval/mobile_surface_journey.py", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "AccessGateHost 新增 waiting 分支：核对码、等待说明、取消与折叠兜底入口",
    "approver 弹窗展示设备名、核对码与允许/拒绝，前台由 runtime 投影驱动，后台经 push_bridge 本地告警占位",
    "扫码入口降级为 station-selection 的次要操作，登录主路径为凭据申请 + 等待审批",
    "全部文案走 i18n locale 键，等待/拒绝/过期/撤销原因有明确本地化反馈"
  ],
  "failureBehavior": [
    "应用杀进程时不承诺实时送达（DLA-D08），回前台单 flight 读取补偿",
    "弹窗不得在 chat 路由内挂载，不得遮挡 Access/PIN 生命周期页面",
    "兜底入口未展开时不预渲染恢复短语输入"
  ],
  "updatedAt": "2026-11-12T01:00:00.000Z"
}
```
