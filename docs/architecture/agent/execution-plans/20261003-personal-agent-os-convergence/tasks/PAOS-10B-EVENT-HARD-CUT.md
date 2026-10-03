# PAOS-10B-EVENT-HARD-CUT - Station publisher hard cut

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-10B-EVENT-HARD-CUT",
  "workstreamId": "PAOS-CORE",
  "title": "Delete Agent-private publishers after UI consumers cut over",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-event-publisher-hard-cut",
  "journeyId": "PAOS-J02-EVENTS",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/agent/domain/event.go","apps/station/app/subserver/agent/infrastructure/event/event_bus.go","apps/station/app/subserver/agent/service/event_stream_service.go","apps/station/app/subserver/agent/service/agent_service.go","apps/station/app/subserver/agent/service/agent_service_test.go","apps/station/app/subserver/agent/service/turn_service.go","apps/station/app/subserver/agent/service/capability_authority_service.go","apps/station/app/subserver/agent/service/capability_authority_service_test.go","apps/station/app/subserver/agent/service/chat_task_service.go","apps/station/app/subserver/agent/service/orchestration_service.go","apps/station/app/subserver/agent/service/task_event_writer.go","apps/station/app/subserver/agent/service/atelier_projection_test.go","apps/station/app/subserver/agent/service/knowledge_descriptor_service_test.go","apps/station/app/subserver/agent/handler/event_stream_handler.go","apps/station/app/subserver/agent/handler/agent_handler.go","apps/station/app/subserver/agent/agent.go","apps/station/app/subserver/agent/module.go","tooling/acceptance/gates/agent/personal_goal_slices/paos_10b_event_hard_cut.py"],
  "readSet": ["apps/station/app/subserver/events","apps/desktop/src/runtimes/homeRuntime.ts","apps/applets/atelier/frontend/src/application/useAtelierController.ts"],
  "budgets": {"focusedCheckSeconds":1200,"functionalRunSeconds":1800,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_10b_event_hard_cut.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"agent-private-publisher-zero-reference","command":"! rg -n 'NewMemoryEventBus|MemoryEventBus|domain\\.EventBus|SetEventBus' apps/station/app/subserver/agent --glob '!**/migrations/**'","verificationClass":"STRUCTURAL_CHECK"},
    {"id":"event-publisher-hard-cut-functional","command":"cd apps/station && go test ./app/subserver/agent/... ./app/subserver/events/... -run 'Test.*(EventBus|Outbox|Publish)' -count=1","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["A live Goal continues updating after private publishers are removed","Shared EventBus.Publish is the only Station fan-out entry","Direct publishers use the durable outbox relay","Private subscriber service and route registration are absent"],
  "failureBehavior": ["Do not bridge private and shared buses","Any live private publisher or subscriber blocks completion"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: run one Goal after private Station publishers are removed.
- Visible result: Home and Atelier still receive committed progress.
- Station readback: events originate from outbox relay to shared EventBus.
- Lane: serialized Station integration.
- Scope guard: remove only Station publisher/service wiring; Desktop, official
  applet, and Gate consumer cleanup belongs to `PAOS-10C`.

## Current Snapshot

The Agent subserver still owns a private event bus, service, handler, and Desktop command path.
