# Secure Content - Architecture Design

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-13 | **Updated**: 2026-09-13
> **Owner**: Architecture Team
> **Module**: `model/domain/secure_content/`, `packages/secure-content-core/`, `apps/station/app/internal/securecontent/`

---

## 1. Core Principles

| ID | Principle |
|---|---|
| `SC-A01` | Secure Content is a shared contract and implementation kernel, never a business authority. |
| `SC-A02` | Social and Conversation independently own routes, UOWs, grants, persistence, and policy. |
| `SC-A03` | Private plaintext and content keys exist only in authenticated Native runtimes and encrypted local stores. |
| `SC-A04` | Shared contracts are proto-first; Desktop and Mobile use one portable Rust implementation. |
| `SC-A05` | Station persists only ciphertext, commitments, routing metadata, and domain-authorized grants. |
| `SC-A06` | Public-readable routes use strict optional authentication: absent is anonymous; supplied invalid is `401`. |
| `SC-A07` | No partial recipient set, plaintext/public fallback, dual write, alias, or legacy read is legal. |
| `SC-A08` | Recovery and key-unavailable states are explicit, bounded, and independently verifiable. |

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence | Missing proof |
|---|---|---|---|---|
| Private Post and Comment bodies are plaintext at Station | `verified_fact` | `SocialPrivatePost`, `SocialComment` | high | none |
| Social duplicates Chat chunk encryption and uses signaling envelopes | `verified_fact` | Desktop `oss.rs`, `momentAudienceKeys.ts` | high | none |
| Private Social ciphertext is uploaded with public OSS visibility | `verified_fact` | Social encrypted upload command and OSS policy | high | none |
| Chat already has tested object crypto and transfer semantics | `verified_fact` | `messaging-core::attachment`, Conversation attachment package | high | none |
| Conversation object ownership and `/conversation/attachments/*` are accepted | `accepted_decision` | `MP-D23`, `AO-D02` | high | none |
| Social GROUP membership is not wired in production | `verified_fact` | `NewNoopGroupMembershipChecker` | high | owner adapter |
| A shared stateless kernel avoids duplicate algorithms without moving domain authority | `proposal` | topology below | high | review and implementation proof |

## 3. Scope

In scope:

- reusable payload, content-key-envelope, encrypted-object, and transfer semantics;
- one portable Native cryptographic core;
- one stateless Station validation/state-machine kernel;
- Social private Post, Comment, media, subtype, audience, recovery, and read contracts;
- Conversation reuse without changing accepted Conversation attachment ownership;
- strict optional JWT and viewer-scoped responses.

Out of scope:

- Conversation membership, sequencing, Double Ratchet, or MLS redesign;
- private Social federation;
- server-side private-content search, recommendation, moderation, or preview fetch;
- DRM or cryptographic deletion of recipient copies;
- implementation sequencing.

Security guarantees and limitations are defined in [security.md](./security.md).
Operational semantics and gates are defined in [operations.md](./operations.md).

## 4. Target Topology

```text
Desktop Social Runtime ---------+
                                 |
Mobile Social Runtime ----------+--> packages/secure-content-core
                                 |       payload / envelope / object crypto
Messaging Core -----------------+

Social Subserver ---------------+
  /api/v1/social/*               |
  Social UOW/tables/grants       +--> apps/station/app/internal/securecontent
                                 |       stateless validation + transfer FSM
Conversation Subserver ---------+
  /conversation/attachments/*            |
  Conversation UOW/tables/grants          v
                                  generic storage.Backend
```

There is no public `/secure-content/*` API and no shared Secure Content database.
The shared components point downward; Social and Conversation never call or import
each other.

## 5. Sources Of Truth

| Concern | Owner | Canonical source |
|---|---|---|
| Social audience and frozen recipient grant | Social | Social aggregate/UOW |
| Accepted friend relationship | Social | `social_relationship_projections` accepted event |
| Group membership snapshot | Conversation | revision-bound query port |
| Conversation attachment grant | Conversation | authority event/UOW |
| Actor/device lifecycle | Actor Identity | `ActorDeviceRef`, endpoint manifest |
| Endpoint/recovery Content PreKeys | Key Exchange | exact-once prekey claims |
| Crypto format and vectors | Model + Secure Content Core | `model/domain/secure_content/`, Rust crate |
| Social opaque-object lifecycle | Social | Social object repository/UOW |
| Conversation opaque-object lifecycle | Conversation | existing attachment repository/UOW |
| Private plaintext and root keys | Native client | encrypted per-account store |
| Physical opaque bytes | domain adapter | generic `storage.Backend` |
| Recovery identity/material | Recovery | opaque actor recovery revision |

## 6. Shared Components

### 6.1 Portable Rust Core

`packages/secure-content-core` owns:

- canonical payload and envelope codecs;
- AES-256-GCM payload encryption;
- HPKE content-key envelope seal/open;
- object chunk crypto and descriptor validation;
- transfer/checkpoint state machine;
- recovery-prekey derivation and secret zeroization;
- fixed cross-language test vectors.

It has no Tauri, HTTP, filesystem, database, Social, Conversation, or UI dependency.
`messaging-core` imports it and keeps only Chat protocol integration.

### 6.2 Station Internal Kernel

`apps/station/app/internal/securecontent` is an importable Go package, not a
subserver. It owns:

- canonical descriptor/capability validation;
- upload/object/grant state-transition validation;
- hash/AAD binding verification;
- bounded policy and typed errors;
- reusable repository interfaces and conformance tests.

It owns no route, table, transaction, worker, authorization decision, or business
grant. It never imports Social or Conversation.

### 6.3 Domain Adapters

Social and Conversation each own:

- public HTTP/protobuf actions;
- outer database transaction;
- domain-specific upload/object/grant tables;
- authorization and recipient resolution;
- concrete repository adapter;
- GC worker registration and business audit correlation.

The shared kernel receives a transaction-bound repository from the domain UOW and
cannot begin or commit a transaction itself.

## 7. Social Audience Authority

| Audience | Canonical source | Revision bound into plan |
|---|---|---|
| `PUBLIC` | explicit request | content command hash |
| `FOLLOWERS` | Social follow graph | follow-graph revision |
| `FRIENDS` | accepted `social_relationship_projections` | accepted-event projection revision/hash |
| `CIRCLE` | Social Circle aggregate | circle membership revision |
| `GROUP` | Conversation membership query port | conversation ID + membership epoch + head hash |
| `SELF` | Actor Identity active endpoints | actor profile version |
| `CUSTOM_*` | explicit list plus base audience | canonical list hash + base revision |

`friend_chat_friendships`, mutual-follow inference, and direct Conversation presence
are not FRIENDS truth. Social replaces the production GROUP Noop with a narrow
Conversation read port; it does not read Conversation tables.

## 8. Private Publish

```text
Native -> Social prepare(content_id, typed audience, command_id)
Social:
  resolve recipient actors and current deny rules
  query Conversation only for GROUP snapshot
  claim one-time endpoint and recovery Content PreKeys from Key Exchange
  persist an expiring signed plan with opaque recipient slots
Native:
  generate one resource root key
  encrypt typed payload and objects through Secure Content Core
  seal endpoint and recovery envelopes for every required slot
  sign the exact plan/payload/object/envelope commitment
Native -> Social submit(exact prepared command)
Social UOW:
  revalidate plan/revisions and exact slot coverage
  commit Post/Comment, ciphertext, envelopes, deliveries, objects and grants
  consume the plan and return exact replay receipt
```

PreKey claims are irreversible when exposed. Replaying the same prepare command
returns the same claim; abandoned plans consume capacity and are replenished through
Key Exchange policy. No partial recipient publish is allowed.

## 9. Private Read And Recovery

```text
GET Moment/Comment
  -> strict Optional JWT
  -> Social frozen grant + current block/delete/relationship policy
  -> exact endpoint envelope, or actor recovery envelope after trusted recovery
  -> domain-owned object route checks the same grant
  -> Native verifies, decrypts and atomically commits its local projection
```

Every private Post and Comment has an independent root key and envelope plan.
Attachment object keys exist only inside that resource's encrypted payload.

Normal delivery uses one-time endpoint Content PreKeys. Recovery uses one-time
actor Content Recovery PreKeys deterministically recoverable from the existing
24-word recovery secret. Therefore a restored device can open authorized historical
content even when the prior device never fetched it. Station still applies current
Social authorization before returning a recovery envelope or ciphertext.

## 10. Private Post Subtypes

| Type | Encrypted fields | Station-visible facts |
|---|---|---|
| TEXT | text, hashtags, mentions | content ID, author, counters |
| IMAGE/VIDEO | text, MIME, dimensions, variants, alt text, object keys | opaque object commitments |
| LINK | URL and generated preview | optional signed mention-routing facts only |
| LOCATION | coordinates, address, place and images | none beyond opaque objects |
| POLL | question and option labels | opaque option IDs, expiry, vote facts/counts |
| REPOST | comment and rendered source payload | original resource reference and audience-subset proof |

Private repost audience must be a subset of the source's authorized recipient set.
Private poll votes use opaque option IDs committed by the encrypted payload.
Mention notifications carry signed recipient routing facts that are a subset of
the frozen audience and never contain private text. Reactions remain Social
business facts but are returned only after parent authorization.

## 11. Authentication And Response Projection

- no Bearer header: anonymous public lookup only;
- valid live Bearer: canonical actor subject;
- malformed, invalid, expired, or revoked supplied Bearer: `401`;
- private read additionally requires an active device;
- unauthorized private lookup uses one not-found wire shape;
- ordinary response includes at most the caller's endpoint envelope;
- recovery response includes only the caller actor's claimed recovery envelope;
- author audience administration is a separate metadata-only route.

## 12. Allowed And Forbidden Relationships

Allowed:

- Social imports the Secure Content proto; Conversation keeps its existing Chat
  wire and maps it through a thin domain adapter.
- Social/Conversation import the shared Rust and Go kernels.
- Domain UOW supplies its own transaction-bound repositories.
- Key Exchange owns endpoint and recovery PreKey claims.
- Domain object adapters use generic `storage.Backend`.

Forbidden:

- a Secure Content public subserver, shared grant database, or global ACL;
- Social importing Conversation implementation or `messaging-core`;
- the shared Go kernel reading domain tables or opening transactions;
- OSS deciding audience or membership;
- TypeScript/Lynx owning keys, envelope operations, or transfer checkpoints;
- stable recipient wrapping keys in author-visible plans;
- Station private plaintext or content keys;
- legacy Social cipher/signaling envelope/public private-media fallback;
- parallel generic object crypto or state-machine implementations.

## 13. Architecture Gates

The DESIGN gate requires:

1. Product capabilities, journeys, and acceptance IDs remain fully mapped.
2. All `SC-D*` decisions and exact bindings are internally consistent.
3. FRIENDS and GROUP snapshot sources are typed and revision-bound.
4. Domain UOW/object/grant atomicity has no second transaction owner.
5. Never-opened historical content passes the trusted-recovery model.
6. Stable recipient key correlation is absent from prepared plans.
7. Every private Post subtype has authorization, encryption, mutation, and
   receiver-read semantics.
8. Current accepted API Ownership and `MP-D23` remain true.
9. Hard-cut inventory covers every source, generated, migration, dashboard,
   stats, test, Gate, and documentation consumer.
10. Security and operational evidence requirements are executable.

## 14. Non-Claims

- Current private Moments are not claimed secure.
- Chat and Social do not share business authorization.
- Stored content does not provide post-compromise forward secrecy after recovery
  secret compromise.
- Cross-Station private Social delivery remains unsupported.
- This design authorizes no reset, deployment, commit, or implementation.
