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
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item mca-v2-j06 --gate agent-v2-evaluation-lab-e2e",
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
  "updatedAt": "2026-09-16T16:36:26Z",
  "durableEvidence": []
}
```

## Objective

Replace the current client-owned Evaluation loop with the accepted Station
Evaluation aggregate and prove V2-J06 end to end.

## Current Snapshot

- Evaluation UI, client-local datasets/runs, and Station dataset CRUD exist.
- The client still uses `localStorage` and `quickCompletion` as terminal truth.
- Station run/attempt/result/metrics ownership and restart proof remain absent.
