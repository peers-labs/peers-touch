# DUI-11 - Agent product surfaces closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-11-AGENT-SURFACES","workstreamId":"DUI-AGENT","title":"Close AI16-AI18 through Evaluation, portability, and Home projections","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"dui-agent-surfaces","journeyId":"DUI-AI16-AI18","runtimeClass":"native-desktop","writeSet":["apps/desktop","apps/station/app/subserver/agent","model/domain/agent","packages/locales","docs/architecture/domains/agent"],"readSet":["docs/architecture/domains/agent/modern-chat-agent","docs/client/desktop/runtime-projections.md"],"budgets":{"focusedCheckSeconds":1800,"functionalRunSeconds":4200,"cleanupSeconds":240},"checks":[{"id":"dui-agent-surfaces-source","command":"pnpm --dir apps/desktop run check && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml && cd apps/station && go test ./app/subserver/agent/...","verificationClass":"SOURCE_CHECK"},{"id":"dui-agent-surfaces-functional","command":"pnpm --dir apps/desktop exec vitest run src/pages/EvaluationPage.test.tsx src/runtimes/evaluationRuntime.test.ts src/runtimes/homeRuntime.test.ts src/store/home.test.ts","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-agent-surfaces-proof","command":"python3 tooling/scripts/acceptance-run.py --gate agent-v2-evaluation-lab-e2e && python3 tooling/scripts/acceptance-run.py --gate agent-v2-home-command-center-e2e && python3 tooling/scripts/acceptance-run.py --gate agent-ecosystem-e2e","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Evaluation lists and runs are Station-backed","Agent export/import round-trips the accepted package contract","Home pinned agents, topics, tasks, and selectors come from the Home projection","No mock benchmark or work row remains"],"failureBehavior":["Never import an unverified Agent package","Never infer Evaluation success from local UI state","Do not create a second Home projection in the page"],"updatedAt":"2026-10-14T08:43:26.000Z"}
```

## Objective

Finish the non-chat Agent surfaces that make configured Agents reusable and
observable.

## Current Snapshot

- AI16-AI18 have no alignment delta.
