# DUI-05 - Social relationships and rich media closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-05-SOCIAL-RELATIONSHIPS","workstreamId":"DUI-SOCIAL","title":"Close S12-S17 through encrypted media and authoritative Social relationships","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"dui-social-relationships","journeyId":"DUI-S12-S17","runtimeClass":"native-desktop","writeSet":["apps/desktop","apps/station/app/subserver/conversation","apps/station/app/subserver/social","model/domain/chat","packages/locales","docs/architecture/domains/social"],"readSet":["docs/architecture/domains/chat/lifecycle","docs/architecture/domains/social/runtime","docs/architecture/shared/security/secure-content"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":4200,"cleanupSeconds":240},"checks":[{"id":"dui-social-relationships-source","command":"pnpm --dir apps/desktop run check && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml && cd apps/station && go test ./app/subserver/social/... ./app/subserver/conversation/...","verificationClass":"SOURCE_CHECK"},{"id":"dui-social-relationships-functional","command":"pnpm --dir apps/desktop exec vitest run src/components/chat/composer/useChatAttachmentDrafts.test.ts src/components/chat/contactSelection.test.ts src/components/chat/findPeopleIdentity.test.ts src/store/relationships.test.ts src/services/socialRealtime.test.ts","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-social-relationships-proof","command":"python3 tooling/scripts/acceptance-run.py --gate chat-contact-message-resilience-e2e && python3 tooling/scripts/acceptance-run.py --gate chat-lifecycle-rich-voice-e2e","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Voice and attachments use encrypted object transfer with visible lifecycle states","Friend request send/accept/decline creates the expected relationship and DM","Handle resolution and indexed directory search remain distinct","Federated requests enforce receiver policy","Block/unblock is available in contextual Social UI and converges in Settings"],"failureBehavior":["Never render local blob URLs as durable remote attachment truth","Never bypass receiver contact policy","Do not treat a directory result as an accepted relationship"],"updatedAt":"2026-10-14T08:43:26.000Z"}
```

## Objective

Close the path from finding a person to exchanging encrypted rich media with
that person.

## Current Snapshot

- S12-S17 have no alignment delta.
- C15 supplies only the Settings half of block/unblock.
