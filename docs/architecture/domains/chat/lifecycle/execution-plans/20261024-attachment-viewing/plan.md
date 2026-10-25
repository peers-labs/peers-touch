# 双端聊天文件查看实施计划

> **Plan ID**: CAV-20261024
> **Version ID**: 20261024-attachment-viewing-scoped-preview
> **Created**: 2026-10-24T00:00:00.000Z
> **Owner**: Chat Product Team

用户已确认文件查看方案与实施。目标是发送端和接收端均能识别文件、查看下载进度、
预览支持格式，并明确打开或保存副本。保持 E2EE 与现有 Messaging ownership。
Native 文件系统适配复用现有 `messaging-native-filesystem`，其输入来自 Engine
授权的 verified cache。本计划不代表验收通过。效果依据见
[outcome-comparison.md](./outcome-comparison.md)。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "CAV-20261024",
  "versionId": "20261024-attachment-viewing-scoped-preview",
  "createdAt": "2026-10-24T00:00:00.000Z",
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/domains/chat/lifecycle/attachment-viewing.md",
      "docs/architecture/domains/chat/lifecycle/experience-contract.md",
      "docs/client/desktop/runtime-projections.md",
      "docs/client/mobile/native-plugin-layer.md",
      "docs/architecture/platform/client/cross-client-runtime/design.md"
    ],
    "decisions": ["MP-D16", "CCU-D06", "CCR-D01", "CCR-D13"]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "model/domain/chat/attachment.proto", "mode": "exclusive-write"},
      {"pathPrefix": "apps/station/frame/touch/model/chat/attachment.pb.go", "mode": "exclusive-write"},
      {"pathPrefix": "pnpm-lock.yaml", "mode": "exclusive-write"},
      {"pathPrefix": "packages/secure-content-core", "mode": "exclusive-write"},
      {"pathPrefix": "packages/messaging-core", "mode": "exclusive-write"},
      {"pathPrefix": "packages/messaging-native-filesystem", "mode": "exclusive-write"},
      {"pathPrefix": "packages/client-chat-core", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop", "mode": "exclusive-write"},
      {"pathPrefix": "apps/mobile", "mode": "exclusive-write"},
      {"pathPrefix": "packages/locales", "mode": "exclusive-write"},
      {"pathPrefix": "packages/prototypes/desktop/features/social-chat", "mode": "exclusive-write"},
      {"pathPrefix": "packages/prototypes/mobile/chat", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/architecture-governance/architecture-modules.json", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/domains/chat/lifecycle", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/domains/chat/messaging", "mode": "shared-read"},
      {"pathPrefix": "docs/architecture/platform/client/cross-client-runtime", "mode": "shared-read"},
      {"pathPrefix": "docs/architecture/shared/security/secure-content", "mode": "exclusive-write"},
      {"pathPrefix": "docs/knowledge", "mode": "shared-read"},
      {"pathPrefix": "docs/client", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance", "mode": "exclusive-write"}
    ],
    "nonGoals": [
      "Station 明文文件接口或加密协议改变",
      "新增平行 Mobile 产品或独立传输后台",
      "远程生产部署、打包发布、push、PR、merge、历史改写",
      "修改 env 仓库或创建切换 worktree"
    ]
  },
  "tasks": [
    {"id": "CAV-01", "workstreamId": "NATIVE-ACCESS", "path": "tasks/CAV-01.md", "dependsOn": []},
    {"id": "CAV-02", "workstreamId": "FILE-EXPERIENCE", "path": "tasks/CAV-02.md", "dependsOn": ["CAV-01"]},
    {"id": "CAV-03", "workstreamId": "PRODUCT-PROOF", "path": "tasks/CAV-03.md", "dependsOn": ["CAV-02"]}
  ],
  "outcomeComparison": {"path": "outcome-comparison.md"},
  "authorization": {
    "checkpoint": {"localCommit": "allowed", "amend": "denied"},
    "delivery": {"push": "denied", "pullRequest": "denied"},
    "runtime": {"deployProfiles": [], "destructiveResetScopes": []},
    "history": {"rewrite": "denied"}
  }
}
```

## 实施闭环

1. CAV-01 提供当前 Engine 下的 verified access、transfer readback、取消重试和
   Native 预览/打开/导出，副本保留文件名和扩展名。
2. CAV-02 将双端点击入口完整切换到文件详情，Runtime 拥有 pending 状态和同步，
   移除浏览器打开路径；复用 PDF.js 的按需 worker 和单页 bounded canvas，
   同步既有原型；关闭界面和切换 scope 后不得触发迟到的外部打开。
3. CAV-03 使用当前源码完成双向真实文件 Journey、回归契约与资源清理；缺失的
   OS 运行证据保持 UNPROVEN，不扩大已有 iOS 或同 Station 结论。

每次检查与运行均有预算。耗时超限先定位 owner，不自动增加预算。

## Acceptance Execution

```json
{
  "closures": {
    "chat-attachment-native-access": [],
    "chat-attachment-file-experience": [],
    "chat-attachment-viewing-proof": ["chat-lifecycle-rich-voice-e2e"]
  },
  "completion": ["chat-lifecycle-rich-voice-e2e"],
  "full": []
}
```
