# CCU-04 Group 与 Interaction 跨端硬切

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCU-20260922",
  "taskId": "CCU-04-group-interaction-cutover",
  "workstreamId": "CCU-W04",
  "title": "Group 生命周期与 Interaction 跨端硬切",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ccu-group-interaction-cutover",
  "journeyId": "CCU-J02-J03",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/desktop",
    "apps/mobile",
    "apps/station/app/subserver/conversation",
    "model/domain/chat",
    "packages/messaging-core",
    "tooling/acceptance/gates/chat"
  ],
  "readSet": [
    "docs/architecture/chat-lifecycle",
    "docs/architecture/messaging-platform",
    "docs/client/chat"
  ],
  "budgets": {
    "focusedCheckSeconds": 3600,
    "functionalRunSeconds": 7200,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "ccu-04-client-checks",
      "command": "cd apps/desktop && pnpm run check && pnpm run build && cd ../.. && pnpm mobile:check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccu-04-group-interaction-functional",
      "command": "cd apps/desktop && pnpm run test && cd ../.. && pnpm --dir apps/mobile run check:lifecycle-runtime",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "ccu-04-group-interaction-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-hard-cut-static",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Desktop 与 Mobile 使用 Conversation-owned command/event 完成 Group 创建、成员、角色、Owner、退群、解散与 MLS 收敛",
    "reply、thread、edit、retract、reaction、pin、read 与 typing 在 Direct 和 Group 使用同一 canonical contract",
    "Mobile legacy Group projection adapter 与 Desktop group_chat owner 在失去最后消费者时同步删除",
    "只验证旧行为的 test、fixture、mock 和 Gate 已删除或改写",
    "Group 与 Interaction focused functional evidence 当前有效"
  ],
  "failureBehavior": [
    "任一 Group 或 Interaction consumer 仍依赖 legacy model、route、command、store 或 fallback 时保持未完成",
    "authoritative membership 与 MLS projection 未同时收敛时不得显示 ready"
  ],
  "updatedAt": "2026-09-22T15:35:00Z",
  "durableEvidence": []
}
```

## 范围

落地 `CCU-J02` 与 `CCU-J03`。该 closure 以完整 Group/Interaction 用户结果为
边界，而不是按 Desktop、Mobile 或后端层拆分。

## 依赖

- CCU-03-direct-cutover

## Claim Boundary

本 Task 关闭 Group/Interaction 实现与 hard-cut，不把静态 Gate 或单端 focused
check 升级为 mixed-client `PROVEN`。完整 Group MLS 与双向 receiver proof 由
CCU-06 在同一 exact source 上完成。

## Current Snapshot

- State: pending.
- 现有 Mobile adapter 删除与 Desktop legacy command 删除只作为候选实现，必须
  在 Direct closure 后按同一 canonical contract 重新核验。
