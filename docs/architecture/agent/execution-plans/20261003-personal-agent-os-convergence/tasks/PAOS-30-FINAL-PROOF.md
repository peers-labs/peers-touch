# PAOS-30-FINAL-PROOF - Exact-source product proof

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "personal-agent-os-convergence-20261003",
  "taskId": "PAOS-30-FINAL-PROOF",
  "workstreamId": "PAOS-DELIVERY",
  "title": "Prove the complete Personal Agent OS journey",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "PAOS-final-proof",
  "journeyId": "PAOS-J01,PAOS-J02,PAOS-J03,PAOS-J04",
  "runtimeClass": "native-desktop",
  "writeSet": ["tooling/acceptance/gates/agent/personal_goal_architecture_guard.py","tooling/acceptance/gates/agent/personal_goal_os_e2e.py","tooling/acceptance/features/agent-personal-goal.yaml","tooling/acceptance/capabilities/agent.yaml","tooling/acceptance/domains/agent.yaml","tooling/acceptance/environments/home-station.yaml","tooling/acceptance/gates.yaml","tooling/acceptance/registry.yaml","docs/architecture/agent/README.md","docs/architecture/agent/proposals/20261003-personal-agent-os.md","docs/architecture/architecture-module-governance/architecture-modules.json","docs/README.md"],
  "readSet": ["model/domain/agent","model/domain/realtime","apps/station/app/subserver/agent","apps/station/app/subserver/events","apps/desktop","apps/applets/atelier","docs/architecture/atelier","docs/architecture/acceptance-framework"],
  "budgets": {"focusedCheckSeconds":1800,"functionalRunSeconds":3600,"cleanupSeconds":300},
  "runtimeReuse": {"scope":"suite","entryCheckId":"personal-agent-os-functional","scenarioIds":["desktop-direct-goal","desktop-external-goal","browser-readback","actor-device-isolation","restart-acceptance-readback","overflow-resync"],"maxProvisioningRuns":1,"maxClientLaunches":5,"minWarmReuseRate":0.8,"requireAttachOnlyScenarios":true,"requireReceiverVisibleProof":true,"allowClientReplacement":true},
  "checks": [
    {"id":"personal-agent-os-source","command":"bash model/build.sh && cd apps/station && go test ./app/subserver/agent/... ./app/subserver/events/... -count=1 && cd ../.. && pnpm --dir apps/desktop check && pnpm --filter @peers-touch/atelier-official-applet run check","verificationClass":"SOURCE_CHECK"},
    {"id":"personal-agent-os-functional","command":"python3 tooling/acceptance/gates/agent/personal_goal_os_e2e.py --mode development","verificationClass":"FUNCTIONAL_CHECK"},
    {"id":"personal-agent-os-architecture-proof","command":"python3 tooling/scripts/acceptance-run.py --gate agent-personal-goal-architecture-guard","verificationClass":"ACCEPTANCE_PROOF"},
    {"id":"personal-agent-os-proof","command":"python3 tooling/scripts/acceptance-run.py --gate agent-personal-goal-os-e2e","verificationClass":"ACCEPTANCE_PROOF"}
  ],
  "doneWhen": ["Desktop completes create, review, start, observe, intervene, accept, and restart readback","Home and Atelier show the same Station truth across all required UI states","Direct Model and one external runtime pass on exact source","Architecture guard proves no private fan-out, metadata authority, self-acceptance, or legacy task owner remains"],
  "failureBehavior": ["Any missing runtime cell leaves the product UNPROVEN","Do not infer Mobile, multi-Agent Canvas, or unexecuted runtime proof"],
  "updatedAt": "2026-10-03T00:00:00Z",
  "durableEvidence": []
}
```

## Four-Hour Delivery

- User action: complete the full Desktop journey and reopen it in browser read-only mode.
- Visible result: both surfaces agree on Goal, graph, decisions, evidence, and verdict.
- Station readback: every user-visible claim is tied to exact-source evidence.
- Lane: final serialized integration.
- Scope guard: this slice only composes and runs scenario adapters delivered by
  earlier Tasks; missing behavior returns to its owning Task instead of growing
  the final proof slice.

## Current Snapshot

Controlled/static evidence exists, but the complete product journey remains unproven.
