# DUI-16 - Network discovery closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-16-NETWORK-DISCOVERY","workstreamId":"DUI-NETWORK","title":"Close N1-N5 through privacy-safe Federation discovery and operator controls","workClass":"product-behavior","completionClass":"functional","executionMode":"fix","closureId":"dui-network-discovery","journeyId":"DUI-N1-N5","runtimeClass":"service","writeSet":["apps/desktop","apps/station/app/subserver/federation","apps/station/app/subserver/dashboard","apps/station/frame/core/federation","apps/station/frame/touch","model/domain/actor","model/domain/federation","packages/locales","docs/architecture/domains/federation","docs/architecture/domains/identity/federation-catalog.md"],"readSet":["docs/architecture/domains/federation","docs/architecture/domains/identity/federation-catalog.md","docs/client/desktop/runtime-projections.md"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":4800,"cleanupSeconds":300},"checks":[{"id":"dui-network-discovery-source","command":"cd apps/station && go test ./app/subserver/federation/... ./frame/touch/actor/... && cd ../desktop && pnpm run check","verificationClass":"SOURCE_CHECK"},{"id":"dui-network-discovery-functional","command":"cd apps/station && go test ./app/subserver/federation/... -run 'Test.*Catalog|Test.*Visibility|Test.*ContactPolicy' -count=1","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-network-discovery-proof","command":"python3 tooling/scripts/acceptance-run.py --gate station-federation-unit && python3 tooling/scripts/acceptance-run.py --gate federation-domain-validation","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Global and per-Federation visibility persist and filter locator/catalog exposure","Inbound contact policy is enforced by the receiver","Catalog fan-out, partial results, pagination, timeout, and abuse limits are deterministic","Operator Dashboard owns the serve switch and metrics while user Settings only shows user choices"],"failureBehavior":["Fail closed when Federation scope or membership is unknown","Never widen scoped visibility beyond the global value","Never expose fabricated catalog counts or operator controls in user Settings"],"updatedAt":"2026-10-14T08:43:26.000Z"}
```

## Objective

Finish the discovery privacy contract from Actor profile through cross-Station
catalog aggregation and operator policy.

## Current Snapshot

- N1-N4 are implemented/unproven.
- N5 is partial because operator Dashboard control and metrics are missing.
