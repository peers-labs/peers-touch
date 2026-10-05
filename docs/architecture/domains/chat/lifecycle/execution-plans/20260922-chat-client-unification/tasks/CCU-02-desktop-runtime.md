# CCU-02 Desktop Runtime 拆分

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCU-20260922",
  "taskId": "CCU-02-desktop-runtime",
  "workstreamId": "CCU-W02",
  "title": "从 socialRealtime 原子拆出 messagingRuntime",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ccu-desktop-runtime",
  "journeyId": "CCU-J05",
  "runtimeClass": "source-only",
  "writeSet": [
    "model/domain/chat",
    "apps/desktop/src/gen/proto/domain/chat",
    "apps/mobile/src/gen/proto/domain/chat",
    "apps/station/frame/touch/model/chat",
    "apps/desktop/src-tauri/src/model",
    "apps/desktop/src-tauri/src/main.rs",
    "apps/desktop/src-tauri/src/messaging",
    "apps/desktop/src/messaging",
    "apps/desktop/src/runtimes",
    "apps/desktop/src/services",
    "apps/desktop/src/store",
    "apps/desktop/src/pages",
    "apps/desktop/src/components/chat",
    "docs/client/common/ui-identity",
    "docs/client/desktop/runtime-projections.md",
    "tooling/skills/pt-desktop-runtime-projections"
  ],
  "readSet": [
    "docs/architecture/chat-lifecycle",
    "docs/client/desktop"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "ccu-02-desktop-build",
      "command": "cd apps/desktop && pnpm run check && pnpm run build && cd src-tauri && cargo check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccu-02-runtime-coexist",
      "command": "cd apps/desktop && pnpm exec vitest run src/messaging/runtime.test.ts src/runtimes/messagingRuntime.test.ts src/services/socialRealtime.test.ts src/services/messagingProjection.test.ts src/store/socialChat.conversationProjection.test.ts src/store/socialProjectionReceipt.test.ts",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "ccu-02-runtime-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate desktop-check",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "messagingRuntime 独占 Chat command lifecycle、projection event consumption、reconciliation、scope reset",
    "apps/desktop/src/messaging/runtime.ts 承载 Messaging domain runtime",
    "apps/desktop/src/runtimes/messagingRuntime.ts 按 Desktop Kernel contract 注册",
    "socialRealtime 只保留 friendship、contact、profile、presence 和 Social 通知",
    "两个 Runtime 只通过 typed identity/social projection 交互",
    "docs/client/desktop/runtime-projections.md 已在同一 closure 更新",
    "Projection event schema 统一（CCU-D04）",
    "Desktop build 成功且现有 chat 测试通过"
  ],
  "failureBehavior": [
    "Desktop build、runtime ownership 或 projection freshness 任一失败都保持本任务未完成",
    "不得用页面挂载刷新替代 messagingRuntime 的长期 projection ownership"
  ],
  "updatedAt": "2026-09-22T13:50:00Z",
  "durableEvidence": []
}
```

## 范围

落地 CCU-D01 决策。Desktop 当前由 `socialRealtime` 同时持有 Social 和 Chat
freshness，本任务将 Chat 所有权原子拆出到独立的 `messagingRuntime`，同时更新
Desktop Kernel 真源文档 `runtime-projections.md`。

## 依赖

- CCU-01-contract（canonical Proto 就绪）

## 验收判据

- Desktop build + check + test 全部通过
- messagingRuntime 和 socialRealtime 共存且各自拥有清晰边界
- runtime-projections.md 不再声明 socialRealtime 拥有 Chat projection

## Current Snapshot

- State: checkpoint-ready under Session `CCU-02-CORRECTION-202609221440`;
  stale completion claim remains retired until formal closure.
- `apps/desktop/src/messaging/runtime.ts` is the session-scoped domain owner;
  the Kernel descriptor is a thin adapter and Chat is authenticated-critical.
- `socialRealtime.ts` retains only Social ownership; production Chat command
  callers are fenced through the Messaging runtime facade.
- Canonical `MessagingProjectionInvalidation` and all generated Go/Desktop/
  Mobile bindings are aligned with the native/web adapter.
- Desktop TypeScript check, Desktop build, Rust `cargo check`, and 24 focused
  runtime/projection tests pass.
- `runtime-projections.md` and the canonical runtime Skill source reflect the
  target ownership; host Skill rollout and a distinct-session audit remain
  before formal closure.
