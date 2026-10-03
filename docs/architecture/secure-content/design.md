# Secure Content - Architecture Design

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-09-13 | **Updated**: 2026-09-24
> **Owner**: Architecture Team
> **Module**: `model/domain/secure_content/`, `packages/secure-content-core/`, `apps/station/app/internal/securecontent/`

---

## 1. Core Principles

| ID | Principle |
|---|---|
| `SC-A01` | Secure Content is a shared contract and implementation kernel, never a business authority. |
| `SC-A02` | Social and Conversation independently own routes, mutation UOWs, grants, persistence, and policy; an explicit owner-controlled read fence may wrap a caller's commit UOW. |
| `SC-A03` | Private plaintext and content keys exist only in authenticated Native runtimes and encrypted local stores. |
| `SC-A04` | Shared contracts are proto-first; Desktop and Mobile use one portable Rust implementation. |
| `SC-A05` | Station persists only ciphertext, commitments, routing metadata, and domain-authorized grants. |
| `SC-A06` | Public-readable routes use strict optional authentication: absent is anonymous; supplied invalid is `401`. |
| `SC-A07` | No partial recipient set, plaintext/public fallback, dual write, alias, or legacy read is legal. |
| `SC-A08` | Recovery and key-unavailable states are explicit, bounded, and independently verifiable. |
| `SC-A09` | Product evidence observes production-owned commit points and runtime identities; it never infers completion from time, duplicates business logic, or controls another owner's process. |

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
| W7S source checks pass but the Desktop lifecycle cannot execute without invented observation and fixture semantics | `verified_fact` | W7S checkpoint `6590d0997` and hard-cut plan execution discovery | high | runtime implementation and product evidence |
| The machine control plane already assigns deploy/restart authority to an exclusive runtime owner and resolves immutable runtime manifests | `accepted_decision` | `LDCP-D05`, local-dev-control-plane design sections 4.6 and 5 | high | W7 runtime evidence |
| Long-lived WebSocket/SSE connections cannot use socket closure or a quiet period as a deterministic capture boundary | `inference` | Desktop runtime owns persistent event streams and periodic reconciliation | high | acceptance observer implementation proof |
| Deterministic lifecycle barriers, restart continuation, stream watermarks, and provisioned fixture handles can close the W7S evidence gap without moving production authority | `accepted_decision` | accepted `SC-D21` | high | implementation and product evidence |
| The hard-cut plan's `one`/slot `0` commands conflict with the live `four`/slot `5` binding and machine-shaped work items | `verified_fact` | plan sections 4/8/12, work-item YAML, `make dev-check WORK_ITEM=secure-content-w11` | high | plan correction after decision acceptance |
| W7 runtime admission conflates the ephemeral client connection endpoint with the canonical endpoint bound by W12A schema activation | `verified_fact` | W7 checkpoint `15c0a7858`; `runtime_owner.py::_resolve_canonical_private_schema_attestation`; `runtime_manifest.py::_validate_services` | high | none |
| One owner-published service entry can carry separate connection and schema-attestation endpoints without creating another topology owner | `accepted_decision` | accepted `SC-D28` | high | implementation proof |
| Development runtime-manifest validation supports Desktop and Browser clients but has no Mobile client kind and requires one top-level profile | `verified_fact` | `tooling/development/secure_content/run.py::RUNTIME_CLIENT_KINDS` and `_load_runtime_manifest` | high | accepted `SC-D22` implementation |
| Mobile has generated Secure Content contracts but no private Social Native runtime or attachable product actions | `verified_fact` | `apps/mobile/src/gen/proto/domain/{secure_content,social}`, `apps/mobile/src-tauri/src/secure_content`, Mobile Moments/runtime inventory | high | W9 implementation and product evidence |
| `social_private_posts` is a mixed historical/canonical table name; the current migrator adds encrypted columns beside a possible plaintext-era schema | `verified_fact` | `migratePrivateContentPost`, `SocialPrivateContentPost`, W11 deletion commit `b8171e1f5` | high | accepted `SC-D23` and profile pre-audit |
| An allowlisted full private Development reset plus owner-mediated object deletion can remove mixed private state without touching public or Conversation truth | `accepted_decision` | accepted `SC-D23` | high | implementation and two-profile post-audit |
| Recovery admission verifies the predecessor journal digest before terminalizing the predecessor, but the terminal row cannot reproduce that old digest after its state or failure projection changes | `verified_fact` | W12A FIVEARM reset chain and `GORMSecureContentResetStore` | high | accepted `SC-D27` receipt implementation |
| `OBJECTS_DELETED` proves database commit and owner-mediated object deletion completed before deployment handoff begins | `verified_fact` | `SecureContentResetOwner.executeLocked` transition order | high | accepted `SC-D27` eligibility tests |
| Social `Audience.target_id` is `uint64`, while canonical Conversation IDs are validated strings | `verified_fact` | `model/domain/social/post.proto`; Conversation `valueobject.ConversationID` | high | accepted `SC-D29` hard-cut contract |
| `CUSTOM_DENY(PUBLIC)` cannot freeze a complete E2EE recipient set without an enumerable, revision-bound federated PUBLIC Actor authority | `verified_fact` | W8 audience result `b3890707...`; `GORMPrivateAudienceAuthority` | high | accepted v1 product narrowing and `SC-D29` |
| W8 runs only `station-four` and publishes no owner-produced remote-recipient identity handle | `verified_fact` | W8 runtime manifest `221d49c7...`; `runtime_owner.py::_run_w8_scenario` | high | accepted `SC-D29` fixture contract |

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
The shared components point downward. Social and Conversation never import each
other's implementation or mutate each other's truth; cross-domain reads use
explicit owner-provided capability ports.

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
| Historical Station proof verification keys | Federation authentication | append-only public-key history and current-key attestations |
| Social opaque-object lifecycle | Social | Social object repository/UOW |
| Conversation opaque-object lifecycle | Conversation | existing attachment repository/UOW |
| Private plaintext and root keys | Native client | encrypted per-account store |
| Physical opaque bytes | domain adapter | generic `storage.Backend` |
| Recovery identity/material | Recovery | opaque actor recovery revision |

Under accepted `SC-D15`, Actor Identity remains the sole source of verified device
signing keys and profile versions used to authenticate Content PreKey
publication. Key Exchange owns only the separate prekey pools, their monotonic
recovery-pool epoch, immutable tombstones, and exact claim receipts. It resolves
publisher keys through the Actor Identity capability and rechecks current
eligibility through an Actor Identity-owned row fence held by the Key Exchange
transaction before publication or a new claim exposes stored material.

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
| `CIRCLE` | Social Circle aggregate | typed numeric Circle ID + circle membership revision |
| `GROUP` | Conversation membership query port | typed string Conversation ID + membership epoch + head hash |
| `SELF` | Actor Identity active endpoints | actor profile version |
| `CUSTOM_ALLOW` | explicit actor list | canonical list hash |
| `CUSTOM_DENY` | explicit deny list over `FOLLOWERS` | canonical deny-list hash + follow-graph revision |

`friend_chat_friendships`, mutual-follow inference, and direct Conversation presence
are not FRIENDS truth. Social replaces the production GROUP Noop with a narrow
Conversation read port; it does not read Conversation tables.

`Audience` uses a discriminated target: `circle_id` is a numeric Social
aggregate identity and `group_conversation_id` is a canonical string
Conversation identity. The retired ambiguous `target_id` name is reserved.
The Conversation-owned query port prepares a snapshot through its own UOW.
During submit it opens a read-only transaction, locks its canonical row,
revalidates the snapshot, invokes the Social commit callback, and releases the
fence afterward. The callback receives only the verified snapshot. The lock
direction is Conversation fence then Social UOW, and Conversation operations
never acquire Social locks. Social never imports Conversation persistence or
mutates Conversation state.

Before any Content PreKey claim, Actor Identity resolves the canonical Home
Station for every recipient selected by FRIENDS, FOLLOWERS, CIRCLE, or CUSTOM;
GROUP uses Conversation's member Home Station projection. Social binds the
locality projection into the authorization snapshot. Actor Home Station is
immutable for a canonical PTID in v1; submit verifies the stored locality
commitment. Owner adapters are read-only and never call back into Social. Any
remote recipient makes the entire v1 private publish unsupported; no audience
path may drop remote recipients and continue.

This paragraph remains the current implementation baseline and the rollback
guard for the completed same-Station milestone. The target replacement is
defined by `FHSA-D08..FHSA-D15`; it may be removed only by the atomic cutover
in the 2026-10-03 cross-Station Social plan.

`CUSTOM_DENY(PUBLIC)` is unsupported in v1. A public route has no finite,
revision-bound recipient set suitable for immutable E2EE envelope coverage.
Adding it requires a later product and architecture decision that introduces a
complete federated PUBLIC Actor authority; local Actor enumeration is forbidden
as a substitute.

## 8. Private Publish

```text
Native -> Social prepare(content_id, typed audience, command_id)
Social:
  resolve recipient actors and current deny rules
  query Conversation only for a same-Station GROUP snapshot
  validate every recipient Home Station through Actor Identity
  reject remote recipients and CUSTOM_DENY(PUBLIC) before PreKey claim
  persist PREPARING identity plus exact Key Exchange claim request
  claim one-time endpoint and recovery Content PreKeys from Key Exchange
  persist exact claim response, claimed slots and an expiring signed PREPARED plan
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

### 8.1 Accepted Content PreKey Client Boundary

Accepted `SC-D20` makes the existing Key Exchange publication/inventory
capability usable by authenticated Native clients without creating a Secure
Content service:

```text
Native encrypted key store
  -> device-possession proof + canonical protobuf
  -> /key-exchange/content-prekeys/{publish,inventory}
  -> Key Exchange pool/receipt transaction
  -> Actor Identity verified-device fence
```

JWT authenticates the actor/session only. A fresh Ed25519 proof binds the local
Station peer ID, JWT session ID, active device, capability, request hash, nonce
and issued-at; `X-Device-ID` is only a consistency assertion. Key Exchange owns
the routes, pools, publication receipts and API capability entries. The shared
server owns transport parsing through a model-neutral error-projector port; Key
Exchange supplies the shared protobuf `ErrorResponse` projection.

W7A owns the server/proto/API source closure with no runtime claims. W7 owns the
Desktop encrypted private-key store, process-scoped maintenance supervisor,
unknown-outcome reconciliation, per-key root-commit deletion and Native
product evidence. Claim and claim-validation capabilities remain internal to
domain prepare/submit workflows.

`SC-D17` makes the prepare crash boundary explicit:
`social_private_content_plans` persists `plan_id` and the canonical prepare hash
plus the exact canonical claim request before Key Exchange is called. It then
persists the exact claim response, while `social_private_content_plan_slots`
finalizes the exact claimed PreKey and principal epoch for each slot. Submit owns
`social_private_command_receipts` in the same Social UOW as the resource and
all dependent writes. W6 owns this shared substrate before W5 adds recovery
queries.

Submit revalidates current FRIENDS authority, every endpoint slot's Actor
Identity profile/activity, and every recovery slot's current Key Exchange pool
epoch. Drift rejects the complete plan without partial resource writes. Exact
submit replay returns the persisted business result and derives the
`exact_replay` response flag at read time rather than storing two result forms.

### 8.2 Social Object Transfer

`SC-D18` separates typed control from bounded ciphertext bytes:

```text
Native -- typed begin/status/complete/cancel --> Social object application
Native -- raw bounded chunk PUT -------------> Social storage adapter
Social object application -------------------> stateless Secure Content kernel
Social storage adapter ----------------------> generic storage.Backend
Social submit UOW ----------------------------> attach object + grants
authorized Native -- raw range GET ----------> Social grant check + storage
```

Begin requires a deterministic object ID from a durable private-content plan and
the authenticated author endpoint. Chunk replay is exact by upload generation,
index, offset, size, body hash and idempotency key. Complete verifies every
chunk and whole-object commitment before producing one canonical
`COMPLETE_UNATTACHED` descriptor. It cannot attach or grant the object.

Only the Post/Comment submit UOW may transition the descriptor to
`ATTACHED(domain_commit_id)` and persist endpoint/recovery grants. Object GET
rechecks current resource authorization and requires an active Actor Identity
endpoint plus either that endpoint's exact grant or the same actor's recovery
grant before opening the opaque storage key. The recovery grant lets a newly
recovered active endpoint fetch ciphertext without creating a server-side key
transfer; the recovery secret is still required to decrypt. Missing and
unauthorized IDs share one not-found response. Generic storage has no actor,
audience, resource or grant authority.

### 8.3 Proposed Deterministic Product-Evidence Boundary

Accepted `SC-D21` defines a Development/Acceptance observation boundary around
the existing production path. It adds no alternate publish, read,
authorization, crypto, persistence, or runtime lifecycle implementation.

```text
External scenario
  -> attach through immutable runtime manifest
  -> invoke production Desktop/Browser intent
  -> wait on acceptance-only observation barrier
       -> production Native store/transport/store boundary
       -> production Browser network observer event loop
  -> request runtime-owner action when restart is required
       -> runtime owner acquires lease and restarts
       -> fresh immutable child manifest
  -> continue through the new manifest
```

The lifecycle observer exposes exactly three named barriers:

| Barrier | Production-owned fact observed | Required ordering |
|---|---|---|
| `persisted-before-send` | encrypted private material, proof-free command bytes/hash, command state, and the session-generation send lease committed through the production store | before the production transport is invoked |
| `sent-before-response` | the production transport accepted the exact request for dispatch and the response has not yet been projected | after dispatch acceptance and before response handling |
| `response-before-local-commit` | a validated production response exists while the corresponding command/root-key projection has not yet committed | before the production store transaction that advances local state |

Each barrier is acceptance-build-only, one-shot, operation-scoped, and keyed by
runtime boot identity plus session generation. It delegates observation to the
production owner, returns only bounded state names and opaque digests, and may
pause the production path until the external controller releases the same
barrier token. Missing, duplicate, out-of-order, stale-generation, or
wrong-boot tokens fail closed. Production builds expose no controller.

Forced restart is a request/acknowledgement protocol, not a scenario command.
The scenario persists a source-bound resume artifact and requests an action
from the W7 runtime owner. The owner alone acquires the required lease, stops
and starts the selected process while preserving the declared client storage,
then publishes a fresh immutable runtime manifest. Continuation requires:

- the child manifest names the parent manifest digest and restart request ID;
- source, profile, client identity, and retained-storage identity still match;
- Native boot identity changed and session generation did not regress;
- the old manifest is never reused for post-restart commands.

The Browser network observer assigns a monotonic sequence to every observed
HTTP request and WebSocket/SSE open, frame, error, and close event. A capture
ends only when an explicit terminal marker is enqueued on the same observer
event loop after the production action resolves. Persisting that marker proves
that every earlier queued event belongs to the closed capture interval.
Socket closure, sleep, polling silence, and timeout expiry are not terminal
evidence.

Account switch, Station switch, publisher-device revocation, and historical
recovery epoch enter a scenario only as immutable, digest-bound fixture handles:

| Fixture | Truth owner | Scenario-visible input |
|---|---|---|
| account switch | Actor/session provisioner | two provisioned account/session handles and expected storage identities |
| Station switch | environment/runtime provisioner | two approved Station binding handles and expected Station identities |
| publisher-device revocation | Actor Identity provisioner | device handle plus typed revoke action and committed profile/revocation acknowledgement |
| historical recovery epoch | Recovery + Key Exchange provisioner | actor/recovery fixture handle, historical epoch, and secret-channel reference |

Scenarios cannot create actors, PTIDs, device keys, Station profiles, recovery
epochs, or revocation state. Secret fixture material is injected directly into
the owning Native runtime and is never returned in scenario output or evidence.
Unavailable handles produce a typed fixture blocker; they never authorize
database mutation or synthetic in-memory state.

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

Under accepted `SC-D19`, Social verifies the stored commit proof through the
Federation-owned retained public-key resolver before projection. The response
adds a fresh fixed-size attestation signed by the currently trusted Station
key, allowing a newly recovered Native client to verify an older proof without
retaining old private keys or trusting the Social database as key authority.

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

### 10.1 Accepted W1 Wire Closure

> **Status**: accepted by Owner on 2026-09-14.

The W1 generated-contract cutover requires four additional protocol rules:

1. A private video owns one encrypted source object, an optional encrypted
   poster, and at most eight encrypted variants. Every variant has an opaque
   variant ID, codec, bitrate, dimensions, and its own
   `PrivateAttachmentMetadata`; Station sees only the referenced object
   descriptors.
2. A private repost contains a non-recursive immutable rendered-source
   snapshot. The snapshot may contain TEXT, IMAGE, VIDEO, LINK, POLL, or
   LOCATION, but never another rendered repost. This prevents attacker-chosen
   recursive payload depth while preserving the exact source presentation
   available at publish time.
3. Mention delivery uses one signed routing bundle per resource. Each fact
   contains only the mentioned actor and a salted, domain-separated HMAC
   commitment to the canonical encrypted-payload `Mention`. Station verifies
   the author-device signature and that every routed actor belongs to the frozen
   grant; Native verifies exact fact-to-payload coverage after decryption.
4. Prepare, submit, point-read, comment-list, poll-vote, and recovery-list
   responses are typed, idempotent, and viewer-scoped. Submit accepts the
   prepared plan, encrypted payload, exact slot envelopes, object descriptors,
   optional subtype authority, and the signed mention bundle in one command.
   Prepare commits a non-zero Social subtype and the complete poll or repost
   authority through the plan's domain-binding hash before PreKey claims.
   Recovery entries carry a typed Post or Comment locator for the existing
   domain point-read route. Private reads carry a viewer-safe verification
   projection containing a Station-signed commit proof, the signed mention
   bundle, and only the applicable poll or repost authority.

Station validates only visible authority, signatures, hashes, frozen grants, and
the signed subtype/domain binding. Sender Native validates plaintext subtype
content against that authority before encryption, and recipient Native repeats
the equality checks after authenticated decryption. Station never infers
encrypted fields from visible metadata.

Repost authority uses a discriminated source proof. PUBLIC sources bind the
dedicated immutable, non-recursive public snapshot hash; that snapshot excludes
stats, viewer interaction, audience envelopes, and nested repost state while
retaining source-owned public media references. Private sources bind the private
resource, authorization snapshot, encrypted-payload hash, and source viewer
commit proof. Both bind the source Post locator, source author, and deterministic
rendered-snapshot commitment. The commitment is a domain-separated HMAC keyed
by a random salt inside the encrypted repost payload, preventing Station from
enumerating low-entropy quoted text or locations. PUBLIC normalization carries
canonical typed mention offsets and forbids legacy username-only mention arrays.
Because private repost recipients are a subset of source recipients, recipient
Native can validate the authenticated source and reject fabricated quoted
content or author attribution without exposing snapshot plaintext to Station.
Rendered-source media remains source-owned and is fetched under current source
authorization; the repost UOW neither copies nor grants those objects. Source
deletion or revocation therefore suppresses the rendered snapshot instead of
preserving a bypass copy.

The Station-signed viewer commit proof is finalized and persisted inside the
same Social UOW and exact command receipt as the resource. Signing failure rolls
back the UOW; replay returns the stored proof bytes across crash or signing-key
rotation.

Canonical mention-routing bytes contain, in field order:

```text
format_version
resource(owner_domain, content_id, generation)
authorization_snapshot_sha256
encrypted_payload_sha256
sorted facts(mentioned actor canonical bytes, mention_commitment)
sender ActorDeviceRef
sender_signing_key_id
```

Facts sort by canonical actor bytes and then commitment bytes. Duplicate
`(actor, commitment)` pairs or duplicate commitments, an actor outside the
frozen grant, extra/missing payload mentions, a resource/snapshot mismatch, or
an invalid signature is terminal rejection. Multiple distinct commitments for
the same actor are valid and represent separate mention occurrences. Exact
command replay returns the original result; the same command ID with another
canonical request hash is conflict.

The mention commitment is a domain-separated HMAC over deterministic `Mention`
bytes using a random 32-byte per-resource salt stored only inside the encrypted
payload. The routing signature therefore binds the complete encrypted payload
without exposing a low-entropy offset/display hash that Station can enumerate.

Prepare, submit, and poll-vote request hashes use the dedicated canonical hash
input messages in `data-model.md`, not the transport request bytes. Repeated
envelope, object, mention, audience-actor, and poll-option commitments are sorted
by their specified stable identity before deterministic protobuf encoding.
Unknown fields, duplicate identities, non-canonical order, or a transport field
that cannot be represented by the hash input is terminal rejection.

## 11. Authentication And Response Projection

- no Bearer header: anonymous public lookup only;
- valid live Bearer: canonical actor subject;
- malformed, invalid, expired, or revoked supplied Bearer: `401`;
- private read additionally requires an active device;
- unauthorized private lookup uses one not-found wire shape;
- ordinary response includes at most the caller's endpoint envelope;
- recovery response includes only the caller actor's claimed recovery envelope;
- author audience administration is a separate metadata-only route.
- `GET /api/v1/social/moments/:id` accepts the path ID only and returns
  `GetMomentResourceResponse`; its public fields remain wire-compatible with
  `GetPostResponse`, while field 3 carries the typed public/private resource;
- `GET /api/v1/social/moments/:id/comments/:comment_id` returns
  `GetMomentCommentResourceResponse`; recovery locators use these same bounded
  domain-owned point-read routes and never require comment-list traversal.

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

## 13. Accepted Remaining-Hard-Cut Control Plane

Accepted `SC-D22` and `SC-D23` close the remaining evidence and destructive
execution boundaries. Implementation and reset remain subject to the formal
plan, exact declarations, authorization, runtime leases, and evidence gates.

### 13.1 Runtime topology and ownership

```text
Local Dev Control Plane
  workspace 9eb2cb904c9ae460
  canonical binding: profile four / slot 5
                 |
                 v
Platform runtime owner
  -> deploy/attest station-four
  -> deploy/attest station-five-arm when the Journey requires it
  -> launch isolated Desktop/Browser/iOS-Simulator/Android-Emulator clients
  -> publish one immutable Development Runtime Manifest v3
                 |
                 v
Secure Content Development runner
  -> validate exact source + service/client closure
  -> attach only
  -> invoke production Harness actions
  -> write per-variant Development results
```

The manifest's `services` map and each client's `service_bindings` are the only
topology truth. Under accepted SC-D28, each Station service carries both the
runtime connection `endpoint` and the profile-owned
`schema_attestation_endpoint`. The former binds live client routing, service
attestation, and Harness identity; the latter binds only the canonical
deployment identity already committed by W12A schema activation. Neither
endpoint may be inferred from the other or from profile names, service IDs, or
CLI order. The runtime owner may select an already approved secondary profile
while holding the declared resources, but it restores the canonical
`four`/slot `5` workspace binding before manifest publication. The business
runner cannot create a profile, deploy a service, launch a client, allocate
storage, or infer a Station from CLI order.

Development client kinds are `native-tauri`, `browser`,
`tauri-ios-simulator`, and `tauri-android-emulator`. Physical Mobile devices
remain formal Acceptance resources. Missing platform support, source equality,
service attestation, client isolation, live identity, or Fixture capability
fails before the first product action.

### 13.2 Product evidence partition

Evidence identities remain domain-specific:

- `SOC-SEC-AS01..AS16` keep the meanings in the Social acceptance matrix;
- `MP-G13` and `MP-J11` identify unchanged Chat attachment behavior;
- `sc-dj-social-uow-atomicity`, `sc-dj-hardcut-regression`, and
  `sc-dj-authorized-reset` remain Development infrastructure/Journey IDs.

No API response, static check, source scan, deployment health result, old
checkpoint, or one-platform result can be promoted into a receiver-visible
product pass. W7, W8, W9, W10, W11, and W12 each aggregate only current child
results from their exact required runtime/platform variants.

### 13.3 Reset ownership

SC-D23 defines one full purge of private Social Development state on only
`four` and `fiveArm`, followed by canonical schema rebuild. It preserves public
Social and every non-Social authority.

```text
immutable pre-audit + object target manifest
  -> quiesce Station under station.reset lease
  -> one allowlisted database/schema transaction
  -> owner-mediated idempotent object deletion
  -> canonical Station deploy + health
  -> byte-equal public post/comment/reaction/object audit
  -> COMPLETE
```

Accepted SC-D24 reuses this exact owner path for two separately authorized
intents:

```text
SCHEMA_ACTIVATION
  -> complete SC-D23 reset on four and fiveArm
  -> publish canonical schema attestations
  -> admit W7-W11 private product Journeys

FINAL_CUT
  -> fresh complete SC-D23 reset on four and fiveArm
  -> repopulate only through the complete product matrix
  -> admit final formal proof
```

SC-D24 supersedes only SC-D23's W12-exclusive task timing. It does not widen
the accepted target profiles, scopes, tables, predicates, columns, object
owners, public snapshot, journal, or failure contract.

Local Dev Control Plane owns declaration and `station.reset` lease truth. The
Secure Content Development reset owner owns manifest, quiescence, journal, and
orchestration. Social and OSS remain the only database/object mutation owners
behind a non-public Station maintenance entrypoint. Product scenarios remain
attach-only and cannot invoke DDL, SQL, or object deletion.

The maintenance entrypoint is an OS-authenticated remote CLI, not an API. It
accepts one bounded invocation over the reviewed deploy transport;
the local SSH transport is a child of the generic Local Dev lease wrapper,
which retains the inherited advisory lock. Replay, expiry, source/scope
mismatch, cancellation, disconnect, or lease loss fails closed at the last
durable journal boundary.

SC-D25 closes the source-invalidation boundary without another reset owner. A
fresh authorized invocation may atomically supersede an older journal only
while that journal is still `PREPARED`, only for the same workspace, profile,
environment, scope, and intent, and only when the source commit differs. The
old immutable manifest and history remain durable under terminal
`SUPERSEDED`; any post-commit journal must resume from its original manifest.
The old scope is never released outside the transaction that creates the new
`PREPARED` journal.

SC-D26 closes two narrow post-commit source-defect boundaries. The canonical
`SocialPrivateContentPlan` model becomes the only schema owner for its table,
including the six durable audience, Group-recipient-snapshot, and subtype
prepare-binding columns. When an
older reset is either unfailed at `OBJECTS_DELETED` or exactly
`STATION_DEPLOYED` with `RESET_SCHEMA_TARGET_UNREVIEWED`, the corrected source
may create a fresh manifest containing an immutable predecessor link. Fresh
invocation admission must revalidate the old manifest and pre-transition
journal digests, equal scope/database/public identities, and different
source/reset identities under the same advisory lock.

The Station transaction then terminalizes the old journal as
`RECOVERY_REPLACED` while creating the fresh `PREPARED` journal. It never
deletes or relabels old evidence, never treats old mutation as fresh success,
and never allows another post-commit failure class through this path. The
fresh reset repeats the complete SC-D23 operation and walks the bounded,
cycle-free predecessor chain to re-verify every inherited object target through
its original owner before post-audit passes. It is the only reset that can emit
the new source's schema attestation.

SC-D27 separates the immutable predecessor link used to authorize
admission from an append-only replacement receipt proving execution. The
receipt is Station-owned and commits with the predecessor
`RECOVERY_REPLACED` transition, fresh `PREPARED` journal, and first successor
invocation. It preserves the predecessor's original failure while recording a
separate replacement reason.

The closed matrix additionally admits:

- `OBJECTS_DELETED + RESET_PARTIAL_FAILURE`, because this state is reachable
  only after the database transaction and every owner-mediated object deletion
  completed and before deployment was accepted; and
- `STATION_DEPLOYED + RESET_JOURNAL_STATE_CONFLICT` only for a recovery
  successor whose complete predecessor chain validates under the admission
  transaction.

The pre-transition journal digest remains an admission-time compare-and-swap
token. Terminal validation verifies the immutable link, replacement receipt,
terminal transition, identities, bounded ancestry, and target ledgers; it does
not attempt to synthesize the old digest from a terminal row.

The reused `social_private_posts` table is cleared and rebuilt; it is never
dropped by prefix. The only retired table that may be dropped is
`social_private_audience_grants`. Legacy shared rows are selected by exact
predicates, and object deletion uses an immutable owner/reference/digest
allowlist. Unknown data shape, cross-domain reference, lease loss, manifest
change, or public hash drift is a typed partial failure. Station does not start
from a partial reset.

## 14. Architecture Gates

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
11. Product evidence uses the `SC-D21` barriers, manifest lineage, stream
    terminal watermark, and owner-provisioned fixture handles without
    timing-based completion or scenario-owned runtime mutation.
12. Accepted `SC-D22` governs every Mobile/multi-profile Development manifest
    implementation and product pass.
13. Accepted `SC-D23` governs W12 reset capability and every database/object
    mutation.
14. W7-W12 results bind current immutable manifest digests and keep Social,
    Chat, infrastructure, Development, and formal Acceptance evidence distinct.
15. `SC-D28` keeps canonical schema-attestation identity separate from live
    connection routing, with both endpoints owner-published and fail-closed.

## 15. Non-Claims

- Current private Moments are not claimed secure.
- Chat and Social do not share business authorization.
- Stored content does not provide post-compromise forward secrecy after recovery
  secret compromise.
- Current implementation still rejects cross-Station private Social delivery
  until the `federated-social-activity` successor plan completes its atomic
  cutover; the target architecture is governed there.
- This design authorizes no reset, deployment, commit, or implementation.
- `SC-D22` and `SC-D23` authorize only the accepted Development topology and
  reset semantics; they do not establish functional or formal evidence.
