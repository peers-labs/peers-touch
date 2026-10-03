# PAOS-10C-EVENT-CONSUMER-HARD-CUT - Canonical realtime consumers

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-10C-EVENT-CONSUMER-HARD-CUT",
  "workstreamId": "PAOS-CORE",
  "title": "Delete private Desktop and applet event consumers",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-event-consumer-hard-cut",
  "journeyId": "PAOS-J02-EVENTS",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/official_applets/atelier.go","apps/station/app/subserver/official_applets/atelier_gate_server/main.go","apps/desktop/src-tauri/src/application/agent_event_stream.rs","apps/desktop/src-tauri/src/application/agent_orchestration/mod.rs","apps/desktop/src-tauri/src/application/applets/mod.rs","apps/desktop/src-tauri/src/application/mod.rs","apps/desktop/src-tauri/src/interface/tauri_commands/agent_events.rs","apps/desktop/src-tauri/src/main.rs","apps/desktop/src-tauri/src/interface/http_gateway/mod.rs","apps/desktop/src/services/desktop_api.ts","apps/applets/atelier/contracts/atelier-projection.contract.json","tooling/scripts/applet-atelier-artifact-gate-product-window-gate.mjs","tooling/scripts/applet-atelier-decision-product-window-gate.mjs","tooling/scripts/applet-atelier-live-resume-product-window-gate.mjs","tooling/scripts/applet-atelier-product-window-cross-restart-gate.mjs","tooling/scripts/applet-atelier-product-window-failure-matrix-gate.mjs","tooling/scripts/applet-atelier-product-window-gate.mjs","tooling/scripts/applet-atelier-real-product-gate.mjs","tooling/scripts/atelier-projection-contract-gate.mjs","tooling/skills/pt-agent-development/impact-policy.json","tooling/acceptance/gates/agent/personal_goal_event_fanout_e2e.py","tooling/acceptance/features/agent-personal-goal.yaml","tooling/acceptance/capabilities/agent.yaml","tooling/acceptance/domains/agent.yaml","tooling/acceptance/environments/home-station.yaml","tooling/acceptance/gates.yaml","tooling/acceptance/registry.yaml"],
  "readSet": ["apps/station/app/subserver/events","apps/desktop/src/runtimes/homeRuntime.ts","apps/applets/atelier/frontend/src/application/useAtelierController.ts"],
  "budgets": {"focusedCheckSeconds":1200,"functionalRunSeconds":1800,"cleanupSeconds":180},
  "checks": [
    {"id":"event-consumer-zero-reference","command":"! rg -n 'agent_event_stream|agent_events_(subscribe|cancel)|agent-events-(subscribe|stream)|/sub-agent/agent/events/(subscribe|stream)' apps tooling packages model --glob '!**/*_test.go' --glob '!**/migrations/**' --glob '!**/target/**' --glob '!**/node_modules/**'","verificationClass":"STRUCTURAL_CHECK"},
    {"id":"event-consumer-hard-cut-functional","command":"python3 tooling/acceptance/gates/agent/personal_goal_event_fanout_e2e.py --mode development","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"event-hard-cut-proof","command":"python3 tooling/scripts/acceptance-run.py --gate agent-personal-goal-event-fanout-e2e","verificationClass":"ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Home and Atelier remain live after every private client route is removed","Official applet and Gate fixtures use canonical /events/stream semantics","Whole-repository private endpoint scan is empty","The event fan-out Gate is registered and exact-source"],
  "failureBehavior": ["Do not retain compatibility commands or endpoint aliases","Any private consumer or contract blocks completion"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: run one Goal after private client commands are removed.
- Visible result: Home and Atelier continue receiving identical progress.
- Station readback: both clients reconcile through canonical event identity.
- Lane: serialized consumer and Gate integration after `PAOS-10B`.
- Scope guard: remove only enumerated client/fixture consumers; do not change
  shared EventBus behavior or Goal projection semantics.

## Current Snapshot

Desktop, official applet, and controlled Gates still reference private Agent event routes.
