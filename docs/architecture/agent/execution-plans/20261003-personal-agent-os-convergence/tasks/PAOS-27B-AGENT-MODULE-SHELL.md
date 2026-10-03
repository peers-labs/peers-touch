# PAOS-27B-AGENT-MODULE-SHELL - Stable sibling surfaces

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-27B-AGENT-MODULE-SHELL",
  "workstreamId": "PAOS-ATELIER",
  "title": "Preserve Agent, Atelier, and Orchestration UI state across switches",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-agent-module-shell",
  "journeyId": "PAOS-J02,PAOS-J03,PAOS-J04",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/desktop/src/components/AppSideNav.tsx","apps/desktop/src/components/PageRouter.tsx","apps/desktop/src/pages/registry.ts","apps/desktop/src/types/navigation.ts","apps/desktop/src/components/agent/workbench/AgentWorkbench.tsx","apps/desktop/src/components/agent/workbench/layout.ts","apps/desktop/src/components/agent/workbench/layout.test.ts","apps/desktop/src/components/agent/workbench/workbench.contract.test.ts","apps/desktop/src/acceptance/agent/agentModuleSwitch.test.tsx","tooling/acceptance/gates/agent/personal_goal_slices/paos_27b_agent_module_shell.py"],
  "readSet": ["docs/client/common/ui-identity/modules/agent/README.md","docs/client/common/ui-identity/frontend-component-tree.md"],
  "budgets": {"focusedCheckSeconds":900,"functionalRunSeconds":1500,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_27b_agent_module_shell.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"agent-module-shell-ui","command":"pnpm --dir apps/desktop exec vitest run src/components/agent/workbench/layout.test.ts src/components/agent/workbench/workbench.contract.test.ts src/acceptance/agent/agentModuleSwitch.test.tsx","verificationClass":"UX_REVIEW"},
    {"id":"agent-module-shell-functional","command":"pnpm --dir apps/desktop check && pnpm --dir apps/desktop exec vitest run src/acceptance/agent/agentModuleSwitch.test.tsx","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["Desktop exposes stable Agent, Atelier, and Orchestration sibling navigation","All three surfaces remain alive after first visit","Draft, selection, scroll, and panel state survive module switches","Every rail open/close path restores focus and keeps the center rail usable"],
  "failureBehavior": ["Do not create nested global navigation inside Atelier","Do not remount a sibling surface to make it appear fresh"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: switch Agent -> Atelier -> Orchestration -> Atelier and toggle both rails.
- Visible result: state persists and no control overlaps or loses focus.
- Station readback: the reopened Atelier still shows the same Goal revision.
- Lane: Desktop shell; may run beside the applet-only state matrix.
- Scope guard: only sibling navigation, alive lifetime, rail toggles, and focus
  oracles are in scope; no business projection or command changes.

## Current Snapshot

Desktop has one Agent nav entry and an ephemeral legacy Orchestration route.
