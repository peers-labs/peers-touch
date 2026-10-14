# DUI-09 - Agent profile and capability closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-09-AGENT-PROFILE","workstreamId":"DUI-AGENT","title":"Close AI6-AI11 and AI15 through Station Agent identity and capability authority","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"dui-agent-profile","journeyId":"DUI-AI6-AI11-AI15","runtimeClass":"native-desktop","writeSet":["apps/desktop","apps/station/app/subserver/agent","model/domain/agent","packages/locales","docs/architecture/domains/agent"],"readSet":["docs/architecture/domains/agent/modern-chat-agent","docs/client/desktop/runtime-projections.md"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":4800,"cleanupSeconds":240},"checks":[{"id":"dui-agent-profile-source","command":"pnpm --dir apps/desktop run check && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml && cd apps/station && go test ./app/subserver/agent/...","verificationClass":"SOURCE_CHECK"},{"id":"dui-agent-profile-functional","command":"pnpm --dir apps/desktop exec vitest run src/store/agent.test.ts src/store/agentCapabilities.test.ts src/components/agent/create/agentCreateFlow.test.ts src/components/agent/workbench/workbench.contract.test.ts","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-agent-profile-proof","command":"python3 tooling/scripts/acceptance-run.py --gate agent-v2-capability-binding-e2e && python3 tooling/scripts/acceptance-run.py --gate agent-quick-completion-e2e && python3 tooling/scripts/acceptance-run.py --gate agent-workspace-e2e","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Agent roster and CRUD are Station-backed","SOUL, AGENTS, system prompt, model/effort, and workspace isolation save with revision conflict handling","Governed tools, skills, MCP, connectors, and knowledge show real readiness and approval policy","Builder quick completion is live","The fictional temperature field and localStorage Agent authority are absent"],"failureBehavior":["Reject stale Agent revisions","Never bypass capability authority or workspace isolation","Do not retain duplicate local Agent configuration truth"],"updatedAt":"2026-10-14T08:43:26.000Z"}
```

## Objective

Make Agent identity, configuration, Builder assistance, and capability bindings
one Station-owned product journey.

## Current Snapshot

- AI6-AI11 and AI15 have no alignment delta.
