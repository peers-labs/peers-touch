# Tasks TF Runtime Contract Follow-up Revision

> **Evidence**: EVID-011-TF-pre  
> **Status**: active Tasks artifact promotion  
> **Plan Step**: PLAN-P2 prototype revision / PLAN-P5 blocked precondition  
> **BOM**: BOM-007 / BOM-012 / BOM-015  
> **Spec**: SPEC-002 / SPEC-008 / SPEC-009 / SPEC-010 / SPEC-011 / SPEC-013 / SPEC-014  
> **Gates**: GATE-003 / GATE-004 / GATE-006 / GATE-008

## Source Anchors

- `external/lobehub/src/features/AgentTasks/AgentTaskList/AgentTasksPage.tsx`
- `external/lobehub/src/features/AgentTasks/AgentTaskList/CreateTaskInlineEntry.tsx`
- `external/lobehub/src/features/AgentTasks/AgentTaskDetail/useActiveTaskDetail.ts`
- `external/lobehub/src/store/task/slices/list/action.ts`
- `external/lobehub/src/store/task/slices/detail/action.ts`
- `external/lobehub/src/features/AgentTasks/AgentTaskDetail/TaskScheduleConfig.tsx`
- `external/lobehub/src/features/AgentTasks/AgentTaskDetail/TopicChatDrawer/index.tsx`
- `external/lobehub/src/features/AgentTaskManager/index.tsx`

## Prototype Delta

`EVID-011-TF-pre` promotes Tasks from the DE inline-composer first-screen artifact to the active runtime-contract artifact at:

`?surface=tasks&state=task-runtime-contract&check=tf`

The TF state adds explicit prototype coverage for:

- global list, global detail, agent-scoped list and agent-scoped detail route contracts;
- list scope reset, fetch loading, retryable error, empty and polling boundaries;
- per-scope inline draft restore and create failure preservation;
- detail transient error versus resolved `TASK_NOT_FOUND`;
- assignee-agent config hydration before model/runtime reads;
- heartbeat versus schedule contract, next-run preview and permission-gated start;
- task-agent right sidecar scoped to task context;
- topic drawer operation lineage, copy actions, share permission and gateway reconnect.

## Evidence Artifacts

- L2 screenshot: `tmp/agent-lobehub-l2-screenshots/tasks-tf-runtime-contract-scoped.png`
- L2 metadata: `tmp/agent-lobehub-tasks-tf-scoped-screenshot-meta.json`
- L3 DOM: `tmp/agent-lobehub-tasks-tf-dom.json`

## Claim Boundary

TF is prototype evidence only. It does not prove real SWR behavior, localStorage draft persistence, task creation/deletion mutation, scheduler execution, Station task persistence, gateway replay, task-agent runtime execution, product GATE-008 implementation parity, Owner confirmation, EVID-012 authorization or product migration.

DE remains historical inline-composer context after TF. CE/CM remain historical compact default context.
