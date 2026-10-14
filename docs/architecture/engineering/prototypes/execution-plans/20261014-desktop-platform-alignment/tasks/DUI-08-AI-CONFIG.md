# DUI-08 - AI configuration closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-08-AI-CONFIG","workstreamId":"DUI-AGENT","title":"Close AI1-AI5 through Station-owned provider, model, memory, skill, and MCP configuration","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"dui-ai-config","journeyId":"DUI-AI1-AI5","runtimeClass":"native-desktop","writeSet":["apps/desktop","apps/station/app/subserver/agent","model/domain/agent","packages/locales","docs/architecture/domains/agent"],"readSet":["docs/architecture/domains/agent/modern-chat-agent","docs/client/desktop/runtime-projections.md"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":4800,"cleanupSeconds":240},"checks":[{"id":"dui-ai-config-source","command":"pnpm --dir apps/desktop run check && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml && cd apps/station && go test ./app/subserver/agent/...","verificationClass":"SOURCE_CHECK"},{"id":"dui-ai-config-functional","command":"pnpm --dir apps/desktop exec vitest run src/store/provider.test.ts src/services/mcp-service.test.ts src/store/mcp.test.ts src/components/agent/AgentCapabilityInventoryPanel.test.ts","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-ai-config-proof","command":"python3 tooling/scripts/acceptance-run.py --gate agent-provider-credential-e2e && python3 tooling/scripts/acceptance-run.py --gate agent-memory-e2e && python3 tooling/scripts/acceptance-run.py --gate agent-skill-e2e && python3 tooling/scripts/acceptance-run.py --gate agent-v2-mcp-lifecycle-e2e","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Provider credentials, base URLs, model availability, and tests are real","Model UI uses accepted scenario routing","Memory configuration and CRUD/import/export use Station truth","Skill import/verification/versioning and MCP reconcile/readiness are live","No mock provider, model, embedding, scan, DSN, or latency result remains"],"failureBehavior":["Never expose stored secrets in read projections","Never infer MCP execution owner from transport","Never convert a failed readiness check into a fake success metric"],"updatedAt":"2026-10-14T08:43:26.000Z"}
```

## Objective

Replace the AI settings mock layer with the existing Station-owned control
planes.

## Current Snapshot

- AI1-AI5 have no alignment delta.
