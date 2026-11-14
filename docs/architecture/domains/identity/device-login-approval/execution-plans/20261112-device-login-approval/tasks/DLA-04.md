# DLA-04：Desktop 登录等待卡、Shell 审批弹窗与恢复门禁移除

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DLA-20261112",
  "taskId": "DLA-04",
  "workstreamId": "DESKTOP-SURFACE",
  "title": "claimant 等待面、Shell 全局审批弹窗、通知与 chat 恢复硬门禁删除",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "dla-desktop-surface",
  "journeyId": "DLA-J04",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src/runtimes",
    "apps/desktop/src/store",
    "apps/desktop/src/components/shell",
    "apps/desktop/src/pages/login",
    "apps/desktop/src/components/chat",
    "apps/desktop/src/acceptance",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop/src/kernel",
    "apps/desktop/src/components/settings",
    "docs/client/common/ui-identity",
    "docs/knowledge"
  ],
  "budgets": {"focusedCheckSeconds": 600, "functionalRunSeconds": 1800, "cleanupSeconds": 120},
  "checks": [
    {"id": "dla04-source", "command": "pnpm --dir apps/desktop run check", "verificationClass": "SOURCE_CHECK"},
    {"id": "dla04-contract", "command": "pnpm --dir apps/desktop run test -- loginApproval messagingRecovery authSurfaceAlignment", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "dla04-journey", "command": "python3 tooling/acceptance/gates/device_login_approval/desktop_surface_journey.py", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "LoginPage 新增 waiting stage 并经 identityLifecycle 闭合，等待卡含核对码、取消与折叠兜底入口",
    "Shell 全局 LoginApprovalDialogHost 由 runtime 单 flight 投影驱动，前台弹窗、后台本地通知，chat 与设置主路径无审批 UI",
    "MessagingRecoveryGate 从 chat 路由删除，短语输入只存在于登录兜底面与 Settings，i18n 无硬编码文案与死键",
    "兜底直登进入受限模式时消息区为非阻断内联恢复入口，可跳过并保留数据"
  ],
  "failureBehavior": [
    "deny/cancel/expired/approver-revoked 在等待卡显示类型化原因并可重新发起",
    "组件 mount 内禁止轮询；后台不轮询，回前台立即单 flight 读取",
    "审批登录后若仍 recovery_required 按缺陷上报，不在 chat 重建门禁"
  ],
  "updatedAt": "2026-11-12T01:00:00.000Z"
}
```
