# Agent LobeHub Parity - Tasks Inline Composer Follow-Up Revision

> **Status**: pending-review / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Tasks side-by-side revision / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-DE-pre

---

## 1. Purpose

`EVID-011-CM-pre` promoted the clean scoped compact Tasks artifact, but L1
source comparison against LobeHub Tasks showed the default `/tasks` structure
still under-modeled the first-screen task creation and Task Agent panel.

This revision keeps the compact `All tasks` baseline and adds a LobeHub-like
inline task composer, Accordion-style task groups, hidden-completed footer and
Task Agent toolbar/input structure before Owner confirmation.

## 2. Source Anchors

| Anchor | What It Proves |
| --- | --- |
| `external/lobehub/src/routes/(main)/tasks/index.tsx` | `/tasks` routes directly to `AgentTasksPage`. |
| `external/lobehub/src/features/AgentTasks/TaskWorkspaceLayout.tsx` | Desktop Tasks composes the list outlet with a right `AgentTaskManager`. |
| `external/lobehub/src/features/AgentTasks/AgentTaskList/AgentTasksPage.tsx` | Default list page uses `NavHeader`, create action behavior, `CreateTaskInlineEntry`, `TaskList`, view settings and right-panel toggle. |
| `external/lobehub/src/features/AgentTasks/AgentTaskList/CreateTaskInlineEntry.tsx` | Inline task composer includes collapsible card, editor, priority, assignee, visibility, attachment and primary submit controls. |
| `external/lobehub/src/features/AgentTasks/AgentTaskList/TaskList.tsx` | Task list uses grouped Accordion rows, AsyncBoundary loading/error/empty handling and hidden-completed footer. |
| `external/lobehub/src/features/AgentTaskManager/index.tsx` | Right panel is a resizable `RightPanel` with default width and Task Agent conversation. |
| `external/lobehub/src/features/AgentTaskManager/Toolbar.tsx` | Task Agent header includes topic title, add topic, topic history and close panel actions. |
| `external/lobehub/src/features/AgentTaskManager/Conversation.tsx` | Task Agent uses compact chat input with agent selector, search action, model selector and compact send button. |

## 3. Revision Scope

| Live / Source Delta | DE Revision |
| --- | --- |
| Compact Tasks first screen lacked visible inline composer | Added default visible inline task composer with placeholder, collapse affordance, priority, assignee, visibility, attachment and `Create task` controls. |
| Task groups looked like plain grouped rows | Added lighter Accordion-style group headers and retained grouped task rows for `Scheduled`, `Awaiting input` and `Paused`. |
| Hidden-completed behavior was not visible in compact default | Added a quiet hidden-completed footer to express the current filter boundary. |
| Right Task Agent panel was a simplified local panel | Added toolbar action icons for create topic, topic history and panel close, plus centered welcome state. |
| Task Agent composer lacked LobeHub compact action structure | Added `Agent`, `Search`, model and `Send` controls around the compact composer placeholder. |

## 4. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; LobeHub source anchors listed above. |
| L2 Visual | `tmp/agent-lobehub-l2-screenshots/tasks-de-compact-tasks-scoped.png`, captured from rendered Prototype Portal at `http://localhost:3201/?surface=tasks&check=de`, then scoped-isolated to `.pt-task-compact-shell`; opened and inspected at 1720x920. |
| L3 Dynamic / DOM | `tmp/agent-lobehub-tasks-de-dom.json`: `compactTasks=true`, `compactShell=true`, `inlineComposer=true`, `inlineComposerPlaceholder=What needs to be done?`, `taskRows=3`, `hiddenFooter=true`, `rightPanel=true`, `rightPanelToolbarActions=3`, `taskAgentWelcome=true`, `taskComposer=true`, `taskComposerPlaceholder=Ask, create, or start a task. @ to assign tasks to other agents.`, `forbiddenHits=[]`; metadata `tmp/agent-lobehub-tasks-de-scoped-screenshot-meta.json` records `portalChromeHit=false`. |

## 5. Remaining Risk

This revision improves Tasks first-screen visual and interaction parity only. It
does not prove durable drafts, real task creation, scheduler persistence,
permission-backed disabled states, topic side effects, task virtualization,
drag upload, store-backed list mutations, or product GATE-008 behavior.

## 6. Claim Boundary

`EVID-011-DE-pre` promotes the Tasks active compact artifact from CM to the DE
inline-composer first screen. It does not confirm Tasks, does not authorize
`EVID-012`, and does not allow Desktop / Station / Model product migration.
