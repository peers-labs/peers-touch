# Chat Lifecycle - Integration And Cutover

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-16 | **Updated**: 2026-09-17
> **Owner**: Chat Product Team

---

## 1. Existing Source Mapping

| Product boundary | Current source |
|---|---|
| Find people | `apps/desktop/src/components/chat/FindPeopleModal.tsx`, `apps/mobile/src/pages/ContactsPage.tsx`, Actor/Federation handlers |
| Relationships | Station Social application/repositories and Desktop/Mobile PTID-keyed relationship/request-history projections |
| Conversation entry | `SocialChatPage`, Mobile Contacts/Chat pages, `messaging_create_direct`, Conversation create/read |
| Durable messaging | `packages/messaging-core`, Desktop/Mobile Messaging adapters and lifecycle workers |
| Chat projection | Desktop `socialChat`, Mobile Social/Chat stores, Engine SQLCipher stores |
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

## 4. Deletion Proof

Each cutover must include a zero-reference check for:

- production debug endpoint addresses and debug-point egress blocks;
- client-side friendship or conversation truth fabrication;
- legacy Group mutation routes from active Chat clients;
- duplicate message send/retry owners;
- fake Mobile Chat success adapters used as product evidence;
- obsolete plan discovery and active-work locators.

Rollback uses version/deployment rollback. No compatibility alias, fallback
read, or dual write remains after a cutover.

## 5. Documentation Navigation

`docs/README.md`, Messaging Platform navigation, and superseded plan headers
must point to the Chat Lifecycle plan. Conversation Authority hard-cut
documentation remains owned by its separate worktree and is not rewritten.
