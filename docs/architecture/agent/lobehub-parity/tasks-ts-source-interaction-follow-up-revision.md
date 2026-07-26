# Tasks TS Source Interaction Follow-up Revision

> **Evidence**: EVID-011-TS-pre
> **Status**: active Tasks source-interaction artifact / not confirmed
> **Plan Step**: PLAN-P2 prototype revision / PLAN-P5 blocked precondition
> **BOM**: BOM-007 / BOM-012 / BOM-015
> **Spec**: SPEC-002 / SPEC-008 / SPEC-009 / SPEC-010 / SPEC-011 / SPEC-013 / SPEC-014
> **Gates**: GATE-003 / GATE-004 / GATE-006 / GATE-008

## Source Anchors

- `external/lobehub/src/features/AgentTasks/AgentTaskList/AgentTasksPage.tsx`
- `external/lobehub/src/features/AgentTasks/AgentTaskList/CreateTaskInlineEntry.tsx`
- `external/lobehub/src/store/task/slices/list/action.ts`
- `external/lobehub/src/store/task/slices/detail/action.ts`
- `external/lobehub/src/store/task/slices/config/action.ts`
- `external/lobehub/src/store/task/slices/lifecycle/action.ts`
- `external/lobehub/src/features/AgentTasks/AgentTaskDetail/TaskDetailPage.tsx`
- `external/lobehub/src/features/AgentTasks/AgentTaskDetail/TaskScheduleConfig.tsx`
- `external/lobehub/src/features/AgentTasks/AgentTaskDetail/TopicChatDrawer/index.tsx`
- `external/lobehub/src/features/AgentTaskManager/TaskAgentProvider.tsx`
- `external/lobehub/src/features/AgentTaskManager/Conversation.tsx`
- `external/lobehub/src/features/AgentTaskManager/index.tsx`
- `external/lobehub/apps/server/src/services/taskRunner/index.ts`
- `external/lobehub/apps/server/src/services/taskRunner/scheduleTick.ts`
- `external/lobehub/apps/server/src/services/taskRunner/heartbeatTick.ts`
- `external/lobehub/apps/server/src/services/agentRuntime/AgentRuntimeService.ts`
- `external/lobehub/apps/server/src/services/agentRuntime/HumanInterventionHandler.ts`

## Prototype Delta

`EVID-011-TS-pre` promotes Tasks from the TF runtime-contract artifact to the active source-interaction artifact at:

`?surface=tasks&state=task-runtime-contract&check=ts`

The TS state adds source-level closure for:

- list cache truth: `ALL_AGENTS_LIST_KEY`, `taskKeys.list`, `taskKeys.groupList`, `filterToServerVisibility`, `scopeChangeResetState` and `isTaskListInit`;
- mutation truth: scoped localStorage drafts, `createTask/start -> end`, delete snapshot rollback, optimistic `updateTask`, `runMutation`, save status and touched-target refresh;
- scheduler truth: `OptimisticEngine` path serialization for `taskDetailMap.<id>`, default heartbeat/schedule values, `updateSchedule`, `scheduleTick`, `heartbeatTick`, human-waiting skip and max-execution skip;
- Task Agent and topic truth: builtin Task Agent context, `scope=task`, `viewedTask=list/detail`, `ConversationProvider`, `isolatedTopic`, `TaskCardScopeProvider`, gateway reconnect and operation lineage;
- runner/intervention truth: TaskRunner prompt/context, `AiAgentService.execAgent`, persisted `operationId` / `topicId`, on-complete lifecycle bridge, `HumanInterventionHandler` approve/reject/input phases and urgent-brief blocking.

## Evidence Artifacts

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; LobeHub source anchors listed above. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/tasks-ts-source-interaction-scoped.png` opened and inspected; metadata `tmp/agent-lobehub-tasks-ts-scoped-screenshot-meta.json` records sha256 `2b9c00881997b6d41e27d3c8c7130bf968cdaab559a910f6d454086afe414742` and `1204x2194` scoped capture. |
| L3 DOM | `tmp/agent-lobehub-tasks-ts-dom.json` records marker `task-source-interaction-ts`, evidence `EVID-011-TS-pre`, `runtimeContractShell=true`, `sourceInteractionClosure=true`, list source chain, mutation chain, scheduler chain, task-agent chain, task-runner chain, intervention chain, `sourceChainCount=5`, `sourceColumnCount=5`, all required source booleans true, `forbiddenHits=[]` and `portalChromeHit=false`. |
| Command | `pnpm --filter @peers-touch/prototype-portal run build` PASS after prototype edit. |

## Claim Boundary

TS is prototype evidence only. It does not prove real SWR data, durable localStorage draft persistence, taskService mutation success, scheduler execution, Station task persistence, gateway replay, Task Agent runtime execution, tool approval execution, product GATE-008 implementation parity, Owner confirmation, EVID-012 authorization or product migration.

TF remains historical runtime-contract context after TS. DE remains historical inline-composer context after TF. CE/CM remain historical compact default context.
