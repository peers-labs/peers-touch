# Federated IM Architecture — Target Module Layout

> **Status**: active
> **Version**: v0.1
> **Created**: 2026-08-03 | **Updated**: 2026-08-03
> **Owner**: Architecture Team
> **Module**: `model/domain/chat/`, `apps/station/app/subserver/conversation/`, `apps/desktop/src-tauri/`, `apps/desktop/src/`

---

## 1. Document Scope

This document defines the target ownership and dependency layout needed to keep
D-17 as one protocol.

It does not define implementation phases, file-by-file tasks, or migration
order. Those belong in an execution plan after D-17 is accepted.

## 2. Target Tree

```text
model/domain/chat/
  conversation.proto
    ConversationCommand
    ConversationCommandProposal
    ConversationCommandProposalSigningInput
    ConversationCommandProposalResult
    ConversationCommandRejectCode
  conversation_api.proto
    SubmitConversationCommandProposalRequest/Response

apps/station/frame/touch/actor/
  device_signing_key_store.go
    verified actor-device public-key projection
  federation_profile.go
    signed profile publication and verified remote hydration

apps/station/app/subserver/conversation/
  command_proposal.go
    generic Station/actor signature and field-binding verifier
  command_proposal_handler.go
    authenticated Home and peer-token authority endpoints
  command_proposal_forwarder.go
    durable-route authority forwarding and peer-token minting
  command_receipt_repository.go
    (conversation_id, command_id, command_sha256) result journal
  command_uow.go
    receipt + effects + event + deterministic outbox transaction
  transition_service.go
    D-13/D-15/D-16 membership specialization
  follower/
    authority-derived route/head/member/device projection

apps/station/app/subserver/envelope/
  federation_transport.go
    opaque cross-Station delivery only

apps/desktop/src-tauri/src/domain/
  actor_device_identity.rs
    actor-scoped durable Ed25519 private identity and signing interface
  mls_group.rs
    OpenMLS state; consumes actor-device identity, does not own proposals

apps/desktop/src-tauri/src/interface/tauri_commands/
  conversation.rs
    generic command encode/hash/sign/submit command
  mls.rs
    MLS prepare/accept/discard/encrypt/decrypt only

apps/desktop/src/services/
  im-service.ts
    authority-aware command routing and canonical result normalization
```

## 3. File Responsibilities

| Path / module | Responsibility | Must Not Own |
| --- | --- | --- |
| Model conversation contracts | Cross-runtime command/proposal/result semantics | Station persistence or client implementation |
| Actor device identity | Device private signer and verified public projection | Conversation authorization or MLS group state |
| Station command proposal | Two-layer trust verification and generic rejection classification | Business mutation |
| Station command unit of work | Idempotency receipt, command effects, event, deterministic outbox | Network calls or client crypto |
| Membership transition service | D-13/D-15/D-16 semantic validation and effects | Separate proposal wire protocol |
| Follower service | Authority-derived route/head/member/device projection | Authority sequence allocation |
| Envelope transport | Opaque durable delivery | Command acceptance or chat truth |
| Desktop conversation command | Generic device signing and Home Station submission | OpenMLS state mutation |
| Desktop MLS group | MLS prepare/merge/encrypt/decrypt | Generic remote command transport |
| Desktop IM service | Route selection and product-facing orchestration | Manual domain contract duplication |

## 4. Dependency Direction

```text
Model contracts
  <- Actor device identity
  <- Desktop conversation command
  <- Desktop MLS group
  <- Station proposal verifier
  <- Station command unit of work

Desktop IM service
  -> Desktop conversation command
  -> Desktop MLS group

Station proposal handler
  -> Actor verified-key resolver
  -> Federation membership/route projection
  -> Station command unit of work

Station command unit of work
  -> command receipt repository
  -> conversation repository
  -> envelope outbox repository
```

## 5. Forbidden Dependencies

- `mls.rs` must not remain the owner of generic command proposal signing or
  transport.
- Conversation must not persist a second actor signing-key projection.
- Envelope must not import command authorization or allocate group sequence.
- Home Station forwarders must not call authority repositories directly.
- Desktop TypeScript must not manually construct signing bytes or hold actor
  private keys.
- A message-only proposal module must not coexist with the generic proposal.
- Membership-only proposal modules and generated types must not remain after
  the hard cut.
