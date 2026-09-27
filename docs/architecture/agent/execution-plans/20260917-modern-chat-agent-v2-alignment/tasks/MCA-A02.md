# MCA-A02 - Home Formal Candidate Closure

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-A02",
  "workstreamId": "MCA-A02",
  "title": "Produce the complete V2-J01 Home formal candidate",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "V2-J01-formal-candidate",
  "journeyId": "V2-J01",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/station/app/subserver/agent/service/home_projection_service.go",
    "apps/station/app/subserver/agent/service/home_projection_service_test.go",
    "apps/station/app/subserver/agent/service/home_command_service.go",
    "apps/station/app/subserver/agent/service/home_command_service_test.go",
    "apps/desktop/src/runtimes/homeRuntime.ts",
    "apps/desktop/src/runtimes/homeRuntime.test.ts",
    "apps/desktop/src/store/home.ts",
    "apps/desktop/src/store/home.test.ts",
    "apps/desktop/src/pages/HomePage.tsx",
    "apps/desktop/src/acceptance/agent",
    "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
    "apps/mobile/src/contracts/agentV2Contract.test.ts",
    "tooling/acceptance/provisioners/home_station.py",
    "tooling/acceptance/gates/agent/home_command_center_candidate.py",
    "tooling/acceptance/gates/agent/home_command_center_candidate_test.py"
  ],
  "readSet": [
    "apps/station/app/subserver/agent/handler/home_handler.go",
    "model/domain/agent/home.proto",
    "tooling/acceptance/environments/home-station.yaml",
    "tooling/acceptance/gates/agent/agent_v2_candidate_producer.py",
    "tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 7200,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "home-product-owner-tests",
      "command": "go test ./apps/station/app/subserver/agent/service -run '^TestHome' && pnpm --dir apps/desktop exec vitest run src/runtimes/homeRuntime.test.ts src/store/home.test.ts && pnpm --dir apps/mobile exec vitest run src/contracts/agentV2Contract.test.ts && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --offline interface::http_gateway::tests::agent_task_commands_route_through_http_gateway_dispatch",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "home-candidate-tests",
      "command": "python3 -m unittest tooling.acceptance.gates.agent.home_command_center_candidate_test",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "home-candidate-functional",
      "command": "python3 tooling/acceptance/gates/agent/home_command_center_candidate.py",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Station marks a projection older than after_revision as stale without mutating its authoritative revision, and Desktop preserves the last accepted data with an explicit retry path",
    "Chat and Task duplicate submissions execute both reviewed idempotency orderings through controlled barriers and preserve one durable resource identity",
    "Mobile contract cell AS-15-V2-H01 round-trips Home projection and command contracts without claiming Mobile UI parity or local authority",
    "Home Station provisioning allocates the required clients and the Desktop Harness exposes only namespaced Home Journey actions",
    "Browser routes the complete existing Station-owned Task command family through the Rust HTTP gateway with the same authenticated boundary as Native",
    "A repository-owned Home Journey executes every 33-tuple Desktop, Browser, and Mobile-contract cell on exact source",
    "Every tuple has a unique scenarioExecutionId and runtime-truthful station_command or contract_only attestation",
    "The candidate passes the full semantic candidate validator and cleanup is clean",
    "Historical manual J01 evidence is not imported or relabelled"
  ],
  "failureBehavior": [
    "Keep agent-v2-home-command-center-e2e UNPROVEN",
    "Stop on the first missing Home provisioner, receiver, Station, replay, barrier, or cleanup fact",
    "Return product defects to the Home Journey rather than synthesizing role observations"
  ],
  "updatedAt": "2026-09-18T18:17:00Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "git:d31bc3bae6974872dad7939a78da9a63f0942e97;station-home-tests:pass;desktop-home-tests:pass;desktop-typecheck:pass;mobile-contract:16-pass;home-candidate-tests:5-pass;http-gateway-task-test:pass;plan-validate:pass"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "git:d31bc3bae6974872dad7939a78da9a63f0942e97;profile:two;station:station-two;runtime:native-tauri+browser+mobile-contract;tuples:33;proofStatus:CANDIDATE;manifest:/Users/developer/.peers-touch/dev/workspaces/65e7b6da4dc9be85/workflow/MCA-A02-PR112/artifacts/20260918T180520701936Z/home-candidate/65e7b6da4dc9be85/agent-v2-home-command-center-e2e/20260918T180520809806Z-cde737f7ace498eecd0a8f07757ba090/manifest.json;cleanup:clean;formalPromotion:MCA-A08"
    }
  ]
}
```

## Objective

Close the exact-source J01 formal-candidate gap with production Home commands,
projection readback, Browser parity, Mobile contract evidence, and clean
resource release.

## Current Snapshot

- Historical J01 functional evidence is stale and manually driven.
- Station ignores `after_revision`, so `HOME_STALE` and ERR-H01 are not
  reachable through production behavior.
- Home has no Gate client allocation, namespaced Harness actions, repository
  runner, executable R-11 barriers, or Mobile AS-15-V2-H01 contract cell.
- Final `PROVEN` promotion remains owned by MCA-A08.
