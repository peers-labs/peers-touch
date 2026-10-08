# PAOS-24-ATELIER-EVIDENCE - Evidence and allowed actions

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-24-ATELIER-EVIDENCE",
  "workstreamId": "PAOS-ATELIER",
  "title": "Inspect verdict evidence and allowed actions in Atelier",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-atelier-evidence",
  "journeyId": "PAOS-J03,PAOS-J04",
  "runtimeClass": "native-desktop",
  "writeSet": ["apps/station/app/subserver/agent/service/atelier_projection.go","apps/station/app/subserver/agent/service/atelier_projection_test.go","apps/applets/atelier/frontend/src/application/taskGraphEvidenceRefs.ts","apps/applets/atelier/frontend/src/application/taskGraphEvidenceRefs.test.ts","apps/applets/atelier/frontend/src/application/artifactActionGuards.ts","apps/applets/atelier/frontend/src/application/artifactActionGuards.test.ts","apps/applets/atelier/frontend/src/application/useAtelierController.ts","apps/applets/atelier/frontend/src/presentation/components/GoalEvidenceInspector.tsx","apps/desktop/src/applet/AtelierArtifactPreviewHost.ts","apps/desktop/src/applet/AtelierArtifactPreviewHost.test.ts","tooling/acceptance/gates/agent/personal_goal_atelier_e2e.py","tooling/acceptance/features/agent-personal-goal.yaml","tooling/acceptance/gates.yaml","tooling/acceptance/registry.yaml","tooling/acceptance/gates/agent/personal_goal_slices/paos_24_atelier_evidence.py"],
  "readSet": ["apps/station/app/subserver/agent/service/goal_acceptance_service.go","apps/applets/atelier/contracts/atelier-projection.contract.json"],
  "budgets": {"focusedCheckSeconds":1200,"functionalRunSeconds":1800,"cleanupSeconds":180},
  "checks": [
    {"id":"slice-runtime-capture","command":"python3 tooling/acceptance/gates/agent/personal_goal_slices/paos_24_atelier_evidence.py --mode development --require-ui --require-station-readback","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"atelier-evidence-ui","command":"pnpm --filter @peers-touch/atelier-official-applet exec vitest run src/application/taskGraphEvidenceRefs.test.ts src/application/artifactActionGuards.test.ts","verificationClass":"UX_REVIEW"},
    {"id":"atelier-evidence-functional","command":"pnpm run atelier:bridge-runtime-gate && pnpm run atelier:projection-contract-gate","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"atelier-evidence-proof","command":"python3 tooling/scripts/acceptance-run.py --gate agent-personal-goal-atelier-e2e","verificationClass":"ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Atelier shows criterion verdicts, gates, artifacts, provenance, and missing evidence","Artifact preview stays Host-owned and metadata-safe","Only actions allowed by Station state are enabled","The Atelier Goal Gate is registered and receiver-visible"],
  "failureBehavior": ["Do not render mock evidence as production proof","Do not expose provider, shell, artifact-write, gate-run, or terminal mutation authority"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: select a node, criterion, gate, or artifact.
- Visible result: provenance and allowed actions appear in the context rail.
- Station readback: every displayed evidence ref resolves to the same Goal/TaskRun.
- Lane: Atelier plus serialized Acceptance registration.
- Scope guard: only the listed user action, paths, and checks are in scope; if delivery exceeds four hours or reveals a new prerequisite, split a new Task before implementation.

## Current Snapshot

Atelier has metadata-safe evidence helpers, but no live Goal acceptance workbench.
