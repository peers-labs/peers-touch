# Messaging Platform — 模块目录结构

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-08-08 | **Updated**: 2026-09-06
> **Owner**: Messaging Platform Team
>
> **Accepted MP-D30 correction**: Station has no target
> `app/subserver/messaging/` facade. Conversation is a DDD bounded context;
> Device, Recovery, Key Exchange, Attachment, and Federation capabilities live
> under their resource owners. The complete Station tree is governed by
> [`../../../engineering/api-governance/module-layout.md`](../../../engineering/api-governance/module-layout.md).

---

Conversation is the sole Chat entry point at `/conversation/*`. The target tree
exposes Device, Inbox, Recovery, Key Exchange, and Federation through
`/device/*`, `/device/inbox/*`, `/recovery/*`, `/key-exchange/*`, and peer-only
`/federation/*`. Device Messaging Engine remains the Desktop/Mobile runtime name.

## 1. Target Layout

```text
model/domain/chat/
├── endpoint.proto
├── command.proto
├── event.proto
├── queue.proto
├── federation.proto
├── direct_crypto.proto
├── group_mls.proto
├── device.proto
├── receipt.proto
├── recovery.proto
└── attachment.proto

apps/station/app/subserver/conversation/
├── domain/
│   ├── aggregate/
│   ├── entity/
│   ├── event/
│   ├── repository/
│   ├── service/
│   └── valueobject/
├── application/
│   ├── command/
│   ├── query/
│   └── ports/
├── infrastructure/
│   ├── persistence/
│   ├── delivery/
│   ├── attachment/
│   └── federation/
├── interface/http/
├── composition.go
└── subserver.go

apps/station/app/subserver/actor_identity/  # /device/*
apps/station/app/subserver/recovery/        # /recovery/*
apps/station/app/subserver/key_exchange/    # /key-exchange/*
apps/station/frame/core/federation/         # peer-only /federation/*

apps/desktop/src-tauri/src/messaging/
├── engine.rs
├── command.rs
├── event.rs
├── identity/
├── direct/
├── mls/
├── inbox/
├── outbox/
├── receipt/
├── recovery/
├── attachment/
├── search/
├── store/
└── projection/

apps/desktop/src/messaging/
├── client.ts
├── runtime.ts
├── store.ts
├── types.ts
└── selectors.ts

apps/mobile/src-tauri/src/messaging/
└── <same engine responsibility modules>

apps/mobile/src/messaging/
└── <same presentation contracts>
```

### 1.1 Portable Core Target Layout

> `MP-D16` accepted by Owner on 2026-08-09.

```text
packages/messaging-core/
├── Cargo.toml
└── src/
    ├── lib.rs
    ├── contracts/
    ├── engine/
    ├── direct/
    ├── mls/
    ├── inbox/
    ├── outbox/
    ├── receipt/
    ├── recovery/
    ├── attachment/
    ├── search/
    ├── projection/
    └── ports/
        ├── encrypted_store.rs
        ├── attachment_blob.rs
        ├── attachment_transfer.rs
        ├── key_material.rs
        ├── queue_transport.rs
        ├── clock.rs
        └── projection_sink.rs

apps/desktop/src-tauri/src/messaging/
├── adapter.rs
├── lifecycle.rs
└── commands.rs

apps/mobile/src-tauri/src/messaging/
├── adapter.rs
├── lifecycle.rs
└── commands.rs
```

Core 中不得出现 Tauri command、concrete `reqwest` client、平台路径、React/Lynx type、
Keychain API 或 UI copy。Desktop/Mobile adapter 中不得出现 ratchet/OpenMLS algorithm、
queue FSM、recovery codec 或 duplicated SQL schema definition。

## 2. Registration And Source Rules

| Concern | 唯一注册/真源 |
|---|---|
| Shared commands/events/states | `model/domain/chat/*.proto` |
| Conversation routes and authority | Conversation DDD composition root |
| Authority state machine | Conversation aggregate + application commands |
| Device inbox state machine | Conversation Delivery infrastructure |
| Device identity | Actor Identity resource owner |
| Recovery revisions | Recovery resource owner |
| Direct/MLS public material | Key Exchange resource owner |
| Peer delivery mechanics | `frame/core/federation/` |
| Device runtime lifecycle | one `MessagingEngine` per authenticated profile |
| Direct sessions | Device Engine `direct` |
| MLS groups | Device Engine `mls` |
| Local durable projection | Device Engine `store` |
| Attachment transfer/grant | Conversation application port and grant policy |
| Attachment bytes | Conversation opaque object-store adapter |
| Attachment crypto/checkpoint | Device Engine `attachment` |
| Plaintext search | Device Engine `search` + SQLCipher FTS |
| Web projection | one `messaging/runtime.ts` |
| Cross-client protocol implementation | `packages/messaging-core/` |

## 3. Dependency Direction

```text
UI components
  -> messaging runtime/store selectors
  -> generated TS contracts + Tauri client
  -> Desktop/Mobile Messaging Engine
  -> generated Rust contracts
  -> canonical Station resource APIs
  -> Conversation / Device / Recovery / Key Exchange application ports
```

Reverse communication：

```text
Station SSE wake
  -> Messaging Engine drain
  -> typed LocalProjectionEvent
  -> Web runtime/store
  -> UI
```

## 4. Responsibilities

| Module | 负责 | 禁止 |
|---|---|---|
| UI messaging | 用户 intent、draft、render | crypto、ACK、network retry |
| Engine command | durable intent/outbox | authority policy |
| Engine inbox | ordered consume/local commit | UI mutation |
| Engine direct | X3DH/Double Ratchet | actor-wide sessions |
| Engine MLS | RFC 9420 private state | membership authority |
| Engine store | SQLCipher transactions/projections | Station truth |
| Conversation DDD | admission/event/fan-out intents | plaintext decrypt |
| Conversation Delivery | lane/lease/replay/ACK | content interpretation |
| Shared Federation | durable forwarding | new event identity or domain policy |
| Recovery | opaque revisions | phrase/key access |
| Conversation Attachment | opaque session/object/grant | filename/key/nonce/plaintext |
| Engine attachment | chunk crypto/resume/cache | authority ACL/object retention |
| Engine search | SQLCipher FTS query/projection | Station plaintext query |

## 5. Forbidden Imports And Calls

- `apps/desktop/src/**` 不得导入 crypto/key-exchange command wrappers。
- Web messaging runtime 不得调用 queue ACK/resume。
- Station resource-owner domains 不得依赖 UI/client packages。
- Queue service 不得调用 Direct/MLS crypto。
- Direct/MLS modules 不得直接发送 HTTP。
- Page/component 不得成为 runtime bootstrap owner。
- 任何第二个 message store、device registry、queue worker registry 均禁止。
- Conversation 之外不得出现第二个 Station Chat business handler 或 facade。
