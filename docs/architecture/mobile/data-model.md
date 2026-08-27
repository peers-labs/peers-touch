# Mobile Shell — 数据与 Proto 映射

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-27 | **Updated**: 2026-08-27
> **Owner**: Mobile Architecture Team

---

## 1. Mapping Rule

Prototype types are presentation fixtures. Production view models are derived
from generated proto plus device-local UI state; they never become parallel
domain contracts.

Actor identity is a stricter boundary:

- `ptid: string` is the only actor identity accepted by Mobile API gateways,
  runtimes, stores, persisted caches, commands, events, and routes.
- Numeric `actor_id` and aliases such as `actor_did` are not Mobile view-model
  fields. A migration-only gateway may discard legacy fields but must not expose
  them; the target Station endpoint no longer emits them.
- Auth/session activation requires a generated `ActorRef` with non-empty
  `ptid`; display names and `acct` cannot substitute for it.

## 2. Prototype To Canonical Contract

| Prototype concept | Canonical source | Local projection only |
|---|---|---|
| `StationEntry` | verified `station_peer_id` handshake plus device-local URL registry | selected/checking/error |
| `Conversation` | `chat.Conversation`, `FriendChatSession`, `Group` | preview, badge, pin sort |
| `Message` | `FriendChatMessage`, `GroupMessage`, `CommittedConversationEvent` | selection, menu anchor, draft |
| `MessageStatus` | `FriendMessageStatus`, `MessageDeliveryState`, receipts | display label |
| `MessageReply` | `reply_to_*` plus referenced message projection | truncated preview |
| `MessageReaction` | `ReactionEvent` / `ReactCommand` | picker open state |
| pinned message | `PinEvent` / `PinMessageCommand` | active pinned panel |
| thread | `thread_root_*` and message query | open thread route |
| `Contact` | `ActorProfile`, friendship/session projection, presence | grouping/search text |
| `GroupItem` | `Group`, `GroupMember` | list preview |
| `Moment` | `social.Post`, `PostAuthor`, `ReactionSummary` | expansion state |
| `MomentComment` | `social.Comment` | reply composer state |
| profile | `ActorProfile` | current detail route |
| settings | `ActorPreferences`, notification preferences, device config | selected section/draft |

## 3. Proto Requirements

### 3.1 Reuse without schema change

- Station access and gate chain: `access_gate/access_gate.proto`, `auth/auth.proto`.
- Friend/group chat, attachments, replies, edits, recalls, settings and search:
  existing `chat/*.proto`.
- Reactions, pins, forward proposal delivery, thread list/count, and durable
  command results: `chat/conversation.proto` and `chat/conversation_api.proto`.
- Moments feed, audience, media and reactions: `social/post.proto`.
- Comments and replies: `social/comment.proto`.
- Profile and relationship: `actor/actor.proto`, `social/relationship.proto`.
- Presence, notifications, runtime events: `presence/`, `notification/`,
  `realtime/event.proto`.

Reuse is permitted only after endpoint, generated-binding, identity, idempotency,
and readback semantics are verified. The existence of a message in Proto does
not prove that Station and Mobile currently expose the full product operation.

### 3.2 Required contract gaps

| ID | Required semantic | Owner | Existing evidence | Required target contract |
|---|---|---|---|---|
| MS-P01 | PTID-only login/OAuth session identity | Model + Station auth | Auth responses and current `ActorRef` expose legacy numeric identity | Mobile-facing auth contracts contain a PTID-only actor reference; numeric fields are removed from the target wire contract and discarded only during bounded migration |
| MS-P02 | OAuth provider attempt | Model + Station OAuth | `OAuthBridgeRequest/Response` only model gateway bridge output | Start request/response binding provider, Station, access attempt/gate, redirect URI, PKCE challenge, nonce hash, opaque OAuth attempt/state, and expiry |
| MS-P03 | OAuth callback completion/status | Model + Station OAuth | No one-time Mobile callback contract | Complete/status response atomically consumes the OAuth attempt and returns typed expiry/replay/mismatch result, PTID-bearing session candidate, and re-evaluated `AccessDecision` |
| MS-P04 | Mutation outcome lookup | Owning Model/Station domain | Conversation command result exists; coverage is not universal | Query by stable command ID or authoritative entity/event readback for every offline-retriable mutation |
| MS-P05 | Complete account preferences | Model + Station actor/preferences | Product fields exceed currently verified API coverage | Generated account preference read/write contract for accepted cross-device fields |
| MS-P06 | Durable Mobile command envelope | Model + Mobile reliability | No canonical cross-Web/Rust ledger contract | Typed command kind and `oneof` payload, `station_peer_id`, actor PTID, command ID, ordering key, timestamps, state, typed error, and schema revision |
| MS-P07 | Station identity/capability handshake | Model + Station core | Current probe proves only URL reachability/label | Signed response with stable `station_peer_id`, canonical origin, protocol/capability set, expiry, and challenge binding |
| MS-P08 | Device-local draft envelope | Model + Mobile storage | Chat/Moments drafts are component-local | Typed surface/target, `station_peer_id`, actor PTID, text, encrypted attachment references, audience, and update time |

These are architecture requirements, not permission to bump a protocol version.
Exact message names, field numbers, compatibility policy, and any version change
require their own reviewed Model change.

OAuth attempt state:

```text
idle -> starting -> awaiting-provider -> callback-received -> exchanging
     -> session-candidate-issued -> access-gate-chain
     -> active-session (only after final access grant)

starting|awaiting-provider|callback-received|exchanging
  -> cancelled|expired|failed
```

Station owns attempt identity, provider/Station/redirect binding, PKCE challenge,
nonce hash, opaque state, access attempt/gate binding, expiry, and atomic
one-time consumption. Mobile secure storage owns the PKCE verifier, nonce, and
any attempt-scoped session candidate. The candidate cannot authorize business
calls. The Web UI sees only projected state.

`station_peer_id` from the verified handshake is the canonical Station scope for
OAuth, sessions, caches, and command records. URL is a mutable connection hint.
A saved URL returning another peer ID is a terminal identity mismatch and
requires explicit Station replacement; it cannot inherit the old scope.
The explicit first-add action pins the peer ID after challenge-signature
verification; subsequent URL edits or redirects cannot silently replace it.

### 3.3 Contract wiring before schema extension

- Forwarding should be modeled as a new send command referencing source content
  only if current command APIs cannot express the accepted audit semantics.
- Thread list/count should use `thread_root_message_id` queries before adding a
  separate thread entity.
- Moments reactions/comments must use existing `social/post.proto` and
  `social/comment.proto` unless endpoint verification proves a semantic gap.

### 3.4 Explicit non-gaps

| Concept | Owner | Contract disposition |
|---|---|---|
| Station registry | Mobile device | Remains local unless product scope later requires cross-device sync |
| User message flag | Mobile device | Remains local under MS-C14 |
| Chat Docs tab | deferred product domain | No schema under current scope |
| Device preferences | Mobile device | No shared Proto; use a typed Tauri contract only when crossing Web/Rust |
| Navigation and overlay state | Mobile navigation | Never enters business Proto |

## 4. Durable Command Projection

The local command ledger is a device-owned reliability projection, not shared
business truth:

```text
MobileDurableCommand {
  schema_revision
  command_id
  station_peer_id
  actor_ptid
  origin_generation // diagnostics only
  ordering_key
  command_kind
  oneof typed_payload
  created_at
  attempt_count
  state
  last_error_code
}
```

Command state:

```text
queued -> submitting -> committed
                  \-> failed-retryable
                  \-> failed-terminal
                  \-> unknown-outcome -> reconciling
                                           |-> committed
                                           |-> retry-authorized
                                           \-> unresolved
```

The envelope is a generated Proto contract, not `string type + opaque bytes`.
Station commit/result remains authoritative. `origin_generation` rejects stale
callbacks in the originating process but does not gate restart recovery. After
restart, exact Station/PTID scope is verified and the record is rebound to the
new in-memory generation.

The single persistent owner is a transactional encrypted store in
`mobile-rust`; mobile-web accesses it only through typed Tauri commands. The
platform secure-storage key protects the store. Tokens, provider secrets, PKCE
material, nonce, and media bytes are forbidden; media commands persist only
encrypted blob references.

`CommandAdmissionPolicy` is normative:

- at most 512 unresolved records and 16 MiB per Station/PTID partition;
- at most 256 KiB serialized payload per record;
- one inflight command per `ordering_key`, with four keys active concurrently;
- round-robin scheduling across keys prevents one conversation/domain from
  starving others;
- `unknown-outcome` blocks its ordering key until readback resolves it;
- capacity exhaustion returns typed `COMMAND_LEDGER_FULL`; no unresolved record
  is dropped, overwritten, or silently evicted;
- state transitions and attempt counters commit atomically with crash recovery;
- unsupported schema revision fails closed and requires an explicit migration,
  never best-effort decoding.

## 5. Device-Local Draft Projection

Chat and Moments drafts are local product state, not Station truth. Their
generated envelope is keyed by `station_peer_id + actor_ptid + surface_kind +
target_id` and stores text, encrypted attachment references, audience, and
`updated_at`.

The single persistent owner is an encrypted `mobile-rust` draft store.
mobile-web owns editing state and writes through typed Tauri commands. A draft
is deleted only after authoritative commit, explicit discard, or confirmed
scope removal. It is never replayed as a command and never exposed under another
Station/PTID scope.

## 6. JSON To Generated-Proto Cutover

Target boundary:

```text
Page -> view projection -> runtime -> generated Proto gateway -> Station
```

Temporary JSON decoding is allowed only inside a domain API gateway and must
immediately normalize into generated-contract semantics. A JSON DTO cannot be
imported by pages, stores, runtime public APIs, storage, or native plugins.

A domain deletes its old JSON/manual path only when all of the following hold:

1. Station endpoint and event parity are verified for reads, writes, typed
   errors, pagination, identity, and idempotency.
2. Mobile gateway tests prove Proto encode/decode and legacy-ingress parity.
3. Runtime/store consumers use one canonical projection.
4. Native two-actor readback passes for that domain.
5. Repository scans find no imports of the retired DTO outside the quarantined
   adapter.

After those conditions pass, the compatibility adapter and duplicate manual
types are deleted in the same change. Permanent dual paths are forbidden.
