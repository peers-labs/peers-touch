# CSS-09: Focused Social Release Candidate

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"CROSS-STATION-SOCIAL-NATIVE-20261003","taskId":"CSS-09-final-proof","workstreamId":"CSS-W09","title":"Certify the accumulated cross-Station private Social version","workClass":"product-behavior","completionClass":"acceptance-aggregate","executionMode":"build","closureId":"slice-final-proof","journeyId":"SOC-SEC-J10-J12","runtimeClass":"source-only","writeSet":["tooling/acceptance/capabilities/social.yaml","tooling/acceptance/domains/social.yaml","tooling/acceptance/features/social-private-moments-desktop.yaml","tooling/acceptance/gates/social","tooling/acceptance/gates.yaml","tooling/acceptance/registry.yaml","docs/architecture/cross-station-social","docs/architecture/social"],"readSet":["apps/station/frame/core/federation","apps/station/app/subserver/key_exchange","apps/station/app/subserver/social","apps/desktop/src","apps/desktop/src-tauri/src/social","docs/architecture/social-runtime/decisions.md","docs/client/desktop/runtime-projections.md","tooling/development/secure_content"],"budgets":{"focusedCheckSeconds":900,"functionalRunSeconds":9000,"cleanupSeconds":600},"checks":[{"id":"focused-social-structure","command":"python3 tooling/scripts/execution-plan.py --plan docs/architecture/cross-station-social/execution-plans/20261003-native-private-social/plan.md --ci && python3 tooling/scripts/acceptance-validate.py --domain social","verificationClass":"STRUCTURAL_CHECK"},{"id":"focused-social-proof","command":"python3 tooling/scripts/acceptance-run.py --execution-plan docs/architecture/cross-station-social/execution-plans/20261003-native-private-social/plan.md --completion","verificationClass":"ACCEPTANCE_PROOF"},{"id":"focused-social-gap-audit","command":"python3 tooling/scripts/acceptance-gap-detect.py --claim SOCIAL_CROSS_STATION_DESKTOP_PROVEN --plan docs/architecture/cross-station-social/execution-plans/20261003-native-private-social/plan.md --require-gate social-cross-station-eventbus-contract --require-gate social-cross-station-native-e2e --require-gate browser-social-zero-registration --require-gate social-private-desktop-e2e","verificationClass":"STRUCTURAL_CHECK"}],"doneWhen":["AS11 and AS17 through AS24 are PROVEN on current source","same-Station Social remains PROVEN","social-cross-station-eventbus-contract proves complete typed producer-to-runtime wiring, one momentsRuntime projection owner, reconcile, scope teardown and no direct module-private bypass","the Native two-client Gate proves hidden-page immediate refresh, duplicate idempotence and dropped-event recovery","reports bind exact actors, devices, Stations, runtime and cleanup","Mobile remains deferred and unproven","one conventional commit records the release-candidate plan/evidence state"],"failureBehavior":["missing or stale receiver evidence remains UNPROVEN","an orphan event, duplicate owner, page-owned refresh, private Tauri-to-store listener, missing reconcile, or stale actor subscription blocks proof","a static EventBus contract check cannot substitute for Native receiver-visible evidence","no repository-wide or unrelated domain Gate is substituted or added","all clients, processes, fixtures, ports and leases release on every exit"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"STRUCTURAL_CHECK","result":"NOT_RUN","ref":"pending CSS-09"},{"verificationClass":"ACCEPTANCE_PROOF","result":"NOT_RUN","ref":"pending CSS-09"}]}
```

## Current Snapshot

CSS-08 provides the full planned behavior, but the combined exact-source Social
claim has not been run.

## Timebox And Checkpoint

Agent timebox: 4 hours. Commit:
`test(social): certify cross-station private social`.

All Gates reuse one exact-source two-Station Suite Runtime and attach-only
clients; per-Gate rebuild, redeploy, account creation, or login is forbidden.
