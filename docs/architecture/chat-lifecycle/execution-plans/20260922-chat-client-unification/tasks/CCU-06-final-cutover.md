# CCU-06 最终客户端切换与矩阵验证

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCU-20260922",
  "taskId": "CCU-06-final-cutover",
  "workstreamId": "CCU-W06",
  "title": "最终共享 owner 切换与 mixed-client 矩阵验证",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ccu-final-cutover",
  "journeyId": "CCU-J01..CCU-J08",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "apps/desktop",
    "apps/mobile",
    "apps/station",
    "model/domain/chat",
    "model/domain/realtime",
    "packages/messaging-core",
    "packages/prototypes",
    "tooling/acceptance",
    "tooling/scripts",
    "docs/architecture/acceptance-framework",
    "docs/architecture/chat-lifecycle",
    "docs/architecture/identity",
    "docs/architecture/mobile",
    "docs/architecture/search",
    "docs/architecture/social-runtime",
    "docs/architecture/state-machines",
    "docs/global/coding-guide",
    "docs/README.md"
  ],
  "readSet": [
    "docs/architecture/chat-lifecycle",
    "docs/architecture/messaging-platform",
    "docs/architecture/realtime",
    "docs/client/chat"
  ],
  "budgets": {
    "focusedCheckSeconds": 3600,
    "functionalRunSeconds": 21600,
    "cleanupSeconds": 1200
  },
  "checks": [
    {
      "id": "ccu-06-all-source-checks",
      "command": "cd apps/desktop && pnpm run check && pnpm run test && pnpm run build && cd ../.. && pnpm mobile:check && cd apps/station/app && go test ./subserver/conversation/... ./subserver/events/... ./subserver/federation/... ./subserver/actor_identity/... && cd ../frame && go test ./core/federation/... ./core/facility/session/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccu-06-mixed-client-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-mixed-client-same-station-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "ccu-06-cross-station-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-mixed-client-cross-station-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "ccu-06-group-mls-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-mixed-client-group-mls-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Direct、Group、Interaction、Attachment、Continuity 与 Call 均只剩 canonical production owner",
    "最后共享 consumer 移除时同步删除其失去消费者的 store、schema、registry、generated 和 tooling 遗产",
    "macOS/Linux/Windows Desktop 与 iOS/Android Mobile 必需 runtime cells 均有 current exact-source 结果",
    "CHAT-G16、CHAT-G17 与 CHAT-G20 双向 mixed-client Gate 通过",
    "未运行或不可用的必需 cell 保持 UNPROVEN，不用其他平台结果替代"
  ],
  "failureBehavior": [
    "任一行为仍需 legacy fallback 或任一必需 runtime cell 缺失时保持未完成",
    "不得把本 closure 变成延迟迁移阶段；只允许删除此前 vertical closure 的最后共享 consumer"
  ],
  "updatedAt": "2026-09-25T02:12:00Z",
  "durableEvidence": []
}
```

## 范围

在三个行为 closure 全部完成后，关闭只因多个行为共享而保留到最后一个 consumer
的 owner，并对完整 Desktop/Mobile mixed-client 矩阵做 exact-source 验证。

## 依赖

- CCU-05-continuity-call

## Current Snapshot

- State: reopened after completion audit found executable legacy tests, Gates,
  generated output, local schema, Mobile fallback, and stale current-source
  references.
- Prior source-bound evidence remains historical and must be regenerated after
  the hard cut.
