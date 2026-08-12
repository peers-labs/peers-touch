# Messaging Platform — 模块目录结构

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-08-08 | **Updated**: 2026-08-10
> **Owner**: Messaging Platform Team

---

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

apps/station/app/subserver/messaging/
├── domain/
│   ├── conversation.go
│   ├── command.go
│   ├── event.go
│   ├── device.go
│   ├── queue.go
│   ├── attachment.go
│   └── federation.go
├── application/
│   ├── command_service.go
│   ├── device_service.go
│   ├── queue_service.go
│   ├── receipt_service.go
│   ├── recovery_service.go
│   ├── attachment_transfer_service.go
│   └── federation_service.go
├── infrastructure/
│   ├── postgres/
│   ├── object_store/
│   │   └── attachment_blob_store.go
│   └── federation/
├── worker/
│   ├── federation_dispatcher.go
│   ├── attachment_orphan_gc.go
│   └── queue_notifier.go
└── interface/http/

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
| Station routes/workers | Station messaging composition root |
| Authority state machine | `messaging/application/command_service` |
| Device queue state machine | `messaging/application/queue_service` |
| Device runtime lifecycle | one `MessagingEngine` per authenticated profile |
| Direct sessions | Device Engine `direct` |
| MLS groups | Device Engine `mls` |
| Local durable projection | Device Engine `store` |
| Attachment transfer/grant | Authority `attachment_transfer_service` |
| Attachment bytes | Authority object-store port |
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
  -> Station generated API contracts
  -> Station application/domain/persistence
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
| Station command | admission/event/fan-out | plaintext decrypt |
| Station queue | lane/lease/replay/ACK | content interpretation |
| Station federation | durable forwarding | new event identity |
| Station recovery | opaque revisions | phrase/key access |
| Station attachment | opaque session/object/grant | filename/key/nonce/plaintext |
| Engine attachment | chunk crypto/resume/cache | authority ACL/object retention |
| Engine search | SQLCipher FTS query/projection | Station plaintext query |

## 5. Forbidden Imports And Calls

- `apps/desktop/src/**` 不得导入 crypto/key-exchange command wrappers。
- Web messaging runtime 不得调用 queue ACK/resume。
- Station messaging domain 不得依赖 UI/client packages。
- Queue service 不得调用 Direct/MLS crypto。
- Direct/MLS modules 不得直接发送 HTTP。
- Page/component 不得成为 runtime bootstrap owner。
- 任何第二个 message store、device registry、queue worker registry 均禁止。
