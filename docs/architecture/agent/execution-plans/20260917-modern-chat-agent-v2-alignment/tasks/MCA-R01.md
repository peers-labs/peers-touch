# MCA-R01 - Foundation Restart Projection Remediation

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-R01",
  "workstreamId": "MCA-R01",
  "title": "Close Foundation restart and receiver convergence regressions",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "V2-foundation-restart-remediation",
  "journeyId": "V2-acceptance",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent/agent.proto",
    "apps/mobile/src/gen/proto/domain/agent/agent_pb.ts",
    "apps/desktop/src/gen/proto/domain/agent/agent_pb.ts",
    "apps/station/app/subserver/agent/errcode/error.go",
    "apps/station/app/subserver/agent/handler/turn_handler.go",
    "apps/station/app/subserver/agent/handler/turn_handler_test.go",
    "apps/station/app/subserver/agent/model/agent.pb.go",
    "apps/station/app/subserver/agent/service/chat_task_service.go",
    "apps/station/app/subserver/agent/service/chat_task_recovery_test.go",
    "apps/station/app/subserver/agent/service/provider_service.go",
    "apps/station/app/subserver/agent/service/provider_stream_test.go",
    "apps/station/app/subserver/agent/service/provider_thinking_mode_test.go",
    "apps/station/app/subserver/agent/service/provider_tool_test.go",
    "apps/station/app/subserver/agent/service/tool_dispatch_service.go",
    "apps/station/app/subserver/agent/service/tool_dispatch_service_test.go",
    "apps/station/app/subserver/conversation/production_peer_routes.go",
    "apps/station/app/subserver/social/infrastructure/audience_grant_repo.go",
    "apps/station/app/subserver/social/infrastructure/private_post_repo.go",
    "apps/desktop/src-tauri/src/application/desktop_executor_worker/supervisor.rs",
    "apps/desktop/src-tauri/src/application/runtime_evidence.rs",
    "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
    "apps/desktop/src/runtimes/agentCapabilityRuntime.ts",
    "apps/desktop/src/runtimes/agentCapabilityRuntime.test.ts",
    "apps/desktop/src/services/appRuntime.ts",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/desktop/src/services/desktop_api.clientPermissionDenied.test.ts",
    "apps/desktop/src/store/agent.ts",
    "apps/desktop/src/store/chat.ts",
    "apps/desktop/src/store/chatMerge.test.ts",
    "apps/desktop/src/components/messages/AssistantMessage.tsx",
    "apps/desktop/src/components/messages/AssistantMessage.clientPermissionDenied.test.ts",
    "apps/desktop/src/components/agent/AgentCapabilityInventoryPanel.tsx",
    "apps/desktop/src/components/agent/AgentCapabilityInventoryPanel.test.ts",
    "apps/desktop/src/pages/AgentProfilePage.tsx",
    "apps/desktop/src/kernel/identityRuntime.ts",
    "apps/desktop/src/kernel/identityRuntime.test.ts",
    "apps/desktop/src/acceptance/agent/harness.ts",
    "apps/mobile/src/acceptance/actions.ts",
    "apps/mobile/src/features/auth/authSession.ts",
    "apps/mobile/src/features/call",
    "apps/mobile/src/features/chat",
    "apps/mobile/src/features/group",
    "apps/mobile/src/features/social",
    "apps/mobile/src/pages",
    "apps/mobile/src/runtimes",
    "apps/mobile/src/services/mobileCommands.ts",
    "apps/mobile/src/services/gateways",
    "apps/mobile/src-tauri/src/commands/oauth.rs",
    "apps/mobile/src-tauri/src/messaging",
    "apps/mobile/src-tauri/src/runtime/oauth",
    "apps/mobile/src-tauri/src/runtime/station_transport",
    "packages/messaging-core/src/crypto",
    "packages/messaging-core/src/identity",
    "packages/locales/en/agent.json",
    "packages/locales/zh-CN/agent.json",
    "tooling/acceptance/gates/agent/foundation_direct_adapter.py",
    "tooling/acceptance/gates/agent/foundation_direct_adapter_test.py",
    "tooling/acceptance/gates/agent/foundation_group_one_probe.py",
    "tooling/acceptance/gates/agent/foundation_group_one_probe_test.py",
    "tooling/acceptance/gates/agent/foundation_group_one_scenarios.py",
    "tooling/acceptance/gates/agent/foundation_group_one_scenarios_test.py",
    "tooling/acceptance/core/harness.py",
    "tooling/acceptance/gates/agent/foundation_runtime_client.py",
    "tooling/acceptance/gates/agent/foundation_runtime_client_test.py",
    "tooling/acceptance/gates/agent/foundation_scenario_runner.py",
    "tooling/acceptance/gates/agent/foundation_scenario_runner_test.py",
    "tooling/acceptance/gates/agent/foundation_station_restart.py",
    "tooling/acceptance/gates/agent/foundation_station_restart_test.py",
    "tooling/acceptance/gates/agent/agent_native_static_test.py",
    "docs/architecture/agent"
  ],
  "readSet": [
    "apps/station/app/subserver/agent",
    "apps/desktop/src/store",
    "tooling/acceptance/gates/agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 7200,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "foundation-restart-recovery",
      "command": "cd apps/station && go test ./app/subserver/agent/service -run '^(TestRecoverRunningChatTasks|Test.*ClientPermissionDenied|Test.*Ollama)' -count=1 && cd ../.. && rustfmt --edition 2021 --check apps/desktop/src-tauri/src/application/desktop_executor_worker/supervisor.rs apps/desktop/src-tauri/src/application/runtime_evidence.rs apps/desktop/src-tauri/src/interface/http_gateway/mod.rs && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml && python3 -m unittest tooling.acceptance.gates.agent.foundation_direct_adapter_test tooling.acceptance.gates.agent.foundation_scenario_runner_test tooling.acceptance.gates.agent.agent_native_static_test && pnpm --dir apps/desktop check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "foundation-mobile-reconciliation",
      "command": "pnpm --dir apps/mobile check && cargo check --manifest-path apps/mobile/src-tauri/Cargo.toml",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "foundation-restart-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item MCA-R01-PR112 --gate agent-v2-kernel-foundation-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Station startup recovery persists exactly one typed interrupted assistant message when interruption occurs before the first text event",
    "Existing pending assistant messages still transition in place without duplicate message creation",
    "Turn, Attempt, message, terminal event, task step, lease, and active branch state converge atomically",
    "Invalid-reference resend waits for exactly one canonical visible Assistant before recording receiver evidence",
    "The existing loop-budget product Journey is registered as a direct-runtime Foundation group with an independent oracle and complete role evidence",
    "Client capability permission kind and state originate in the client owner, are persisted in the signed lease, and produce the exact terminal CLIENT_PERMISSION_DENIED payload before ToolCall persistence or local execution",
    "Desktop and Browser receivers expose localized Open permission settings recovery without Browser capability fabrication or automatic resend",
    "The sanitized-history reconciliation leaves Station source buildable with no superseded Social adapter or stale protobuf response construction",
    "The exact-source Foundation Journey passes with clean runtime teardown"
  ],
  "failureBehavior": [
    "Do not weaken the Foundation oracle or synthesize Station evidence in the client",
    "Do not weaken the Foundation oracle or alter product behavior",
    "Do not create an assistant message for a Turn whose user message was never admitted",
    "Preserve terminal idempotency and active branch lineage",
    "Return only the first deterministic failure to its owning layer"
  ],
  "updatedAt": "2026-09-29T22:32:00Z",
  "durableEvidence": []
}
```

## Objective

Close the Foundation restart gap exposed by `BASE-INTERRUPTED`: a direct-model
Turn interrupted after provider start but before first text must retain one
authoritative, retryable interrupted Assistant projection after Station
restart. Continue the same first-failure closure through the MCA-D27
permission-denied contract exposed by the next exact-source Foundation run.

## Current Snapshot

- Run `20260924T200431539686Z-b02b1a38a66edf1e9af21f7bb280339e`
  exposed missing Station persistence for the interrupted Assistant; the
  startup-recovery owner now persists the typed projection.
- A later exact-source retry reached a matching corrected-resend `done` event
  and canonical store state, then sampled receiver visibility before DOM
  convergence; the Harness must await exactly one visible canonical Assistant.
- Exact-source run `20260925T001210202640Z-b7203aa045503c7a64a5b262fe7b1b66`
  crossed the restart and receiver regressions, then failed closed at
  `BASE-LOOP_BUDGET_EXHAUSTED` because the existing standalone product Journey
  was not registered in the Foundation direct-runtime adapter.
- Instrumented exact-source run
  `20260925T022549650004Z-761c02bd8990c84fb3d44592c496975a`
  proved the Browser `zh-CN` invalid-reference resend was admitted, emitted
  more than 1,100 thinking events, and then terminated failed. The scenario now
  pins thinking to disabled and restores the prior Agent setting during cleanup.
- Exact-source run
  `20260925T152835902356Z-827632478defe662b212875f3c2c487d`
  crossed the prior repaired cells and failed closed at Browser
  `BASE-PERMISSION_DENIED` because no direct-runtime scenario was registered.
  MCA-D27 now defines the missing proto-first permission owner, Station
  pre-dispatch rejection, receiver recovery action, Browser observer semantics,
  and zero-execution proof boundary.
- Run `20260925T200337561495Z-2467c5cfacc56fecabff73ab2e5ce7a3` exposed a late canonical refresh dropping the local-only `BASE-DUPLICATE_CONFLICT` Assistant; the owner is Desktop chat merge with focused regression coverage.
- Exact-source redeploy after the sanitized-history rebase exposed two orphaned legacy Social adapters and one stale Conversation response constructor; reconciliation removes the adapters and uses the canonical protobuf `oneof`.
- Ark run `20260928T014932696320Z-45059d51355332a04a644511cec18390`
  reached Browser `BASE-PROVIDER_TIMEOUT`; source inspection found that live
  Turn SSE lacked heartbeat frames, so the 30-second Browser idle deadline
  preceded the 120-second provider terminal. Cleanup passed.
