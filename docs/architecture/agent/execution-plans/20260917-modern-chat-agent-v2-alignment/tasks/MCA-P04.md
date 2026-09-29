# MCA-P04 - CLI Provider Primary Agent Journey

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-P04",
  "workstreamId": "MCA-P04",
  "title": "Restore the usable CLI Provider Agent journey",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "V2-agent-cli-provider-primary",
  "journeyId": "V2-agent-cli-provider-primary",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/station/app/subserver/agent/agent.go",
    "apps/station/app/subserver/agent/catalog/providers.default.yaml",
    "apps/station/app/subserver/agent/service/cli",
    "apps/station/app/subserver/agent/service/provider_config_service.go",
    "apps/station/app/subserver/agent/service/provider_config_service_test.go",
    "apps/station/app/subserver/agent/service/provider_service.go",
    "apps/station/app/subserver/agent/service/provider_stream_test.go",
    "apps/station/app/subserver/agent/service/runtime_admission_service.go",
    "apps/station/app/subserver/agent/service/runtime_admission_service_test.go",
    "apps/station/app/subserver/agent/service/turn_service.go",
    "apps/station/app/subserver/agent/handler/provider_handler.go",
    "apps/station/app/subserver/agent/handler/provider_handler_readiness_test.go",
    "apps/station/app/subserver/agent/handler/turn_handler.go",
    "apps/station/app/subserver/agent/handler/turn_runtime_profile_test.go",
    "apps/desktop/src/acceptance/agent/harness.ts",
    "tooling/acceptance/capabilities/agent.yaml",
    "tooling/acceptance/domains/agent.yaml",
    "tooling/acceptance/features/agent-cli-provider-primary.yaml",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/gates/agent/native_agent_runner.py",
    "tooling/acceptance/gates/agent/native_agent_runner_test.py",
    "tooling/acceptance/matrices/agent-cli-provider-primary-native.yaml",
    "tooling/acceptance/provisioners/home_station.py",
    "tooling/acceptance/registry.yaml",
    "tooling/acceptance/tests/test_provisioner_runtime.py",
    "tooling/docker/compose.yml",
    "tooling/scripts/deploy/deploy.sh",
    "docs/architecture/agent/modern-chat-agent",
    "docs/architecture/agent/execution-plans/20260917-modern-chat-agent-v2-alignment"
  ],
  "readSet": [
    "apps/desktop/src/store/agent.ts",
    "apps/desktop/src/store/agentTopics.ts",
    "apps/desktop/src/store/chat.ts",
    "apps/desktop/src-tauri/src/application/agent_turn",
    "apps/desktop/src-tauri/src/application/provider"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "agent-cli-provider-source",
      "command": "cd apps/station && go test ./app/subserver/agent/service/... ./app/subserver/agent/handler -count=1 && cd ../.. && pnpm --dir apps/desktop check && python3 -m unittest tooling.acceptance.gates.agent.native_agent_runner_test tooling.acceptance.tests.test_provisioner_runtime",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "agent-cli-provider-functional",
      "command": "cd apps/station && go test ./app/subserver/agent/service/... -run 'Test(Executor|ProviderService.*CLI|ProviderCallWithRetryBypassesCredentialLeaseForCLI)' -count=1",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "agent-cli-provider-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item MCA-P04 --gate agent-cli-provider-primary-native-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "A built-in CLI Provider is discoverable and selectable without HTTP endpoint or API-key configuration",
    "Creating an Agent with the CLI Provider persists one Station-owned Agent and opens an empty topic",
    "Sending a prompt executes the configured CLI adapter and streams a non-empty Assistant response",
    "The user message, terminal Assistant message, Turn, and provider identity are Station-backed",
    "Restarting the native client restores the topic and completed response from Station",
    "Failure to locate or execute the CLI is typed, visible, and does not fabricate a successful response",
    "The exact-source Native CLI Provider Journey passes with clean process and fixture teardown"
  ],
  "failureBehavior": [
    "Do not model a one-shot CLI Provider as a stateful EXTERNAL_AGENT runtime",
    "Do not restore Desktop-only conversation truth or bypass Station persistence",
    "Do not require HTTP provider credentials for CLI execution",
    "Do not log CLI credentials, prompts, or unrestricted local paths"
  ],
  "updatedAt": "2026-09-29T02:20:00Z",
  "durableEvidence": []
}
```

## Objective

Restore the previously implemented CLI Provider path as the first usable Agent
conversation route while keeping Station authoritative for Agent, topic,
message, Turn, and terminal state.

## Current Snapshot

- Built-in CLI Provider catalog records, command normalization, Desktop
  discovery, error mapping, and deployment mounts still exist.
- Historical commits `84391ed7f` and `674d1d0c7` prove working Desktop-local
  and Station-local CLI execution implementations existed.
- The V2 hard cut removed the Station executor and now rejects CLI providers
  before execution, leaving the product with no non-rate-limited primary path.
- A one-shot CLI invocation receives complete prompt context and owns no
  reusable external session; it is a `DIRECT_MODEL` transport, not P12.
