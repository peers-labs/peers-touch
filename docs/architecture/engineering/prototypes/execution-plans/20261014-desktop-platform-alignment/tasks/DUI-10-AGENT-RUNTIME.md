# DUI-10 - Agent runtime and orchestration closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-10-AGENT-RUNTIME","workstreamId":"DUI-AGENT","title":"Close AI12-AI14 through real turns, approvals, diagnostics, and orchestration events","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"dui-agent-runtime","journeyId":"DUI-AI12-AI14","runtimeClass":"native-desktop","writeSet":["apps/desktop","apps/station/app/subserver/agent","model/domain/agent","packages/locales","docs/architecture/domains/agent"],"readSet":["docs/architecture/domains/agent/modern-chat-agent","docs/architecture/domains/agent/agent-orchestration-architecture.md"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":5400,"cleanupSeconds":300},"checks":[{"id":"dui-agent-runtime-source","command":"pnpm --dir apps/desktop run check && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml && cd apps/station && go test ./app/subserver/agent/...","verificationClass":"SOURCE_CHECK"},{"id":"dui-agent-runtime-functional","command":"pnpm --dir apps/desktop exec vitest run src/store/agentTurnRecovery.test.ts src/store/chatOperationEvent.test.ts src/store/chatDelegation.test.ts src/components/messages/ToolCallCard.test.ts","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-agent-runtime-proof","command":"python3 tooling/scripts/acceptance-run.py --gate agent-native-turn-e2e && python3 tooling/scripts/acceptance-run.py --gate agent-orchestration-e2e","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Streaming turns, tool calls, approvals, retries, and recovery are live","Tasks, approvals, tool calls, diagnostics, and traces render authoritative events","The council surface projects real orchestration roles, budgets, judge/synthesis, and outcomes instead of a fixed nine-role script"],"failureBehavior":["Never fabricate streaming, approval, role, consensus, or diagnostic events","Never execute an unapproved capability","Preserve Station conversation and orchestration authority"],"updatedAt":"2026-10-14T08:43:26.000Z"}
```

## Objective

Turn the Agent prototype centerpiece into a truthful view over the real Agent
turn and orchestration runtimes.

## Current Snapshot

- AI12-AI14 have no alignment delta.
