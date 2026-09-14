# Secure Content - Module Layout

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-13 | **Updated**: 2026-09-14
> **Owner**: Architecture Team

---

## 1. Target Layout

```text
model/domain/
├── actor/actor.proto
├── key_exchange/key_exchange.proto
├── secure_content/
│   ├── content.proto
│   └── object.proto
├── social/
│   ├── post.proto
│   ├── comment.proto
│   └── private_content.proto
└── chat/attachment.proto

packages/secure-content-core/
├── Cargo.toml
└── src/
    ├── lib.rs
    ├── aad.rs
    ├── payload.rs
    ├── envelope.rs
    ├── prekey.rs
    ├── recovery.rs
    ├── object/
    │   ├── crypto.rs
    │   ├── validation.rs
    │   └── transfer.rs
    └── ports/
        ├── blob.rs
        ├── clock.rs
        ├── key_material.rs
        ├── store.rs
        └── transport.rs

packages/messaging-core/
└── src/
    ├── attachment/              # Chat adapter/projection only
    ├── crypto/                  # Direct/MLS only
    └── recovery/                # Messaging recovery records

apps/station/app/internal/securecontent/
├── descriptor.go
├── envelope.go
├── transition.go
├── policy.go
├── errors.go
└── conformance.go

apps/station/frame/touch/model/privatecontent/
└── private_content.pb.go      # Social-owned generated child package

apps/station/app/subserver/conversation/
├── application/attachment/     # Conversation route/UOW/grant adapter
└── infrastructure/attachment/  # existing Conversation-owned tables/workers

apps/station/app/subserver/social/
├── domain/
│   ├── audience.go
│   ├── audience_snapshot.go
│   └── secure_content.go
├── application/
│   ├── private_content_plan_service.go
│   ├── moment_service.go
│   └── comment_service.go
├── infrastructure/
│   ├── private_post_repo.go
│   ├── private_comment_repo.go
│   ├── audience_snapshot_repo.go
│   ├── content_envelope_repo.go
│   └── object/
│       ├── repository.go
│       ├── blob_store.go
│       └── worker.go
└── interface/
    ├── conversation_snapshot_adapter.go
    └── secure_content_http.go

apps/desktop/src-tauri/src/
├── secure_content/
│   ├── adapter.rs
│   ├── store.rs
│   ├── worker.rs
│   └── recovery.rs
└── social/
    ├── private_moment.rs
    └── projection.rs

apps/mobile/src-tauri/src/
├── secure_content/
│   ├── adapter.rs
│   ├── store.rs
│   ├── worker.rs
│   └── recovery.rs
└── social/
    ├── private_moment.rs
    └── projection.rs
```

Exact filenames may be refined by the execution plan; ownership and dependency
direction may not change.

## 2. Responsibilities

| Path | Owns | Must not own |
|---|---|---|
| `model/domain/secure_content/` | generic payload/object/envelope contracts | Social audience or Conversation membership |
| `apps/station/frame/touch/model/privatecontent/` | generated Social private-content wire projection | shared crypto semantics or independent business authority |
| `packages/secure-content-core/` | portable crypto, codec, object and transfer FSM | platform or business policy |
| `apps/station/app/internal/securecontent/` | pure validation/transitions/policy/conformance | route, DB, transaction, worker, ACL |
| `conversation/application/attachment/` | Chat route, UOW and grant adapter | copied crypto/transition algorithms |
| `conversation/infrastructure/attachment/` | Conversation tables, object adapter and workers | Social object state |
| `social/` | Moment audience, Post/Comment UOW, Social object/grant plane | Chat policy or copied crypto |
| Native `secure_content/` | platform key/store/network/filesystem adapters | Social/Chat business authority |
| Native `social/` | Social orchestration and decrypted projection | crypto implementation |
| OSS/storage backend | opaque physical bytes | audience, membership, keys |

## 3. Dependency Direction

```text
Social Native adapter ----------+
                                +--> secure-content-core
Messaging Core -----------------+

Social domain object adapter ---+
                                +--> internal/securecontent
Conversation attachment adapter-+
                                         |
                                         v
                                 storage.Backend
```

Forbidden:

```text
secure-content-core -> messaging-core or Social
internal/securecontent -> Social or Conversation repositories
Social -> Conversation implementation
Conversation -> Social implementation
Social TypeScript/Lynx -> crypto libraries
OSS -> Social or Conversation policy
```

The Go binding for `social/private_content.proto` is generated into the
Social-owned `frame/touch/model/privatecontent` child package. It may import
the existing parent Social/Actor model package and the shared Secure Content
package. The parent model package must not import that child package, preventing
the generated `securecontent -> model -> securecontent` cycle without creating
another domain owner.

## 4. Extraction Boundary

Move from `messaging-core`:

- generic payload/object AAD primitives;
- object crypto material and chunk encrypt/decrypt;
- generic descriptor validation;
- generic transfer/checkpoint FSM.

Retain in `messaging-core`:

- Chat attachment protobuf mappings;
- Message Private Content;
- Direct/MLS state;
- Chat attachment projection and receipt integration;
- Chat recovery records;
- Conversation HTTP/transport adapter.

Move from Conversation Station code into the internal Go kernel:

- pure descriptor validation;
- pure upload/object/grant state-transition validation;
- typed generic error taxonomy;
- common bounded-policy and conformance vectors.

Retain in Conversation:

- `/conversation/attachments/*`;
- tables, UOW, grants, object worker, audit and retention.

Delete from Social:

- Social chunk cipher and upload implementation;
- `momentAudienceKeys.ts`;
- `AudienceKeyEnvelope`;
- signaling-envelope use for media keys;
- public OSS path for private media.

## 5. No Third Authority

There is deliberately no:

```text
apps/station/app/subserver/secure_content/
/secure-content/*
secure_content_* shared authority tables
```

Reuse is expressed through shared contracts and implementation kernels. Runtime
truth remains inside Social and Conversation.
