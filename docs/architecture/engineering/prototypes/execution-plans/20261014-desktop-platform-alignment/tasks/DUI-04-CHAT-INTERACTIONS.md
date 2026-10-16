# DUI-04 - Chat interaction closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-04-CHAT-INTERACTIONS","workstreamId":"DUI-SOCIAL","title":"Close S1-S11 on the canonical Conversation and Messaging path","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"dui-chat-interactions","journeyId":"DUI-S1-S11","runtimeClass":"native-desktop","writeSet":["apps/desktop","apps/station/app/subserver/conversation","model/domain/chat","packages/locales","docs/architecture/domains/chat"],"readSet":["docs/architecture/domains/chat/lifecycle","docs/architecture/domains/chat/messaging","docs/client/desktop/runtime-projections.md"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":3600,"cleanupSeconds":240},"checks":[{"id":"dui-chat-interactions-source","command":"pnpm --dir apps/desktop run check && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml messaging && cd apps/station && go test ./app/subserver/conversation/...","verificationClass":"SOURCE_CHECK"},{"id":"dui-chat-interactions-functional","command":"pnpm --dir apps/desktop exec vitest run src/components/chat src/services/im-service.test.ts","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-chat-interactions-proof","command":"python3 tooling/scripts/acceptance-run.py --gate chat-native-interactions-e2e","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["DM and group send/receive, receipts, retry, reactions, reply, threads, pin, edit, hide, retract, forward, and typing use canonical commands and projections","Group person/all mentions survive encrypted send, receiver decode, notification routing, and restart readback","Every interaction keeps event consumption and periodic reconciliation in the messaging runtime","The social-chat prototype contains no local substitute for S1-S11"],"failureBehavior":["Never bypass Conversation authority or encrypted message contracts","Reject invalid mention targets and Direct mentions before commit","Do not collapse delete-for-me and retract into one action"],"updatedAt":"2026-10-14T08:43:26.000Z"}
```

## Objective

Replace local chat interaction simulation with one durable sender-to-receiver
Conversation path.

## Current Snapshot

- S11 is implemented/unproven.
- S1-S10 have no alignment delta.
- Native Chat navigation targets the primary button carrying
  `data-pt-primary-nav="chat"`, matching the shared Desktop navigation owner.
- Current-source Native interactions and receiver proof remain open.
