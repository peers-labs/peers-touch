# Self-Direct Conversation (Saved Messages)

Status: accepted design — 2026-10-31
Owner: Client Platform / Conversation domain
Related:

- `docs/architecture/domains/chat/lifecycle/design.md`
- `docs/architecture/domains/chat/messaging/design.md` §5 Command/event contract, §11 Multi-device
- `docs/architecture/domains/chat/encryption/design.md` §4 Direct Session Contract
- `docs/architecture/domains/chat/messaging/decisions.md` MP-D06 (Direct session per endpoint pair)

## 1. Product requirement

An authenticated actor needs a private, cross-device conversation with
themselves ("Saved Messages" / 给自己发消息): notes, forwarded messages, files
and media, reachable from the contact list, synchronised to every device the
actor owns on the same Home Station.

Non-goals:

- server-side plaintext notes storage distinct from the messaging pipeline;
- sharing or inviting other actors into the self conversation;
- federation: the self conversation is always Local scope on the actor's Home
  Station.

## 2. Design decision: one-member DIRECT, not a new conversation kind

The system already models three conversation shapes: human Direct (exactly
two distinct active members), Group (N members), and system-direct (service
actor ↔ human). Adding a fourth shape (a dedicated self kind, or a local-only
notes store) would fork the command/event, delivery, crypto, sync, projection,
search and attachment pipelines — a second chimney that would have to be kept
feature-parallel forever.

Instead, **self-direct is a `DIRECT` conversation with exactly one active
member — the creator**. Every existing rule is a strict generalisation of the
two-actor rule:

| Property | Direct (today) | Self-Direct |
|---|---|---|
| `ConversationKind` | DIRECT | DIRECT (unchanged) |
| Active members | 2 distinct actors | 1 actor |
| Deterministic id | `direct-<sha256(pair)[:16]>` | `direct-self-<sha256(ptid)[:16]>` |
| Scope | Local or Federation | always Local |
| Devices | union of both actors' active endpoints | the actor's own active endpoints |
| Delivery to sender device | `public_event` | `public_event` (unchanged rule) |
| Delivery to other devices of the sender actor | `direct_ciphertext` per endpoint | `direct_ciphertext` per endpoint (unchanged) |
| Read receipts | peer read cursor | no peer; own cursor only, never unread |

The existing delivery-kind rule already covers the topology:
`recipient == command.Sender` (full endpoint comparison) → `public_event`;
every other required recipient, including the sender's *other* devices, →
`direct_ciphertext`. A single-device self-direct therefore needs exactly one
public-event delivery to the sender endpoint; a multi-device actor gets the
same plus one pairwise Direct session per other own device — precisely the
fan-out a normal Direct already performs toward the sender's other devices.

Nothing in the proto contract changes: `CreateDirectConversationRequest`
already carries only `peer_ptid`; the server detects `peer_ptid == creator
ptid` and takes the singleton branch. The member set on the returned
`Conversation` is the discriminator for clients.

## 3. Conversation identity

`valueobject.SelfDirectConversationID(actor)`:

```
"direct-self-" + hex(sha256("peers-touch/self-direct-conversation" ‖ ptid))[:16]
```

- Distinct prefix means a self id can never collide with a pair id and is
  self-describing in logs and database rows.
- Deterministic, idempotent: repeated create calls are replays of one
  conversation, exactly like the pair path.
- `DirectConversationID(left, right)` keeps its current contract (two distinct
  actors). All direct-id computation is dispatched through one helper that
  routes equal actors to the self id; no caller special-cases ad hoc.

## 4. Domain rules

### 4.1 Aggregate

`aggregate.CreateDirect` accepts:

- `len(Participants) == 2` with two distinct actors (current behaviour), or
- `len(Participants) == 1` (self-direct): the sole participant is the creator,
  owner is that actor, membership epoch 1, MLS epoch 0 — same `create()` path.

`create()` already dedups actors and validates devices against the active
member set, so a singleton with N own devices needs no new device rules.

`validateDirectInvariant` is generalised:

- one active member ⇒ id must equal `SelfDirectConversationID(member)`;
- two active members ⇒ current pair rules;
- zero or >2 ⇒ invalid.

### 4.2 Application/command

`CreateDirectRequest` handling:

- when `Peer == Creator.Actor`, scope is forced Local (resolved with the local
  station; federation resolution is skipped and a federation-claiming request
  is rejected), and the route set is the creator's own active endpoints;
- `participantsAndDevices` and `creationDeliveries` already operate on the
  unique-actor route set, so singleton inputs flow unchanged;
- `validateExistingDirect` / `existingDirectCanReopen` accept the singleton
  shape using the same member/id/scope matrix.

System-direct stays on the pair id helper and remains two distinct actors;
self-direct never uses the system-plaintext delivery kinds.

### 4.3 Gate

Social gate evaluation for `create_direct` with target == subject:

- Local scope only;
- subject must be an active local actor with the creator endpoint active;
- no friendship/follow precondition (you cannot be required to friend
  yourself). The gate evaluator returns its plain allow (the error/nil gate
  contract has no typed allow-reason channel); audit distinction comes from
  the operation itself, where target equals subject and the scope is Local.

### 4.4 Messages and receipts

Message submission is unchanged: required endpoints are the active endpoints
of the sole member. The client crypto layer must allow the case "required
endpoints minus local endpoint is empty" (single device) — the command then
carries only the public-event delivery to the sender. With other own devices,
pairwise Direct sessions are bootstrapped exactly as cross-actor sessions;
the X3DH/key-exchange endpoint must serve own-device bundles (verified during
implementation; the bundle store keys by endpoint, not by actor inequality).

Read state needs no change: the projection already excludes the sender's own
cursor from `read_by_ptids` and unread counts, so self messages are never
unread and never show a peer "Read by N". Clients MUST render self-direct
without peer-presence, peer-read, block, friend-request or safety-number UI.

## 5. Client behaviour

- The contacts panel gains one fixed, always-present entry for the
  authenticated actor ("Saved Messages" / localised), rendered above the
  collapsible contact categories rather than as a category itself. It opens
  the self-direct conversation when one exists, otherwise the first open
  routes through the standard `openDirectConversation(peer=self)` path; it is
  never derived from friend requests.
- Conversation peer resolution: a DIRECT projection whose active member set
  contains only the current actor is self-direct (`selfDirect` projection
  flag). Title/avatar resolve from the authenticated profile, never from a
  `members[0]` peer heuristic; when the profile carries no displayable name,
  UI surfaces fall back to the localised "Saved Messages" label via
  `directConversationDisplayName`.
- Self-direct renders without peer-only chrome: no presence dot, no
  audio/video call actions, no peer profile fetch, no safety-number section.
  The detail panel shows a read-only self identity card (avatar, name,
  station identity), shared content, background and local settings.
- Desktop and Mobile share the Station contract. A client that does not yet
  implement the self UI keeps its create-side guard; consuming an already
  created self-direct must not crash (single-member direct renders as a
  direct whose peer is the authenticated actor). Desktop ships first; Mobile
  follow-up reuses the same contract.

## 6. Migration and compatibility

No data migration: self conversations do not exist until created. Old clients
that list conversations will receive a one-member DIRECT; the TS/Rust
projections already fall back to the sole member for naming and the message
pipeline treats own-public-event commits as it does for every Direct today.
If an old client surface proves broken, the corresponding guard hides the
row rather than corrupting state.

## 7. Testing and acceptance

- Domain: self id determinism; singleton CreateDirect happy path; invariant
  accepts 1/2, rejects 0/3; replay/idempotency; self create forces Local
  scope; deliveries equal the creator's active endpoint set.
- Crypto/outbox: zero peer session on single device produces a valid
  public-event-only command; second own device receives ciphertext via a
  pairwise self session; inbox accepts the commit and projects the message.
- Desktop: contacts shows the self row; create/open/send/reopen; attachment;
  cross-device sync via the two-client harness; no friend/block/presence UI;
  unread stays zero.
- Regression: every existing Direct acceptance gate unchanged.
