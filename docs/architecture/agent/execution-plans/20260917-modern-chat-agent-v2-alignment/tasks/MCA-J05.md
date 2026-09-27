# MCA-J05 - Connector Tool Invocation

## Task Slice

```json
{
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
  "updatedAt": "2026-09-17T23:04:09Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "git:ec9995a5e6dec7acfa9c52a75485838caba65b7d;apps/desktop:rust-connector-tests-pass;apps/desktop:tsc-pass;apps/desktop:vitest-39-pass;apps/station:connector-capability-tool-tests-pass;tooling/acceptance:j05-runner-and-provisioner-tests-14-pass"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "git:80161c9b4853b19f255fbed5f2cd4b55c7d9334c;profile:two;station:station-two;runtime:native-tauri;artifact:<runtime-home>/dev/workspaces/a534541b87e49abf/workflow/MCA-V2-ALIGNMENT-J05/artifacts/20260917T230215585911Z/result.json"
    }
  ]
}
```

## Objective

Close V2-J05 from OAuth authority through Connector manifest, capability
binding, governed execution, result, and recovery.

## Current Snapshot

- Desktop owns actor-scoped OAuth connection state and credential-local
  execution; Station owns resource manifests, capability bindings, readiness,
  admission, approval, replay, and result lineage.
- The generic `oauth_connector_call` production path is removed; startup
  backfill only retires legacy placeholder rows.
- Versioned opaque Connector resources, Station-owned binding/readiness,
  pinned disconnect-race dispatch, typed recovery, lease replacement on OAuth
  projection changes, and the native Journey driver are implemented at
  checkpoint `80161c9b4853b19f255fbed5f2cd4b55c7d9334c`.
- Focused Rust, TypeScript, Vitest, Go, and Python verification passes.
- Exact-source Profile `two` native invocation/recovery is
  `FUNCTIONAL_PASS`; the Gate proved one governed Connector side effect,
  Station replay equality, disconnect idempotency, reconnect rebasing,
  native ToolCall visibility, Connector surface visibility, and clean
  resource teardown.
