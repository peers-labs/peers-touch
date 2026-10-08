# PAOS-01-HOME-DRAFT - Durable Goal draft

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-01-HOME-DRAFT",
  "workstreamId": "PAOS-HOME",
  "title": "Create and reopen a durable Goal draft from Home",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-home-draft",
  "journeyId": "PAOS-J01",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent/goal.proto",
    "apps/station/app/subserver/agent/model/goal.pb.go",
    "apps/desktop/src/gen/proto/domain/agent/goal_pb.ts",
    "apps/station/app/subserver/agent/model/capability.pb.go",
    "apps/desktop/src/gen/proto/domain/agent/capability_pb.ts",
    "apps/station/app/subserver/agent/infrastructure/persistence/agent_goal.go",
    "apps/station/app/subserver/agent/infrastructure/persistence/models.go",
    "apps/station/app/subserver/agent/infrastructure/persistence/migrations/018_agent_goals.sql",
    "apps/station/app/subserver/agent/service/goal_service.go",
    "apps/station/app/subserver/agent/service/goal_service_test.go",
    "apps/station/app/subserver/agent/handler/goal_handler.go",
    "apps/station/app/subserver/agent/agent.go",
    "apps/desktop/src-tauri/build.rs",
    "apps/desktop/src-tauri/src/application/home.rs",
    "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs",
    "apps/desktop/src-tauri/src/interface/tauri_commands/home.rs",
    "apps/desktop/src-tauri/src/main.rs",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/desktop/src/services/desktop_api.home.test.ts",
    "apps/desktop/src/store/home.ts",
    "apps/desktop/src/store/home.test.ts",
    "apps/desktop/src/runtimes/homeRuntime.ts",
    "apps/desktop/src/runtimes/homeRuntime.test.ts",
    "apps/desktop/src/components/home/GoalDraftCard.tsx",
    "apps/desktop/src/pages/HomePage.tsx",
    "apps/desktop/src/pages/HomePage.test.tsx",
    "packages/locales/en/agent.json",
    "packages/locales/zh-CN/agent.json",
    "tooling/acceptance/gates/agent/personal_goal_slices/paos_01_home_draft.py",
    "tooling/skills/pt-agent-development/impact-policy.json",
    "AGENTS.md",
    "docs/global/architecture-document-standard.md",
    "docs/architecture/development-workflow/decisions.md",
    "docs/architecture/development-workflow/data-model.md",
    "docs/architecture/development-workflow/integration.md",
    "docs/architecture/development-workflow/host-neutral-agent-integration.md",
    "docs/knowledge/invariants/owner-rooted-workflow-binding.md",
    "tooling/scripts/agent-integration-control.py",
    "tooling/scripts/agent-integration-audit-test.py",
    "tooling/skills/pt-architecture-design-methodology/SKILL.md",
    "tooling/skills/pt-github-review/FRESHNESS.md",
    "tooling/plugins/pt-ew-plugin/scripts/hook-entry.mjs",
    "tooling/plugins/pt-ew-plugin/scripts/hook-entry.test.mjs"
  ],
  "readSet": [
    "model/domain/agent/home.proto",
    "apps/station/app/subserver/agent/service/home_projection_service.go",
    "docs/client/desktop/runtime-projections.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 900,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "slice-runtime-capture",
      "command": "python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_01_home_draft.py --mode development --require-ui --require-station-readback",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "home-goal-draft-source",
      "command": "bash model/build.sh && git diff --check -- model/domain/agent apps/station/app/subserver/agent apps/desktop packages/locales",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "home-goal-draft-functional",
      "command": "cd apps/station && go test ./app/subserver/agent/... -run 'Test.*Goal.*(Create|Get|Revision)' -count=1 && cd ../.. && pnpm --dir apps/desktop exec vitest run src/services/desktop_api.home.test.ts src/store/home.test.ts src/runtimes/homeRuntime.test.ts src/pages/HomePage.test.tsx",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "agent-integration-rollout-concurrency",
      "command": "python3 -m unittest tooling/scripts/agent-integration-audit-test.py && tooling/scripts/review/skill-check.sh",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Home accepts one Goal title and outcome",
    "The draft appears immediately after Station returns its id and revision",
    "Reopening the draft reads the same Station record",
    "Loading, empty, and create-error states preserve the user's text",
    "Agent integration refresh can run beside unrelated live declarations without resetting legacy binding state"
  ],
  "failureBehavior": [
    "No TaskRun starts while the Goal is DRAFT",
    "No local-only Goal placeholder is presented as saved",
    "Live child assignments, workflow actions, and action-store locks still block integration replacement"
  ],
  "updatedAt": "2026-10-04T03:32:00Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "git:e1ec7c02931ac4c65fd57ad76901d3077a9aa5cd;model-build:pass;git-diff-check:pass;agent-integration-audit:38-pass;hook-entry:5-pass;skill-check:pass;plan-validate:pass;module-governance:pass;desktop-vitest:18-pass;desktop-typecheck:pass"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "development://personal-agent-os-convergence-20261003-r4/checks/functional-result-991f412d0a1d5107a6c08b939f79ca02f6f7b6cdd42766ba83b65fb1b5c92a27.json"
    }
  ]
}
```

## Four-Hour Delivery

- User action: enter a Goal in Home, save it, leave, and reopen it.
- Visible result: a `DRAFT` Goal card with stable identity and revision.
- Station readback: create and get return the same actor-owned Goal.
- Lane: Station integration plus Home; this is the first serial foundation slice.
- Scope guard: reuse the existing Home transport and projection shell; only
  create/get draft behavior lands here, with no review, start, or TaskRun work.
- Evidence boundary: this `completionClass=functional` slice owns the
  exact-source Development Journey. Formal Acceptance remains `UNPROVEN` and is
  promoted by the later `PAOS-08-HOME-LIVE-PROGRESS` / `PAOS-30-FINAL-PROOF`
  aggregate closures; the empty `PAOS-home-draft` Gate list is intentional.

## Current Snapshot

Home can submit Chat or legacy Task work, but has no first-class Goal draft.
