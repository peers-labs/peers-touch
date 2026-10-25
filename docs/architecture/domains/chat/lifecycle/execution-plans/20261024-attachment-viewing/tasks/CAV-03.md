# CAV-03：文件查看产品验证

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CAV-20261024",
  "taskId": "CAV-03",
  "workstreamId": "PRODUCT-PROOF",
  "title": "验证双方文件使用结果与恢复和 Native 副本隔离",
  "workClass": "product-behavior",
  "completionClass": "acceptance-aggregate",
  "executionMode": "build",
  "closureId": "chat-attachment-viewing-proof",
  "journeyId": "CCU-J04",
  "runtimeClass": "source-only",
  "writeSet": ["tooling/acceptance", "docs/architecture/domains/chat/lifecycle"],
  "readSet": ["apps/desktop", "apps/mobile", "packages/client-chat-core", "packages/secure-content-core", "docs/knowledge"],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 1800, "cleanupSeconds": 180},
  "checks": [
    {"id": "file-change-structure", "command": "git diff --check", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "rich-file-regression", "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-rich-voice-e2e", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": [
    "当前源码双向 Native Journey 证明 sender 和 receiver 文件名、打开及 byte identity",
    "下载中断、取消重试、关闭详情与账号切换具有回归证据",
    "原生预览、保存目的地与外部修改副本独立于 cache 的结果逐平台记录",
    "仅用户保存的副本留存，本任务持有 runtime、staging 与证据有明确 disposition",
    "实际 Outcome 状态按 current source/evidence 更新；缺失 cell 为 UNPROVEN"
  ],
  "failureBehavior": ["不使用 mocks 或 API 代替 Native 证明", "不扩大单平台或同 Station 结果", "不重复执行 full/release aggregate"],
  "updatedAt": "2026-10-24T00:00:00.000Z"
}
```
