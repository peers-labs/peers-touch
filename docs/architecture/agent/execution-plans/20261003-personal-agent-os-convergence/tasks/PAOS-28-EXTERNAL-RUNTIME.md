# PAOS-28-EXTERNAL-RUNTIME - Portable execution

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-28-EXTERNAL-RUNTIME",
  "workstreamId": "PAOS-RUNTIME",
  "title": "Run and resume one stateful external runtime",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-external-runtime",
  "journeyId": "PAOS-J02-RUNTIME,PAOS-J03",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/agent/service/goal_external_runtime_executor.go","apps/station/app/subserver/agent/service/goal_external_runtime_executor_test.go","apps/station/app/subserver/agent/service/external_runtime_service.go","apps/station/app/subserver/agent/service/external_runtime_turn.go","apps/station/app/subserver/agent/service/externalruntime/manager.go","apps/station/app/subserver/agent/service/externalruntime/manager_test.go","apps/desktop/src-tauri/src/application/desktop_executor_worker/mod.rs","apps/desktop/src-tauri/src/application/desktop_executor_worker/operation_worker.rs","apps/desktop/src-tauri/src/application/desktop_executor_worker/station_transport.rs","apps/applets/atelier/frontend/src/presentation/components/GoalRuntimeStatus.tsx","apps/applets/atelier/frontend/src/presentation/components/GoalRuntimeStatus.test.tsx","apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx","apps/applets/atelier/frontend/locales/en.json","apps/applets/atelier/frontend/locales/zh-CN.json","tooling/acceptance/gates/agent/personal_goal_slices/paos_28_external_runtime.py"],
  "readSet": ["docs/architecture/agent/execution-plans/20261003-mcp-dual-runtime/plan.md","apps/station/app/subserver/agent/service/runtime_admission_service.go"],
  "budgets": {"focusedCheckSeconds":1200,"functionalRunSeconds":2400,"cleanupSeconds":240},
  "runtimeReuse": {"scope":"suite","entryCheckId":"external-runtime-functional","scenarioIds":["create","follow-up","restart-resume","cancel","reset"],"maxProvisioningRuns":1,"maxClientLaunches":2,"minWarmReuseRate":0.8,"requireAttachOnlyScenarios":true,"requireReceiverVisibleProof":true,"allowClientReplacement":true},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_28_external_runtime.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"mcp-exact-source-precondition","command":"make --no-print-directory plan-status PLAN=docs/architecture/agent/execution-plans/20261003-mcp-dual-runtime/plan.md | rg -q '\"status\":\"completed\"' && python3 tooling/scripts/acceptance-run.py --gate agent-mcp-dual-runtime-source && python3 tooling/scripts/acceptance-run.py --gate agent-v2-mcp-lifecycle-e2e","verificationClass":"STRUCTURAL_CHECK"},
    {"id":"external-runtime-source","command":"git diff --check -- apps/station/app/subserver/agent apps/desktop/src-tauri apps/applets/atelier/frontend/src","verificationClass":"SOURCE_CHECK"},
    {"id":"external-runtime-functional","command":"cd apps/station && go test ./app/subserver/agent/service/... -run 'Test.*GoalExternalRuntime' -count=1","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"external-runtime-proof","command":"python3 tooling/scripts/acceptance-run.py --gate agent-mcp-dual-runtime-source && python3 tooling/scripts/acceptance-run.py --gate agent-v2-mcp-lifecycle-e2e && python3 tooling/scripts/acceptance-run.py --gate agent-v2-external-runtime-e2e","verificationClass":"ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Atelier shows the selected external runtime and session state","Create, follow-up, restart resume, cancel, and reset use one TaskRun attempt contract","Runtime events enter the durable outbox and shared EventBus path","The completed MCP Plan and its source Gate are integrated into the current PAOS HEAD","MCP lifecycle and external-runtime Gates pass on the same exact source"],
  "failureBehavior": ["Run mcp-exact-source-precondition before any edit; on failure, do not edit PAOS sources and report the cross-Plan blocker","Unavailable sessions are visible and never silently replaced","Credentials and private handles never enter Goal projection or evidence"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: choose one external runtime, continue work, restart, and resume.
- Visible result: stable runtime/session status and the same Goal result in Atelier.
- Station readback: TaskRun attempt and runtime session binding agree.
- Lane: separately bound MCP/runtime prerequisite plus PAOS integration.
- Scope guard: this slice binds an already completed adapter to Goal/TaskRun;
  it does not implement the MCP runtime or invent a second session protocol.

## Current Snapshot

External runtime managers exist, but Goal-level portability is not proven.
