# MCA-J06 - Evaluation Lab

## Task Slice

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-J06",
  "workstreamId": "MCA-J06",
  "title": "Station-owned Evaluation Lab functional closure",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "V2-J06-functional",
  "journeyId": "V2-J06",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop",
    "apps/station/app/subserver/agent",
    "model/domain/agent",
    "packages/locales",
    "tooling/acceptance",
    "docs/client",
    "docs/architecture/agent"
  ],
  "readSet": [
    "docs/architecture/agent/modern-chat-agent"
  ],
  "budgets": {
    "focusedCheckSeconds": 1500,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 240
  },
  "checks": [
    {
      "id": "evaluation-focused",
      "command": "pnpm --dir apps/desktop exec vitest run src/store/evaluation.test.ts src/pages/EvaluationPage.test.tsx --passWithNoTests && (cd apps/station && go test ./app/subserver/agent/... -run 'Evaluation|Eval')",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "evaluation-native-journey",
      "command": "python3 tooling/acceptance/gates/agent/evaluation_development.py",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Station owns benchmark, dataset, test case, run, attempt, result, metrics, and retention truth",
    "Evaluation uses the canonical Turn kernel with an immutable Agent/runtime/config snapshot",
    "Cancel, partial cancellation, failed-case retry, duplicate scheduler, and metrics lineage settle deterministically",
    "Desktop restart restores authoritative run state, results, and recovery actions"
  ],
  "failureBehavior": [
    "Delete localStorage and quickCompletion as Evaluation authorities in the same cutover",
    "Do not mutate terminal parent runs or duplicate completed work on retry",
    "Do not infer terminal state from client progress"
  ],
  "updatedAt": "2026-09-17T10:48:56Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "git:3549ce0a953db1bcf1f02e46db8c8c3c09c4e74d;model:build-pass;station:agent-suite-pass;station:evaluation-race-pass;desktop:tsc-pass;desktop:vitest-13-pass;desktop:rust-evaluation-3-pass;acceptance:j06-contract-21-pass"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "BLOCKED",
      "ref": "profile:two;error:PROFILE_UNAVAILABLE;source:3549ce0a953db1bcf1f02e46db8c8c3c09c4e74d;diagnostic:<env-repo>/peers-touch/two/profile.env.example"
    }
  ]
}
```

## Objective

Replace the current client-owned Evaluation loop with the accepted Station
Evaluation aggregate and prove V2-J06 end to end.

## Current Snapshot

- Station owns the actor-scoped benchmark, dataset, case, run, attempt,
  result, event, metrics, cancellation, retry, and retention aggregate.
- Every case enters the canonical Turn kernel with a Station-authored frozen
  Agent/runtime/readiness snapshot; restart fences interrupted Turns instead
  of replaying provider or tool side effects.
- Desktop uses the `evaluation` runtime and Station-backed store, with
  `on-visit + lru(1)` page lifetime and no Evaluation `localStorage` or
  `quickCompletion` authority. Definition child mutations return authoritative
  parent revisions so consecutive edits do not depend on optimistic version
  inference.
- Focused Go/race, TypeScript/Vitest, Rust bridge, proto coverage, Acceptance
  contract, and plan validation checks pass.
- Source checkpoint:
  `3549ce0a953db1bcf1f02e46db8c8c3c09c4e74d`.
- Exact-source Profile `two` native Journey is `BLOCKED/UNPROVEN` because the
  canonical environment definition is dirty; no runtime resource was acquired.
