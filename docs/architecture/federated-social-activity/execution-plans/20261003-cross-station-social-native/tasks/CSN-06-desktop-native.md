# CSN-06: Desktop Native Product Closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"SOCIAL-CROSS-STATION-NATIVE-20261003","taskId":"CSN-06-desktop-native","workstreamId":"CSN-W06","title":"Expose cross-Station Social on Native Desktop and remove Browser Social","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"cross-station-desktop","journeyId":"SOC-SEC-J10-J12","runtimeClass":"native-desktop","writeSet":["apps/desktop/src-tauri/src/social","apps/desktop/src/services/privateMomentsNative.ts","apps/desktop/src/store/privateMoments.ts","apps/desktop/src/runtimes/momentsRuntime.ts","apps/desktop/src/pages/moments","apps/desktop/src/pages/registry.ts"],"readSet":["model/domain/social","apps/station/app/subserver/social","docs/architecture/social","docs/architecture/federated-social-activity"],"budgets":{"focusedCheckSeconds":3600,"functionalRunSeconds":3600,"cleanupSeconds":180},"checks":[{"id":"cross-station-desktop-source","command":"cd apps/desktop && pnpm run check && cargo check --manifest-path src-tauri/Cargo.toml","verificationClass":"SOURCE_CHECK"},{"id":"social-cross-station-desktop-functional","command":"python3 tooling/scripts/acceptance-run.py --gate social-cross-station-desktop-functional","verificationClass":"FUNCTIONAL_CHECK"},{"id":"browser-social-zero-registration","command":"python3 tooling/scripts/acceptance-run.py --gate browser-social-zero-registration","verificationClass":"STRUCTURAL_CHECK"}],"doneWhen":["Native Desktop renders remote pending, retrying, source unavailable, ready, recovery and revoked states","momentsRuntime owns event consumption and periodic reconcile","Desktop Rust verifies remote source proof before decryption","Browser page, runtime, navigation and Social action registration are absent","Mobile has no product implementation changes"],"failureBehavior":["page mount never owns projection freshness","account or Station switch clears prior actor private state","offline verified content may remain visible but new remote operations fail explicitly","Browser has no public or private Social fallback"],"updatedAt":"2026-10-03T00:00:00Z","durableEvidence":[{"verificationClass":"SOURCE_CHECK","result":"NOT_RUN","ref":"pending CSN-06 execution"},{"verificationClass":"FUNCTIONAL_CHECK","result":"NOT_RUN","ref":"pending Native Desktop proof"},{"verificationClass":"STRUCTURAL_CHECK","result":"NOT_RUN","ref":"pending Browser zero-registration proof"}]}
```

## Current Snapshot

- Native Desktop same-Station private Social and recovery are proven.
- `momentsRuntime` already owns event and reconcile freshness.
- Browser currently shares Desktop page registration and must be hard-cut.

## Closure

Two Native Desktop clients complete cross-Station journeys with stable states;
Browser exposes no Social product surface.

## Concurrency Decision

Serial after CSN-04 and CSN-05 because the UI consumes both contracts.
