# PAOS-07-DURABLE-GOAL-EVENTS - Atomic progress events

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-07-DURABLE-GOAL-EVENTS",
  "workstreamId": "PAOS-CORE",
  "title": "Commit Goal progress before realtime publication",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-durable-goal-events",
  "journeyId": "PAOS-J02-EVENTS",
  "runtimeClass": "service",
  "writeSet": ["model/domain/realtime/event.proto","apps/station/frame/touch/model/realtime/event.pb.go","apps/desktop/src/gen/proto/domain/realtime/event_pb.ts","apps/mobile/src/gen/proto/domain/realtime/event_pb.ts","apps/mobile/src/gen/proto/domain/agent/agent_pb.ts","apps/mobile/src/gen/proto/domain/agent/capability_pb.ts","apps/mobile/src/gen/proto/domain/agent/goal_pb.ts","apps/station/app/subserver/agent/agent.go","apps/station/app/subserver/agent/infrastructure/persistence/agent_goal_event.go","apps/station/app/subserver/agent/infrastructure/persistence/agent_realtime_outbox.go","apps/station/app/subserver/agent/infrastructure/persistence/agent_realtime_outbox_test.go","apps/station/app/subserver/agent/infrastructure/persistence/models.go","apps/station/app/subserver/agent/infrastructure/persistence/migrations/019_agent_realtime_outbox.sql","apps/station/app/subserver/agent/service/agent_realtime_relay.go","apps/station/app/subserver/agent/service/agent_realtime_relay_test.go","apps/station/app/subserver/agent/service/goal_admission_service.go","apps/station/app/subserver/agent/service/goal_service.go","apps/station/app/subserver/agent/service/goal_service_test.go","apps/station/app/subserver/agent/service/task_event_writer.go","apps/station/app/subserver/events/bus.go","apps/station/app/subserver/events/bus_test.go","apps/station/app/subserver/events/store.go","apps/desktop/src/acceptance/agent/homeJourney.test.ts","tooling/acceptance/gates/agent/personal_goal_slices/paos_07_durable_goal_events.py","tooling/skills/pt-agent-development/impact-policy.json"],
  "readSet": ["docs/architecture/realtime/event-stream.md","apps/station/app/subserver/agent/service/goal_service.go","apps/station/app/subserver/agent/service/goal_admission_service.go"],
  "budgets": {"focusedCheckSeconds":1200,"functionalRunSeconds":1500,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_07_durable_goal_events.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"durable-goal-events-source","command":"bash model/build.sh && bash tooling/scripts/proto-gen-mobile.sh web && git diff --check -- model/domain/realtime apps/station/app/subserver/agent apps/station/app/subserver/events apps/desktop/src/gen/proto/domain/realtime apps/mobile/src/gen/proto/domain/realtime apps/mobile/src/gen/proto/domain/agent","verificationClass":"SOURCE_CHECK"},
    {"id":"durable-goal-events-functional","command":"cd apps/station && go test ./app/subserver/agent/... ./app/subserver/events/... -run 'Test.*(RealtimeOutbox|PublishRetry|PublishFailure|DomainCommit)' -count=1 && cd ../.. && pnpm --dir apps/desktop exec vitest run src/acceptance/agent/homeJourney.test.ts -t 'publish failure'","verificationClass":"FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["A Goal mutation and its outbox row commit atomically","Refreshing Home after a forced publish failure still shows committed progress","Relay retry keeps stable event id and per-actor order","Backlog admission is bounded with reserved terminal capacity"],
  "failureBehavior": ["Transaction failure emits no receiver-visible event","Committed terminal events remain pending until delivered"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: start work, simulate publication failure, then refresh Home.
- Visible result: committed progress is present and never rolled back by transport failure.
- Station readback: domain revision and pending outbox event share one transaction.
- Lane: Station integration.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Task events are durable, but shared EventBus delivery is not transactionally coupled.
