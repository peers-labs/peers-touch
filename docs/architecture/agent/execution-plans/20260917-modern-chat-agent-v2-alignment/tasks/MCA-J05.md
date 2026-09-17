# MCA-J05 - Connector Tool Invocation

## Task Slice

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-J05",
  "workstreamId": "MCA-J05",
  "title": "OAuth Connector resource-to-tool functional closure",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "V2-J05-functional",
  "journeyId": "V2-J05",
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
      "id": "connector-focused",
      "command": "(cd apps/desktop/src-tauri && cargo test --bin peers-touch-desktop 'application::oauth2::tests::' && cargo test --bin peers-touch-desktop 'application::desktop_executor_worker::supervisor::tests::browser_surface_advertises_only_connector_capabilities') && pnpm --dir apps/desktop exec tsc --noEmit && pnpm --dir apps/desktop exec vitest run src/acceptance/agentAcceptanceHarness.test.ts src/store/agentConnectors.test.ts src/store/agentCapabilities.test.ts src/runtimes/agentCapabilityRuntime.test.ts src/runtimes/toolRuntime.test.ts && (cd apps/station && go test ./app/subserver/agent/service -run 'Connector|Capability|Tool' -count=1) && python3 -m unittest tooling.acceptance.gates.agent.connector_invocation_development_test tooling.acceptance.gates.agent.governed_tool_development_test tooling.acceptance.tests.test_provisioner_runtime.ProvisionerBlockingTests.test_agent_v2_connector_provisions_profile_two_single_native_client",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "connector-native-journey",
      "command": "python3 tooling/acceptance/gates/agent/connector_invocation_development.py",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "OAuth connection and scopes project versioned Connector resource manifests without exposing credentials",
    "Agent binding and policy are confirmed by Station readback",
    "A real governed turn invokes the Connector resource and persists one result",
    "Expiry, permission denial, disconnect, provider revoke, resource removal, reconnect, and actor isolation expose typed recovery"
  ],
  "failureBehavior": [
    "Do not infer tool readiness from an OAuth provider label",
    "Do not duplicate OAuth credential ownership in Agent configuration",
    "Disconnect and invoke races must preserve pinned revisions and idempotency"
  ],
  "updatedAt": "2026-09-17T07:20:59Z",
  "durableEvidence": []
}
```

## Objective

Close V2-J05 from OAuth authority through Connector manifest, capability
binding, governed execution, result, and recovery.

## Current Snapshot

- OAuth connection UI and canonical capability binding projection exist.
- Station has an `oauth_connector_call` Tool definition and Connector backfill.
- Resource manifest versioning and real turn invocation/recovery remain
  unproven.
