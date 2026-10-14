# DUI-07 - Chat safety, search, and calls closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-07-CHAT-SAFETY-CALLS","workstreamId":"DUI-SOCIAL","title":"Close S25-S31 with truthful search, identity, safety, calls, and moderation","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"dui-chat-safety-calls","journeyId":"DUI-S25-S31","runtimeClass":"native-desktop","writeSet":["apps/desktop","apps/station/app/subserver/conversation","apps/station/app/subserver/groupcall","apps/station/app/subserver/social","model/domain/chat","packages/locales","docs/architecture/domains/chat","docs/architecture/domains/social"],"readSet":["docs/architecture/domains/chat/lifecycle","docs/architecture/domains/chat/calling","docs/architecture/domains/social/runtime"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":5400,"cleanupSeconds":300},"checks":[{"id":"dui-chat-safety-calls-source","command":"pnpm --dir apps/desktop run check && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml && cd apps/station && go test ./app/subserver/groupcall/... ./app/subserver/social/...","verificationClass":"SOURCE_CHECK"},{"id":"dui-chat-safety-calls-functional","command":"pnpm --dir apps/desktop exec vitest run src/components/chat/chatGeometry.test.ts src/components/chat/findPeopleIdentity.test.ts src/acceptance/chat/nativeBridge.test.ts src/services/chatPresence.test.ts","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-chat-safety-calls-proof","command":"python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-safety-e2e && python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-group-live-e2e && python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-call-resolution-e2e","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Search scope matches the canonical API and does not imply unsupported global search","Peer identity, federation markers, safety verification, and real statistics are truthful","One-to-one and group calls use production signaling/media paths","Moderation, follow, and circle affordances are source-backed and role-correct"],"failureBehavior":["Never label a simulated call as live","Never fabricate peer or post statistics","Never widen search or moderation authority in the renderer"],"updatedAt":"2026-10-14T08:43:26.000Z"}
```

## Objective

Finish the high-trust Chat surfaces that determine who the peer is, what can be
searched, and whether a call or moderation action is real.

## Current Snapshot

- S25-S31 have no alignment delta.
