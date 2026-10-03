# CSS-01: Native-Only Baseline

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-01-native-baseline","workstreamId":"CSS-W01","title":"Keep same-Station Social usable while removing Browser registration","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"slice-native-baseline","journeyId":"SOC-SEC-AS11","runtimeClass":"native-desktop","writeSet":["tooling/acceptance/capabilities/social.yaml","tooling/acceptance/domains/social.yaml","tooling/acceptance/features/social-private-moments-desktop.yaml","tooling/acceptance/gates/social","tooling/acceptance/gates.yaml","tooling/acceptance/registry.yaml","apps/desktop/src/pages/registry.ts","apps/desktop/src/services/appRuntime.ts","apps/desktop/src/modules/moments"],"readSet":["docs/architecture/social","docs/architecture/social-runtime/decisions.md","docs/architecture/cross-station-social","docs/client/desktop/runtime-projections.md","apps/desktop/src/kernel"],"budgets":{"focusedCheckSeconds":1200,"functionalRunSeconds":1200,"cleanupSeconds":300},"checks":[{"id":"native-baseline-source","command":"pnpm --dir apps/desktop exec vitest run src/pages/moments/nativeRegistration.test.ts src/test/moments-store.test.ts && python3 -m unittest tooling.acceptance.gates.social.cross_station_eventbus_contract_test && git diff --check","verificationClass":"SOURCE_CHECK"},{"id":"native-baseline-functional","command":"python3 -m tooling.acceptance.gates.social.cross_station_slice --scenario native-baseline --execution-policy development","verificationClass":"FUNCTIONAL_CHECK"}],"doneWhen":["Tauri registers and runs same-Station Social","browser-gateway has no Social page/runtime/module/navigation/action","the reusable cross-Station development runner and final Gate IDs are registered fail-closed","social-cross-station-eventbus-contract enumerates required Social event producers, typed bridge/catalog entries, the single momentsRuntime consumer, store effects, reconcile and teardown","one conventional commit records only this usable slice"],"failureBehavior":["Browser never receives a warning-only fallback surface","same-Station Social regression blocks the commit","an orphan event, duplicate projection owner, page-owned freshness loop, or module-private Tauri-to-store bypass blocks the commit","missing runtime input remains UNPROVEN"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSS-01"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending CSS-01"}]}
```

## Current Snapshot

Same-Station Native Desktop Social works, but page/runtime/module registration
is shared with browser-gateway and no slice runner exists.

## Timebox And Checkpoint

Agent timebox: 2 hours. Commit:
`feat(social): enforce native-only social baseline`.
