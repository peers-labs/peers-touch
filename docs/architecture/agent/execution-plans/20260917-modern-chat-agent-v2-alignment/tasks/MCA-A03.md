# MCA-A03 - Capability Binding Formal Candidate Closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-A03",
  "workstreamId": "MCA-A03",
  "title": "Produce the complete V2-J02 capability formal candidate",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "V2-J02-formal-candidate",
  "journeyId": "V2-J02",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src/hooks/useCommandMenuItems.ts",
    "apps/desktop/src/pages/CustomPluginsPage.descriptor.tsx",
    "apps/desktop/src/pages/CustomPluginsPage.tsx",
    "apps/desktop/src/pages/CustomPluginsPageContainer.tsx",
    "apps/desktop/src/pages/registry.ts",
    "apps/desktop/src/store/customPlugins.ts",
    "apps/desktop/src/types/navigation.ts",
    "apps/desktop/src/components/agent/AgentCapabilityInventoryPanel.tsx",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/desktop/src/store/agentCapabilities.ts",
    "apps/desktop/src/gen/proto/domain/agent/ecosystem_pb.ts",
    "apps/desktop/src/gen/proto/domain/agent/capability_pb.ts",
    "apps/desktop/src/acceptance/agent",
    "apps/desktop/src/i18n/index.test.ts",
    "apps/desktop/src/i18n/index.ts",
    "apps/desktop/src/kernel/retiredStorage.test.ts",
    "apps/desktop/src/kernel/retiredStorage.ts",
    "apps/desktop/src/main.tsx",
    "apps/desktop/src-tauri/src/application/capability_authority.rs",
    "apps/desktop/src-tauri/src/infrastructure/station_client.rs",
    "apps/desktop/src-tauri/src/interface",
    "apps/mobile/src/gen/proto/domain/agent/ecosystem_pb.ts",
    "apps/mobile/src/gen/proto/domain/agent/capability_pb.ts",
    "apps/mobile/src/contracts/agentV2Contract.test.ts",
    "apps/station/app/subserver/agent",
    "docs/architecture/agent/modern-chat-agent",
    "docs/architecture/agent/modules/custom-plugins",
    "docs/architecture/agent/modules/localstorage-migration/interface-design.md",
    "model/domain/agent/capability.proto",
    "model/domain/agent/ecosystem.proto",
    "packages/locales/en/agent.json",
    "packages/locales/zh-CN/agent.json",
    "tooling/acceptance",
    "tooling/docker/compose.yml",
    "tooling/scripts/deploy/deploy.sh"
  ],
  "readSet": [
    "docs/architecture/agent/execution-plans/20260817-modern-chat-agent-v2-execution.md",
    "docs/architecture/agent/modern-chat-agent/data-model.md",
    "tooling/acceptance/gates/agent/agent_v2_candidate_producer.py",
    "tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 7200,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "custom-plugin-retirement-hard-cut",
      "command": "./model/build.sh && cmp apps/desktop/src/gen/proto/domain/agent/ecosystem_pb.ts apps/mobile/src/gen/proto/domain/agent/ecosystem_pb.ts && (cd apps/station && go test ./app/subserver/agent/...) && (cd apps/desktop && pnpm run check && pnpm exec vitest run src/kernel/retiredStorage.test.ts) && (cd apps/mobile && pnpm run check && pnpm run test:agent-contract) && tooling/scripts/review/agent-v2-old-paths.sh --closure C14-CUSTOM-PLUGIN",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "binding-candidate-tests",
      "command": "bash -n tooling/scripts/deploy/deploy.sh && python3 -m unittest tooling.acceptance.gates.agent.capability_binding_development_test tooling.acceptance.gates.agent.capability_binding_candidate_test tooling.acceptance.tests.test_profile_lease.ProfileLeaseTests.test_deploy_script_forwards_only_valid_capability_scenario_environment",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "binding-candidate-functional",
      "command": "python3 tooling/acceptance/gates/agent/capability_binding_development.py --formal-candidate",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "The rejected Custom HTTP Plugin is hard-deleted across Desktop page, command, navigation, store, direct fetch, local credential storage, proto and generated contracts, Station routes, handlers, services, persistence registration, rows, and table ownership",
    "The retirement records only actor-scoped counts and non-secret metadata hashes before purge; it never imports, copies, logs, or backs up authValue",
    "Former page, command, and CRUD route access is unavailable after restart, the localStorage and Station fixtures are absent, direct network count is zero, and the C14-CUSTOM-PLUGIN old-path closure has zero unresolved matches",
    "All 69 reviewed tuples execute with distinct station_control_plane, contract_only, or orchestration_guard identities",
    "The MCA-D22 scenario controller is unavailable outside the explicitly enabled Acceptance environment and emits no verdict or evidence role",
    "ERR-CAT01-CAT03 and ERR-B01-B03 use exact typed product errors with bounded safe details and preserve authoritative revisions on rejection",
    "TAX-01-TAX-06 execute as distinct state transitions; AS-10 proves cross-actor and cross-device rejection",
    "Readiness, zero-execution, CAS, retirement, receiver, replay, and cleanup observations cover exactly their applicable tuples",
    "The candidate passes the full semantic validator on exact source",
    "No manifest, binding, or readiness fact is inferred from labels or static fixture content"
  ],
  "failureBehavior": [
    "Keep agent-v2-capability-binding-e2e UNPROVEN",
    "Fail closed on any retained Custom Plugin credential, row, table, symbol, route, direct request, automatic import, compatibility path, or secret-bearing evidence",
    "Reject any missing Station authority revision or reused execution identity",
    "Do not convert retirement or Mobile contract rows into fake runtime turns"
  ],
  "updatedAt": "2026-09-19T00:49:00Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "git:545d456004ab8fe19b071fe586744472cfd34035;binding-candidate-tests:17-pass;desktop-i18n-capability-tests:52-pass;desktop-typecheck:pass;desktop-acceptance-cargo-check:pass;station-barrier-test:pass;acceptance-driver-build:pass;gap-detector-tests:23-pass"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "git:545d456004ab8fe19b071fe586744472cfd34035;profile:two;station:station-two;runtime:native-tauri+browser+mobile-contract+orchestration-guard;tuples:69;uniqueExecutionIds:69;proofStatus:CANDIDATE;manifest:/Users/developer/.peers-touch/dev/workspaces/65e7b6da4dc9be85/workflow/MCA-A03-PR112/artifacts/20260919T003230167758Z/capability-binding-candidate/65e7b6da4dc9be85/agent-v2-capability-binding-e2e/20260919T003046912371Z-3b620054574b4d7087b9f4d53c952248/manifest.json;cleanup:clean;formalPromotion:MCA-A08"
    }
  ]
}
```

## Objective

Promote the existing capability Development Journey into a tuple-aware,
runtime-truthful formal candidate without duplicating capability authority.
This closure also owns the independent rejected Custom HTTP Plugin retirement
required by its `AS-16-CUSTOM-PLUGIN-RETIREMENT` orchestration-guard tuple.
It does not pull forward C13 CapabilityOperation activation, Connector
resource activation, or C15 Evaluation cutover from their dependent closures.

## Current Snapshot

- The composite Native J02 Journey has passed previously.
- The rejected Custom HTTP Plugin hard cut is committed at `25e09d3ab`.
- MCA-D22 is accepted and supplies the missing deterministic scenario-control
  boundary for catalog, binding, taxonomy, and isolation cells.
- Browser, Mobile-contract, orchestration-guard, and exact per-tuple candidate
  adapters remain to be implemented.
- Final `PROVEN` promotion remains owned by MCA-A08.
