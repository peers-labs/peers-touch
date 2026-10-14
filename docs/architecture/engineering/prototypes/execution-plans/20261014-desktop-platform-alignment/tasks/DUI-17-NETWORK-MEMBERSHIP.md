# DUI-17 - Network membership and health closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-17-NETWORK-MEMBERSHIP","workstreamId":"DUI-NETWORK","title":"Close N6-N12 through Federation membership, device/Station transitions, counts, and health","workClass":"product-behavior","completionClass":"functional","executionMode":"fix","closureId":"dui-network-membership","journeyId":"DUI-N6-N12","runtimeClass":"native-desktop","writeSet":["apps/desktop","apps/station/app/subserver/federation","apps/station/app/subserver/dashboard","apps/station/frame/core/federation","apps/station/frame/touch","model/domain/federation","packages/locales","docs/architecture/domains/federation","docs/client/desktop"],"readSet":["docs/architecture/domains/federation","docs/architecture/platform/station/access","docs/client/desktop/identity-lifecycle.md"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":5400,"cleanupSeconds":300},"checks":[{"id":"dui-network-membership-source","command":"cd apps/station && go test ./app/subserver/federation/... ./app/subserver/dashboard/... && cd ../desktop && pnpm run check && cargo check --manifest-path src-tauri/Cargo.toml","verificationClass":"SOURCE_CHECK"},{"id":"dui-network-membership-functional","command":"pnpm --dir apps/desktop exec vitest run src/components/settings/FederationTab.test.tsx src/store/federation.test.ts src/kernel/identityRuntime.test.ts","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-network-membership-proof","command":"python3 tooling/scripts/acceptance-run.py --gate station-access-federation-boundary-e2e && python3 tooling/scripts/acceptance-run.py --gate station-dashboard-web-check && python3 tooling/scripts/acceptance-run.py --gate federation-domain-validation","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Desktop can join, leave, list roster, and render role/capability/member counts","Non-sequencer leave converges through the authenticated sequencer proposal","Device revoke and Station switch complete their shared C16/C17 contracts","Health and counts are authoritative, populated, role-correct, and split between user Settings and operator Dashboard"],"failureBehavior":["Never append a non-sequencer leave locally","Never display unsupported health or population numbers","Never expose operator governance actions to ordinary users"],"updatedAt":"2026-10-14T08:43:26.000Z"}
```

## Objective

Close Federation membership and Station/device transitions as observable,
receiver-proven product journeys.

## Current Snapshot

- N7 is implemented/unproven.
- N6 and N8-N12 are partial.
