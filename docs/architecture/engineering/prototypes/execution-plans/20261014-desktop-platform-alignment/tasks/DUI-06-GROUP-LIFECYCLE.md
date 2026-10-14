# DUI-06 - Group lifecycle closure

## Task Slice

```json
{"kind":"peers-touch-task-slice","planId":"desktop-platform-alignment-20261014","taskId":"DUI-06-GROUP-LIFECYCLE","workstreamId":"DUI-SOCIAL","title":"Close S18-S24 across MLS membership, group settings, inbox, sessions, and storage","workClass":"product-behavior","completionClass":"functional","executionMode":"build","closureId":"dui-group-lifecycle","journeyId":"DUI-S18-S24","runtimeClass":"native-desktop","writeSet":["apps/desktop","apps/station/app/subserver/conversation","apps/station/app/subserver/notification","model/domain/chat","packages/locales","docs/architecture/domains/chat"],"readSet":["docs/architecture/domains/chat/lifecycle","docs/architecture/domains/chat/messaging","docs/architecture/domains/chat/storage-governance"],"budgets":{"focusedCheckSeconds":2400,"functionalRunSeconds":5400,"cleanupSeconds":300},"checks":[{"id":"dui-group-lifecycle-source","command":"pnpm --dir apps/desktop run check && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml && cd apps/station && go test ./app/subserver/conversation/...","verificationClass":"SOURCE_CHECK"},{"id":"dui-group-lifecycle-functional","command":"pnpm --dir apps/desktop exec vitest run src/components/chat/CreateGroupModal.test.ts src/components/chat/ChatDetailPanel.permissions.test.ts src/components/settings/ChatStorageSettings.test.tsx src/store/socialChat.conversationProjection.test.ts","verificationClass":"FUNCTIONAL_CHECK"},{"id":"dui-group-lifecycle-proof","command":"python3 tooling/scripts/acceptance-run.py --gate chat-native-group-mls-e2e && python3 tooling/scripts/acceptance-run.py --gate chat-storage-governance-aggregate-e2e","verificationClass":"ACCEPTANCE_PROOF"}],"doneWhen":["Group prepare/create, welcomes, role authority, membership intents, settings, leave, and dissolve converge across clients","Group invitations have a decision inbox and notification path","Session unread/pin/mute/last-message fields come from durable projections","Hide, clear, retention, and reclamation retain their distinct semantics"],"failureBehavior":["Never mutate group membership or roles only in UI state","Never expose an action outside the current actor authority","Never claim storage reclamation from a projection-only delete"],"updatedAt":"2026-10-14T08:43:26.000Z"}
```

## Objective

Close a full group journey from creation through membership changes, settings,
inbox decisions, session projection, and cleanup.

## Current Snapshot

- S18-S24 have no alignment delta.
