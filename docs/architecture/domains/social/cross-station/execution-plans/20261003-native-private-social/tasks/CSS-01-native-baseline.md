# CSS-01: Native-Only Baseline

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-01-native-baseline","workstreamId":"CSS-W-SOURCE","title":"Remove Browser Social registration and harden the Native Moments projection owner","workClass":"product-behavior","completionClass":"source","executionMode":"build","closureId":"slice-native-baseline","journeyId":"SOC-SEC-AS11-SOURCE","runtimeClass":"source-only","writeSet":["tooling/acceptance/gates/social/cross_station_eventbus_contract_test.py","apps/desktop/src/main.tsx","apps/desktop/src/modules/index.ts","apps/desktop/src/modules/moments/index.ts","apps/desktop/src/pages/registry.ts","apps/desktop/src/pages/moments","apps/desktop/src/services/appRuntime.ts","apps/desktop/src/runtimes/momentsRuntime.ts","apps/desktop/src/runtimes/momentsRuntime.test.ts","apps/desktop/src/kernel"],"readSet":["docs/architecture/domains/social/core","docs/architecture/domains/social/runtime/decisions.md","docs/architecture/domains/social/cross-station","docs/client/desktop/runtime-projections.md","apps/desktop/src/store/privateMoments.ts","apps/desktop/src/store/moments.ts"],"budgets":{"focusedCheckSeconds":1500,"functionalRunSeconds":1,"cleanupSeconds":300},"checks":[{"id":"native-baseline-source","command":"pnpm --dir apps/desktop exec vitest run src/pages/moments/nativeRegistration.test.ts src/runtimes/momentsRuntime.test.ts src/test/moments-store.test.ts && python3 -m unittest tooling.acceptance.gates.social.cross_station_eventbus_contract_test && git diff --check","verificationClass":"SOURCE_CHECK"}],"doneWhen":["one boot-level host policy registers Moments module/page/runtime only for a real Tauri WebView","browser-gateway source tests prove zero Social page/runtime/module/navigation/action registration","momentsRuntime fences actor/session/Station identity, clears prior projections on logout or Station switch, and owns periodic reconcile","the EventBus contract rejects orphan producers/consumers, duplicate projection owners, page freshness loops, and direct Tauri-to-store bypass","same-Station source regressions compile and pass without claiming runtime proof","one conventional commit records only this source closure"],"failureBehavior":["Browser never receives a warning-only fallback surface","an orphan event, duplicate owner, page-owned freshness loop, stale Station projection, or private listener blocks the commit","Native product behavior remains UNPROVEN until CSS-08A and CSS-09"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"PASS","ref":"native-baseline-source: 50 Vitest cases, 5 EventBus contract cases, Desktop TypeScript, Social wire/runtime boundary checks, and diff validation"}]}
```

## Current Snapshot

Same-Station Native Desktop Social works, but page/runtime/module registration
is shared with browser-gateway and no slice runner exists.

## Timebox And Checkpoint

Agent timebox: 2 hours. Commit:
`feat(social): enforce native-only social baseline`.
