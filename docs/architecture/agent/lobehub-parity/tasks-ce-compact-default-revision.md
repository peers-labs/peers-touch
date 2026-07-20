# Agent LobeHub Parity - Tasks Compact Default Revision

> **Status**: pending-review / not confirmed
> **Version**: v0.1
> **Created**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 Tasks compact default revision / PLAN-P5 blocked precondition
> **Evidence**: EVID-011-CE-pre, EVID-011-CM-pre

---

## 1. Purpose

`EVID-011-BV-pre` proved deep Tasks interaction states, but the default
Owner-facing Tasks view still opened into a dense task detail workbench. LobeHub
live Tasks defaults to a quieter task list page: `All tasks`, grouped rows, top
search/create/settings controls and a right `Topic` / Task Agent composer.

This revision changes default Tasks to that compact list baseline while
preserving `state=deep-tasks` for BV deep inspection.

`EVID-011-CM-pre` promotes the default Tasks view from the earlier CE
workspace/full screenshot into a clean scoped `.pt-task-compact-shell` L2/L3
artifact for the active compact-baseline gate.

## 2. Revision Scope

| Live / Prototype Delta | CE Revision |
| --- | --- |
| Default Tasks opened with a large title, inline create and task detail already visible | Default `?surface=tasks&check=ce` now renders a compact `All tasks` list baseline. |
| LobeHub live groups task rows under statuses | Added `Scheduled`, `Awaiting input` and `Paused` groups with compact task rows and counts. |
| Right Task Agent composer was only evidenced in the deep state | Added default right `Topic` / `Task Agent` panel with prompt bubbles, task-agent textarea, topic chip, model chip and Send. |
| Portal capture pushed the right panel outside the inspected visual region | Constrained compact workspace width so list and right composer are visible in one Owner-facing screenshot. |
| Active compact artifact gate still used the broad CE workspace/full screenshot | CM adds a clean scoped `.pt-task-compact-shell` screenshot and DOM artifact so Owner/gate evidence validates the Tasks surface itself, not Portal chrome or a broad capture. |
| BV deep interaction evidence still needed | Preserved `?surface=tasks&state=deep-tasks&check=bv` for inline create, context menu, schedule config, detail editor, topic drawer, resize and runtime controls. |

## 3. Evidence

| Layer | Evidence |
| --- | --- |
| L1 Static | `packages/prototypes/desktop/features/agent-lobehub-parity/src/AgentLobeHubParityPrototype.tsx`; `packages/prototypes/desktop/features/agent-lobehub-parity/src/styles.css`; source anchors `external/lobehub/src/routes/(main)/tasks/index.tsx`, `external/lobehub/src/features/AgentTasks/TaskWorkspaceLayout.tsx`, `external/lobehub/src/features/AgentTasks/AgentTaskList/AgentTasksPage.tsx`, `external/lobehub/src/features/AgentTasks/AgentTaskList/TaskList.tsx`, `external/lobehub/src/features/AgentTaskManager/index.tsx`. |
| L2 Visual | Live integrated-browser snapshot from `https://app.lobehub.com/tasks`; CE prototype screenshot `tmp/agent-lobehub-l2-screenshots/tasks-ce-compact-tasks-workspace-full.png`, opened and inspected at 1320x444; CM clean scoped screenshot `tmp/agent-lobehub-l2-screenshots/tasks-cm-compact-tasks-scoped.png`, opened and inspected at 2235x444 with `All tasks`, three grouped rows, Search/Create/Settings controls, right `Topic` / Task Agent panel, composer, model chip and Send visible. |
| L3 Dynamic / DOM | CE DOM `tmp/agent-lobehub-tasks-ce-dom.json`: `compactTasks=true`, `compactShell=true`, `allTasks=true`, `scheduledGroup=true`, `awaitingInputGroup=true`, `pausedGroup=true`, `taskRows=3`, `detailAbsentByDefault=true`, `deepEditorAbsentByDefault=true`, `rightPanel=true`, `taskComposer=true`, `modelButton=true`, `rightPanelVisibleInViewport=true`, `forbiddenHits=[]`. CM DOM `tmp/agent-lobehub-tasks-cm-dom.json`: `root=true`, `compactTasks=true`, `compactShell=true`, `compactList=true`, `taskRows=3`, `rightPanel=true`, `taskComposer=true`, `taskComposerVisible=true`, `createTaskButton=true`, `viewSettingsCollapsedByDefault=true`, `forbiddenHits=[]`; metadata `tmp/agent-lobehub-tasks-cm-scoped-screenshot-meta.json` records `portalChromeHit=false`. |

## 4. Remaining Risk

This revision improves default Tasks visual parity only. It does not prove real
task store mutations, durable drafts, scheduler persistence, permission-backed
disabled states, topic side effects, document preview, task virtualization,
drag/upload behavior or product GATE-008 checks.

## 5. Claim Boundary

`EVID-011-CE-pre` proves a Tasks compact default prototype revision with L2/L3
evidence. `EVID-011-CM-pre` proves the clean scoped Tasks artifact is strong
enough for the active compact artifact gate. Neither evidence row confirms
Tasks, creates or authorizes `EVID-012`, or allows Desktop / Station / Model
product migration.
