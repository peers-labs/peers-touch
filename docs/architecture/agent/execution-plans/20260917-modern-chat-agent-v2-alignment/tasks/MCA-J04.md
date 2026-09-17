# MCA-J04 - MCP Product Lifecycle

## Task Slice

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-J04",
  "workstreamId": "MCA-J04",
  "title": "MCP install through governed invocation functional closure",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "V2-J04-functional",
  "journeyId": "V2-J04",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop",
    "apps/station/app/subserver/agent",
    "model/domain/agent",
    "packages/locales",
    "tooling/acceptance",
    "docs/architecture/agent"
  ],
  "readSet": [
    "docs/architecture/agent/modern-chat-agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 3000,
    "cleanupSeconds": 240
  },
  "checks": [
    {
      "id": "mcp-focused",
      "command": "(cd apps/desktop/src-tauri && cargo test --bin peers-touch-desktop 'application::mcp::tests::' && cargo test --bin peers-touch-desktop 'application::desktop_executor_worker::operation_') && (cd apps/station && go test ./app/subserver/agent/service ./app/subserver/agent/handler -run 'TestCapabilityOperation|TestCapabilityCleanup|TestCapabilityToolManifestSeed' -count=1) && pnpm --dir apps/desktop exec tsc --noEmit && pnpm --dir apps/desktop exec vitest run src/services/mcp-service.test.ts src/store/mcp.test.ts src/store/agentCapabilities.test.ts src/runtimes/toolRuntime.test.ts && python3 -m unittest tooling.acceptance.gates.agent.mcp_lifecycle_development_test tooling.acceptance.gates.agent.governed_tool_development_test tooling.acceptance.tests.test_provisioner_runtime.ProvisionerBlockingTests.test_agent_v2_mcp_provisions_profile_two_single_native_client",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mcp-native-journey",
      "command": "python3 tooling/acceptance/gates/agent/mcp_lifecycle_development.py",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "MCP manifest/config, install, test, connect, bind, invoke, cancel, retry, and recovery form one visible lifecycle",
    "Desktop owns local process and secret handling while Station owns operation and ToolCall lineage",
    "Disconnect and restart reconcile process and connection state without false success",
    "Timeout, takeover, replay, late result, secret canary, process, and port cleanup pass on a disposable MCP server"
  ],
  "failureBehavior": [
    "Do not move device-local stdio process or secret ownership into Station",
    "Do not keep client-only terminal operation truth",
    "Unknown side effects block automatic repeat and cleanup failure remains visible"
  ],
  "updatedAt": "2026-09-17T05:28:37Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "apps/desktop:tsc-pass;apps/desktop:vitest:31-pass;apps/desktop:rust-mcp-operation-tests-pass;apps/station:capability-operation-tests-pass;tooling/acceptance:j04-and-provisioner-tests-13-pass"
    }
  ]
}
```

## Objective

Close V2-J04 across MCP configuration, Desktop execution, Station operation
lineage, Agent binding, and real ToolCall continuation.

## Current Snapshot

- Desktop Rust supports persisted stdio/http/sse MCP configuration, discovery,
  policy checks, and tool execution.
- Station-owned lifecycle operations now fence the local Desktop executor by
  actor, device, capability session, configuration revision, and digest.
- The dedicated Development Journey uses one Profile `two` Native client, a
  disposable stdio MCP process, a deterministic provider fixture, real
  `local_mcp` ToolCall execution, cancellation/retry, restart reconciliation,
  and process/port/secret cleanup assertions.
- Focused source verification passes across Desktop Rust/TypeScript, Station
  Go, MCP store/runtime Vitest, and Development runner/provisioner tests.
- The post-checkpoint exact-source Native Journey remains pending.
