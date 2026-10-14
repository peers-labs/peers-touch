# DUI-20 - Native product aggregate

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-20-NATIVE-AGGREGATE","workstreamId":"DUI-PROOF","title":"Prove the aligned Desktop product on exact source with multiple Native clients","workClass":"product-behavior","completionClass":"functional","executionMode":"fix","closureId":"dui-native-aggregate","journeyId":"DUI-NATIVE-ALL","runtimeClass":"native-desktop","writeSet":["apps/desktop","tooling/acceptance","docs/architecture/engineering/prototypes/execution-plans/20261014-desktop-platform-alignment"],"readSet":["apps/station/app/subserver","apps/station/frame/core/federation","apps/station/frame/touch","model/domain","packages/prototypes","docs/architecture/engineering/prototypes/execution-plans/20261014-desktop-platform-alignment/scope-ledger.md"],"budgets":{"focusedCheckSeconds":1800,"functionalRunSeconds":10800,"cleanupSeconds":600},"checks":[{"id":"dui-native-aggregate-source","command":"pnpm --dir apps/desktop run check && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml","verificationClass":"SOURCE_CHECK"},{"id":"dui-native-aggregate-functional","command":"python3 tooling/scripts/acceptance-run.py --gate chat-native-current-profile-two-client-e2e","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-native-aggregate-proof","command":"python3 tooling/scripts/acceptance-run.py --gate chat-native-current-profile-two-client-e2e && python3 tooling/scripts/acceptance-run.py --gate station-access-lifecycle-aggregate-e2e && python3 tooling/scripts/acceptance-run.py --gate desktop-release-build","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Alice and Bob complete identity, Social, Direct, Group, rich media, calls, Agent, Applet, Settings, and Federation journeys on exact source","Station switch, account switch, device revoke, restart, recovery, and failure states preserve scoped projections","Receiver-side readback proves remote outcomes","Runtime source identity matches the audited digest and all owned resources are released"],"failureBehavior":["Never substitute sender-side success for receiver proof","Never reuse a stale binary, Station, profile, or evidence artifact","Stop on source identity mismatch or uncontrolled external state"],"updatedAt":"2026-10-14T08:43:26.000Z"}
```

## Objective

Prove the integrated product, not isolated components, before formal
Acceptance closure.

## Current Snapshot

- Narrow Alice/Bob thread and search evidence exists for the latest DTO fix.
- The 111-item aggregate has never run on exact current source.
