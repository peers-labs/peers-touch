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
  "updatedAt": "2026-10-05T04:43:00Z",
  "durableEvidence": [
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "git:9e943b9d68fdacc1fd9334c540a92ec5d6240290;development://personal-agent-os-convergence-20261003/artifacts/20261004T190913192042Z/paos-10c-event-consumer-hard-cut/capture.json;manifest-sha256:f6057f158342075158376238476f143af5e06dbb26f8cc1439cccd3e79b7d3"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "tooling/acceptance/evidence/applets/official-applet/atelier-product-window-gate.json;canonical-/events/stream;rendered-snapshot.invalidate-seq-4;unsubscribe:pass"
    }
  ]
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

Functional slice complete.

- Desktop and Atelier consume the canonical shared `/events/stream`; private
  Agent event commands and endpoints are absent.
- Native Profile `two` evidence passed canonical event consumption and resync.
- The packaged product-window Gate additionally proved canonical
  `snapshot.invalidate` delivery, Station reconciliation, visible seq `4`, and
  unsubscribe on close.
- Final suite-lifecycle Acceptance remains owned by `PAOS-30`.
