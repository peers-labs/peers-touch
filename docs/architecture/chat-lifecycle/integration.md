# Chat Lifecycle - Integration And Cutover

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-09-16 | **Updated**: 2026-09-22
> **Owner**: Chat Product Team

---

## 1. Existing Source Mapping

| Product boundary | Current source |
|---|---|
| Find people | `apps/desktop/src/components/chat/FindPeopleModal.tsx`, `apps/mobile/src/pages/ContactsPage.tsx`, Actor/Federation handlers |
| Relationships | Station Social application/repositories and Desktop/Mobile PTID-keyed relationship/request-history projections |
| Conversation entry | `SocialChatPage`, Mobile Contacts/Chat pages, `messaging_create_direct`, Conversation create/read |
| Durable messaging | `packages/messaging-core`, Desktop/Mobile Messaging adapters and lifecycle workers |
| Chat projection | Desktop/Mobile Messaging runtime over Engine SQLCipher projection; UI stores are projection containers only |
| Attachments | Conversation attachment routes, Messaging Core transfer FSM, Desktop/Mobile attachment UI |
| Voice notes | Desktop recorder/composer/audio attachment renderer; Mobile foundation only |
| Interactions/typing | Conversation interaction services and Desktop/Mobile projections |
| Groups | Conversation MLS commands plus remaining legacy Group mutation consumers |
| Live voice/video | `callP2p`, `CallSurface`, Realtime signaling, TURN discovery |
| Acceptance | `tooling/acceptance/capabilities`, registry, Gates, native provisioners |

## 2. Required Cutovers

| Concern | New canonical path | Remove or forbid |
|---|---|---|
| Discovery-to-first-message proof | One Chat Lifecycle Journey adapter | Pre-seeded conversation as the only proof |
| Direct open | Conversation create/read through Messaging client runtime | Generic empty Chat fallback |
| Send failure | Engine projection with typed message retry | Toast-only or silent retry |
| Conversation list freshness | Engine/runtime projection and durable cursors | No-op preview/unread loaders |
| Account resume | Native session owner plus explicit PIN policy | Renderer downgrade to password reauthentication |
| Contact identity summary | Federation Station directory joined by Station peer ID, with raw IDs in expandable details | Raw peer ID as primary identity text or display-name deduplication |
| Screenshot capture | Native capture lifecycle with stable window geometry | Hide/show resize or scale flash |
| Group mutations | Conversation commands/events | Active `/group-chat/*` mutation ownership |
| Voice note | Typed audio private content over attachment plane | Generic file-only UX and duration loss |
| Live voice/video | Runtime-owned WebRTC call projection | Page-owned or P2P-status-gated call availability |
| Mobile proof | Real native Journey/Gate implementation | Fake-memory or missing-metadata success |
| Debugging | Declared, redacted diagnostic channels | Hard-coded HTTP collectors |
| Plan tracking | Chat Lifecycle Plan Package | NDR/MP status tables as active state |
| Desktop Chat lifecycle | `apps/desktop/src/messaging/runtime.ts` plus thin Kernel descriptor | Chat refresh/commands owned by `socialRealtime`, page mount, or direct UI transport imports |

## 3. Retained Implementations

The replacement plan reuses rather than rewrites:

- Conversation command/event ordering and resource-owned APIs;
- Portable Messaging Core, Direct crypto, OpenMLS, Device Inbox, receipts,
  recovery, search, and attachment transfer;
- existing Desktop and Mobile Chat presentation where it satisfies the product
  state contract;
- Realtime stream, sealed call signaling, WebRTC, ICE, and TURN foundations;
- current Acceptance runtime-cell infrastructure.

Reuse never imports historical completion status.

`socialChat` remains the current Desktop projection container during CCU. It is
not a lifecycle or durable truth owner: writes are admitted and scheduled by the
Messaging runtime, while durable command/projection truth remains in the native
Device Messaging Engine.

## 4. Deletion Proof

The machine-readable inventory is
[`legacy-inventory.json`](./legacy-inventory.json). Each behavior cutover owns
the exact paths, routes, commands, tables and scan roots assigned there. A row
closes only when its final production consumer is migrated and every listed
path/symbol is deleted in the same Task:

| Slice | Exact legacy inventory |
|---|---|
| Direct | `model/domain/chat/friend_chat.proto`; generated `friend_chat_pb.ts` / `friend_chat.pb.go`; non-generated `friend_chat_pb` imports; `/friend-chat/*` route literals; Friend-specific send/sync/retry adapters that bypass Messaging Core |
| Group | `model/domain/chat/group_chat.proto`; generated `group_chat_pb.ts` / `group_chat.pb.go`; `apps/desktop/src-tauri/src/application/group_chat/`; `interface/tauri_commands/group_chat.rs`; `group_chat::*` registrations and HTTP dispatch branches; `/group-chat/*` route literals |
| Mobile Group | `apps/mobile/src/features/group/{groupStore,groupRuntime,groupProjection,groupSelectors,groupNormalizers,groupPermissions}.ts` and their legacy-only tests; legacy branches in `messagingProjectionAdapters` |
| Interaction/Attachment | Friend/Group-specific edit/retract/reaction/pin/read/typing/attachment adapters, fixtures and Gates that do not use canonical Conversation/Messaging contracts |
| Store/schema | legacy Friend/Group repository owners, local table/read/write helpers, local cursors and fallback queries in `chat_storage.rs` or successor paths |
| Generated/build | Proto build inputs, generated manifests, descriptor sets and package exports containing Friend/Group legacy symbols |
| Runtime/registry | Tauri command registry, Desktop HTTP gateway dispatch, Mobile runtime registry and mixed-client traces containing legacy command/route names |
| Test/tooling/docs | tests, fixtures, mocks, Acceptance scripts and current-source docs that construct, invoke or describe a legacy owner |

The following patterns are zero-reference sentinels, not the complete
implementation of the nine-dimensional Gate:

```text
friend_chat.proto
group_chat.proto
friend_chat_pb
group_chat_pb
/friend-chat/
/group-chat/
group_chat_
application/group_chat
features/group/groupStore
features/group/groupRuntime
messagingProjectionAdapters legacy branch
```

The zero-reference Gate also checks:

- every `deletedPaths` entry is absent and every CCU-D05 dimension has a
  non-empty `dimensionRoots` assignment;
- tracked and untracked non-ignored files under those roots, including tests,
  fixtures, scripts, checked-in generated output, schema, and current-source
  documentation;
- only files listed in `negativeAssertionPaths` may retain forbidden literals
  for explicit fail-closed assertions;
- production debug endpoint addresses and debug-point egress blocks;
- client-side friendship or conversation truth fabrication;
- duplicate message send/retry owners;
- fake Mobile Chat success adapters used as product evidence;
- obsolete plan discovery and active-work locators.

Rollback uses version/deployment rollback. No compatibility alias, fallback
read, or dual write remains after a cutover.

## 5. Documentation Navigation

`docs/README.md`, Messaging Platform navigation, and superseded plan headers
must point to the Chat Lifecycle plan. Conversation Authority hard-cut
documentation remains owned by its separate worktree and is not rewritten.
