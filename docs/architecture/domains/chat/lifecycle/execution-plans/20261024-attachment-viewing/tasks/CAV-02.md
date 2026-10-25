# CAV-02：文件卡片、详情与共享访问状态

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CAV-20261024",
  "taskId": "CAV-02",
  "workstreamId": "FILE-EXPERIENCE",
  "title": "双端点击立即进入可恢复文件详情与预览",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "chat-attachment-file-experience",
  "journeyId": "CHAT-J03",
  "runtimeClass": "native-desktop",
  "writeSet": ["packages/client-chat-core", "packages/locales", "pnpm-lock.yaml", "apps/desktop/src", "apps/mobile/src", "packages/prototypes/desktop/features/social-chat", "packages/prototypes/mobile/chat", "docs/client"],
  "readSet": ["model/domain/chat/attachment.proto", "docs/architecture/domains/chat/lifecycle/attachment-viewing.md", "docs/knowledge"],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 900, "cleanupSeconds": 120},
  "checks": [
    {"id": "shared-access-check", "command": "pnpm --filter @peers-touch/client-chat-core test", "verificationClass": "SOURCE_CHECK"},
    {"id": "mobile-presentation-check", "command": "pnpm --dir apps/mobile run check:web", "verificationClass": "SOURCE_CHECK"},
    {"id": "desktop-presentation-check", "command": "pnpm --dir apps/desktop run check", "verificationClass": "SOURCE_CHECK"},
    {"id": "file-viewing-journey", "command": "make desktop", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "文件卡片展示原始文件名、类型、大小和真实状态",
    "点击先打开详情，再下载；进度、取消、重试可操作",
    "Messaging Runtime owns pending access，事件与 reconcile 更新同一状态",
    "图片音视频 PDF 和 bounded text 可预览，Office 和 archive 有原生操作",
    "关闭详情或 scope change 不发生迟到外部打开；旧 window.open 文件路径归零"
  ],
  "failureBehavior": ["preview unsupported 保持详情和操作", "不从组件创建独立传输 owner", "所有文案 i18n"],
  "updatedAt": "2026-10-24T00:00:00.000Z"
}
```
