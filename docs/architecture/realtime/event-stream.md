# Realtime Plane — Canonical Event Stream

> Status: Architectural contract, 2026-04-27
>
> Scope: All real-time communication between a Peers-Touch desktop /
> mobile client and its home Station. Covers text messaging, presence,
> typing, read receipts, future voice/video signaling, and future
> server-to-server federation. Does **not** cover the file plane (see
> `docs/architecture/oss/file-storage.md`).

This document is the long-term, non-negotiable architecture for the
realtime plane. Sections marked **Invariant** never change without a
formal architectural review; sections marked **Implementation note**
may evolve as the codebase grows.

---

## 1. Architectural commitments (Invariant)

These six commitments are the foundation. They do not change.

### 1.1 WebRTC is reserved for the media plane

WebRTC is used **only** for voice calls, video calls, and any future
real-time media stream. **Text messages never travel over WebRTC.**

Rationale: text payloads are hundreds of bytes; WebRTC's latency
advantage over a healthy SSE connection is in the tens of milliseconds
(below human perception). WebRTC's failure modes — symmetric NAT,
restrictive corporate firewalls, container networks, IPv6 half-failures,
double-NAT consumer routers — are real, common, and silent. Binding
text reachability to an unstable channel is reverse engineering against
ourselves.

This is the same call WhatsApp, Signal, iMessage, Matrix, Discord, and
Telegram have all made. There are no production-grade exceptions.

The privacy concerns that originally motivated "WebRTC for text" are
addressed instead by E2EE + sealed-sender on the Station-mediated path
— Station sees ciphertext plus routing metadata, not message content.

### 1.2 One canonical event stream per device-window

Each authenticated device-window holds **exactly one** SSE connection
to its home Station. That stream multiplexes every kind of real-time
event: messages, receipts, typing, presence, signaling, system. There
are no per-feature SSE endpoints.

Rationale: multiple endpoints are an anti-pattern — connection budget
explosion, divergent reconnect logic, ordering ambiguity between
streams, harder to reason about backpressure. One stream, one cursor,
one reconnect path.

### 1.3 E2EE ciphertext rides through Station

Message bodies are encrypted end-to-end before they leave the sender's
device. Station relays ciphertext plus routing headers
(`sender_actor_id`, `recipient_actor_id`, `session_ulid`, `ts`,
`event_id`). Station cannot decrypt content; it can observe metadata.

Crucially, the ciphertext travels **inside** the SSE event itself —
not as a "you have new mail, GET it now" two-step. Single round-trip
delivery is required for "feels-instant" UX without engineering heroics.

### 1.4 Pending queue is per-actor; read cursor is per-device

An actor's pending queue is shared across all of that actor's devices.
Each individual device tracks its own `Last-Event-ID` cursor and
catches up independently. This makes multi-device, partial-online,
device-loss, and re-pair scenarios well-defined without ad-hoc rules.

### 1.5 Future voice/video signaling reuses this stream

When voice and video land, their offer / answer / ICE candidate
exchange travels as `CallSignal` events on the same SSE stream. We do
not add a third signaling channel. Matrix / Element have validated this
pattern at scale.

### 1.6 Federation is server-to-server, client-unaware

When user A on station S1 messages user B on station S2, S1 forwards
the event to S2 over a server-to-server channel; S2 emits a
`StreamEvent` on B's SSE stream. From the client's perspective, every
event arrives from its home station regardless of where it originated.
The client never speaks directly to a foreign station.

This makes the SSE hub the **single fan-out point** for all real-time
events in a Peers-Touch deployment, federated or not.

---

## 2. Wire protocol

### 2.1 Endpoint

```
GET /events/stream
  Accept:          text/event-stream
  Authorization:   Bearer <jwt>
  Last-Event-ID:   <opaque cursor, optional>     # set on reconnect
  X-Device-ID:     <device_id>                   # device-scoped resume
```

The JWT carries `actor_id`. Combined with `X-Device-ID` this uniquely
identifies the subscriber. `Last-Event-ID` follows the SSE RFC: server
attempts to replay events starting after that cursor; if the cursor
falls outside the in-memory ring buffer, server emits a `Resync` event
and the client must perform a cold catch-up.

### 2.2 Event envelope

All events share a single schema, versioned by the addition of new
`oneof` arms only — never by mutation of existing arms.

```protobuf
// v1 — apps/proto/peers/realtime/v1/event.proto
syntax = "proto3";
package peers.realtime.v1;

message StreamEvent {
  // Server-assigned, monotonic per actor.  Opaque to clients.
  string event_id = 1;

  // Server's wall clock at emit time. Clients SHOULD NOT use this for
  // ordering; trust event_id.
  int64 ts_unix_ms = 2;

  oneof kind {
    Heartbeat       hb        = 10;
    MessageEnvelope message   = 11;
    MessageReceipt  receipt   = 12;
    TypingState     typing    = 13;
    PresenceFlip    presence  = 14;
    CallSignal      signaling = 15;
    Resync          resync    = 16;
  }
}

message Heartbeat {
  // The server's current floor event_id. Clients use this to detect
  // missed events even when no business event has occurred recently.
  string floor_event_id = 1;
}

message MessageEnvelope {
  string sender_actor_id    = 1;
  string recipient_actor_id = 2;   // self for fan-out clarity
  string session_ulid       = 3;
  string ulid               = 4;   // message ulid
  bytes  ciphertext         = 5;   // E2EE payload
  int64  sent_ts_unix_ms    = 6;   // sender's clock, untrusted
  // attachments live as oss:// references inside the ciphertext, not
  // in the envelope. Station never sees attachment metadata.
}

message MessageReceipt {
  string session_ulid = 1;
  string ulid         = 2;
  enum Kind { DELIVERED = 0; READ = 1; }
  Kind   kind         = 3;
  string from_actor_id = 4;
}

message TypingState {
  string session_ulid = 1;
  string from_actor_id = 2;
  bool   typing       = 3;
}

message PresenceFlip {
  string actor_id = 1;
  bool   online   = 2;
}

message CallSignal {
  string session_ulid = 1;
  string from_actor_id = 2;
  enum Kind {
    OFFER     = 0;
    ANSWER    = 1;
    CANDIDATE = 2;
    HANGUP    = 3;
  }
  Kind   kind = 3;
  bytes  payload = 4;   // SDP / candidate JSON, opaque to Station
}

message Resync {
  // Server tells the client "your cursor is too old; ring buffer
  // wrapped around. Restart from a cold sync, then reconnect with the
  // newest event_id you've now learnt about."
  string newest_event_id = 1;
  string reason          = 2;   // human-readable, for logs
}
```

### 2.3 Wire format

Each event is encoded as protobuf binary, then base64-encoded into the
SSE `data:` field. The SSE `id:` field is set to `event_id`.

```
event: stream
id: 01HKE9X8...
data: CgsIARIHaGVsbG8u...

```

Protobuf gives us forward and backward compatibility for free; clients
that don't recognize a new `oneof` arm safely skip the event.

### 2.4 Heartbeat

Server emits `Heartbeat` every 15 seconds. The client's reconnect
deadline is 30 seconds without any frame (heartbeat or business event)
— after that the client tears down the TCP connection and reconnects
with the last seen `event_id`. This is more reliable than depending on
TCP keepalive, which NAT devices silently drop on long-lived
connections.

### 2.5 Resumability and the Resync escape hatch

Server maintains a per-actor in-memory ring buffer of recent events
(default 1024 entries; operator-configurable). On reconnect with
`Last-Event-ID`:

1. **Cursor inside buffer** → replay events `(cursor, newest]` then
   continue live. Normal hot path.
2. **Cursor outside buffer** (client was disconnected for too long)
   → emit a single `Resync` event carrying `newest_event_id`, then
   continue live from `newest_event_id`. The client is responsible
   for performing a cold catch-up
   (`/friend-chat/pending`-equivalent; bulk message sync) before
   trusting any event delivered after `Resync`.
3. **No cursor (first connect)** → emit live events only. Client
   should run its normal cold-load on first launch independent of the
   stream.

### 2.6 Backpressure

Each subscriber has a bounded write buffer (default 1 MiB). If a write
to the client TCP socket blocks for more than 5 seconds, the server
considers the client wedged, closes the connection, and discards the
subscriber's ring buffer position. The client will reconnect and, if
its cursor has been overwritten in the meantime, receive a `Resync`.

This prevents one slow client from starving the SSE goroutine pool or
exhausting station memory.

### 2.7 Client → Server ingress endpoints

The SSE stream is egress-only. Whenever a client needs to *originate*
a real-time event (sending a chat message, posting a typing
indicator, transmitting a WebRTC signal) it does so via a regular
HTTP POST on a dedicated ingress endpoint. The endpoint persists or
routes the payload as appropriate, then publishes an `EventBus.Publish`
to fan it out over SSE to every involved actor's subscribers.

This split is intentional: SSE is a one-way protocol and we don't
want to graft a writer plane onto it (no SSE-over-fetch, no JSON-RPC
over SSE, no WebSocket back-channel). HTTP POST is enough; reuse
keeps the surface small.

#### 2.7.1 Signaling ingress (Invariant)

```
POST /realtime/signal
  Authorization: Bearer <jwt>
  Content-Type:  application/json
  Body:
    {
      "recipient_actor_id": "did:peers:...",      // who should receive the signal
      "session_ulid":       "01HX...",            // chat session that owns the call
      "kind":               "OFFER" | "ANSWER" | "CANDIDATE" | "HANGUP",
      "payload_b64":        "<base64(opaque ciphertext)>"
    }
  → 204 No Content on success
  → 400 if any required field is missing or `kind` is unknown
  → 413 if payload_b64 decodes to more than 64 KiB (SDP ≤ ~5 KB,
        candidates ≤ ~300 B in practice; cap is generous)
```

Station behaviour: validates fields, decodes `payload_b64` only to
length-check it, then publishes a `StreamEvent.signaling = CallSignal{
session_ulid, from_actor_id = <jwt subject>, kind, payload}` via
`EventBus.Publish(recipient_actor_id, ...)`. If the sender is not the
recipient (the normal case), Station also publishes a copy to
`EventBus.Publish(sender_actor_id, ...)` for multi-device fan-out
(other devices of the caller need to know the call was initiated).

Station never inspects, decrypts, parses, or stores `payload`. It is
opaque ciphertext.

#### 2.7.2 Signaling payload encryption (Invariant)

`payload` MUST be the per-friend-chat-session ratcheted ciphertext of
the canonical signaling JSON below. It MUST NOT be cleartext SDP /
candidate. The same X3DH-derived key + ChaCha20-Poly1305 ratchet that
text messages use also wraps signaling — there is no separate key
schedule.

Canonical plaintext shape (UTF-8 JSON, before encryption):

```json
// kind=OFFER or kind=ANSWER
{ "sdp": "v=0\r\no=- ..." }

// kind=CANDIDATE
{ "candidate": "candidate:...", "mid": "0", "mline": 0 }

// kind=HANGUP
{ "reason": "user_ended" | "timeout" | "error" }
```

Rationale: signaling reveals network topology (host/srflx/relay
candidate addresses), media format negotiation, and call timing — all
of which are sensitive metadata. Reusing the chat session ratchet
gives forward secrecy and per-message keys for free. A dedicated
signaling-only envelope was rejected because it would have required
a parallel key schedule with no security benefit and twice the
maintenance.

The trade-off: a call cannot be initiated until the chat session is
E2EE-established (X3DH bundle exchange completed for both peers).
This is acceptable because the UI flow always initiates a call from
an existing chat conversation — there is no "blind dial" path.

---

## 3. Server architecture

### 3.1 The `events` subserver

A new Station subserver at `apps/station/app/subserver/events/`. Its
public surface is exactly the `GET /events/stream` endpoint.

### 3.2 The `EventBus`

```go
type EventBus interface {
    // Publish fan-outs the event to all live subscribers for actor_id.
    // Returns immediately; non-blocking. Blocked subscribers are dropped
    // per §2.6.
    Publish(actorID string, event *realtimev1.StreamEvent) error

    // Subscribe registers a new SSE subscriber. Returns a channel of
    // events plus a cancellation function. Replays from cursor when
    // cursor is non-empty.
    Subscribe(ctx context.Context, actorID, deviceID, cursor string) (<-chan *realtimev1.StreamEvent, func(), error)
}
```

Concrete implementation owns:

- A `sync.Map` keyed by `actor_id` → per-actor state.
- Per-actor state: ring buffer (slice of events with mutex), set of
  live subscribers (each with its own bounded channel and cursor).
- A monotonic `event_id` generator backed by a single SQLite row
  (`realtime_event_cursor` table) loaded at boot, incremented in-memory
  with periodic checkpoint to disk.

### 3.3 The single fan-out point invariant

Every business subsystem that wants to emit a real-time event calls
`EventBus.Publish(actorID, event)`. There are no other paths. In
particular:

- `friend_chat.handleSendMessage` calls
  `EventBus.Publish(receiverID, MessageEnvelope{...})` after persisting.
- `friend_chat.handleOnline` / `handleOffline` call
  `EventBus.Publish(friendsOf(actor), PresenceFlip{...})`.
- Future federation gateway: when an inbound federated event arrives,
  it calls `EventBus.Publish(localActor, ...)` exactly as if a local
  subsystem had emitted it.
- Future voice/video subsystem: emits `CallSignal` events the same way.

### 3.4 What goes away on Station

- `apps/station/app/subserver/friend_chat/handler.go::handlePresenceStream`
  and the per-feature presence SSE — replaced by `events` subserver.
- The `s.online` map's role as a "should I queue this in pending" flag
  is replaced by "does this actor have any live SSE subscriber". The
  pending queue itself remains as the cold-recovery path (§2.5 case 2)
  but stops being the everyday delivery mechanism.
- The legacy `signaling` subserver
  (`apps/station/frame/core/plugin/native/subserver/signaling/`) and
  its 14 endpoints (`/api/v1/ice/session/{new,offer,answer,candidate,...}`,
  `/api/v1/ice/peer/{register,unregister,get,...}`) are deleted in
  full. Their replacement is the single
  `POST /realtime/signal` ingress (§2.7.1) plus the `CallSignal`
  oneof arm on the egress SSE stream.

  Note: the `turn` subserver
  (`apps/station/frame/core/plugin/native/subserver/turn/`) — which
  hosts the actual UDP TURN relay plus
  `GET /api/v1/turn/ice-servers` for credential discovery — stays.
  That subserver is the media plane, not the signaling plane.

---

## 4. Client architecture

### 4.1 Single connection manager (Rust)

`apps/desktop/src-tauri/src/infrastructure/event_stream/`:

- Owns the one and only SSE connection per process.
- Tracks `Last-Event-ID` per (actor_id, device_id) tuple, persists to
  `auth/sessions/{actor_id}/event_cursor.json`.
- Reconnect with exponential backoff (1s → 30s cap), full jitter.
- Heartbeat watchdog at 30s.
- On `Resync`, calls into a registered "cold catch-up" function (which
  the chat layer provides) before resuming live event dispatch.
- Decodes each event, emits via Tauri custom event
  `realtime.event` carrying the protobuf-encoded payload as bytes.

### 4.2 Frontend dispatch (TypeScript)

`apps/desktop/src/services/eventStream.ts`:

- Single Tauri listener for `realtime.event`.
- Decodes protobuf with the generated Schema.
- Dispatches into `eventBus` (existing) under typed event names:
  `realtime.message`, `realtime.receipt`, `realtime.typing`,
  `realtime.presence`, `realtime.signaling`, `realtime.resync`.

### 4.3 Business module bindings

- `socialChat.ts`: subscribes to `realtime.message` → triggers
  `friendChatSync(session_ulid) + loadMessages` (or, when ciphertext is
  inlined, decrypts and inserts directly).
- `peerPresence.ts`: subscribes to `realtime.presence` → updates
  per-friend online state.
- (Future) `calls.ts`: subscribes to `realtime.signaling` → drives
  `RTCPeerConnection`.

### 4.4 What goes away on the client

- `apps/desktop/src/modules/p2p/friendChatP2p.ts::sendMessageHint` —
  removed entirely. Text never enters the WebRTC code path.
- `apps/desktop/src/modules/p2p/friendChatP2p.ts::setOnEnvelope` — text
  branch removed; the file remains as scaffolding for future
  voice/video and may be renamed to clarify scope.
- `apps/desktop/src/pages/SocialChatPage.tsx`'s 60-second polling
  `setInterval` — removed.
- `apps/desktop/src/services/peerPresence.ts`'s standalone SSE
  connection to `/friend-chat/presence/stream` — replaced by
  subscription to `realtime.presence` on the unified bus.
- `friendChatP2p.ts`'s HTTP-polling signaling
  (`pollCandidates`, `iceSessionAnswerGet` retry loops) — replaced by
  `CallSignal` events.

---

## 5. End-to-end timing — text message

```
Sender (A on station S1)                 Receiver (B on station S2)
────────────────────────                 ──────────────────────────

client                                   client
  │                                        ▲ SSE event {
  │  POST /friend-chat/message/send        │   id: e_42,
  │     { ciphertext, recipient: B, ... }  │   message: MessageEnvelope{
  │                                        │     sender_actor_id: A,
  ▼                                        │     session_ulid,
S1                                         │     ulid,
  │  persist → ok                          │     ciphertext, ...
  │  resolve B's home station = S2         │   }
  │                                        │ }
  │  if S1 == S2:                          │
  │     EventBus.Publish(B, env)           │
  │                                        │
  │  else (federation):                    │
  │     POST S2/federation/event { env }   │
  │     S2 EventBus.Publish(B, env)        │
  ▼                                        │
  HTTP 200 { ulid, server_ts }             │
                                           │
                                  SSE long connection (held open)
```

A single network round-trip from send to display. Station sees
ciphertext plus routing metadata, never plaintext.

---

## 6. Federation outline

This document does not implement federation; it commits to the shape
that future federation must take.

```
S1                                      S2
──                                      ──
EventBus.Publish(remote, ...)           POST /federation/event
  │                                     ──────────────────────────
  ├─ subscriber on S1?  →  fan-out      │  inbound: StreamEvent
  └─ remote actor       →  POST S2 ────▶│
                                        │  EventBus.Publish(localActor, ...)
                                        │   (same call site, same buffer,
                                        │    same fan-out, same resume)
```

The federation gateway is "just another publisher". From `EventBus`'s
perspective it doesn't matter whether an event came from an HTTP send,
an internal subsystem, or an inbound federated POST.

Authentication, replay protection, and cross-station event_id
namespacing for the federation channel are out of scope for this doc
and will be specified in `docs/architecture/federation/...` when we
build it.

---

## 7. Invariants (enforced by code review and lint where possible)

1. A `(actor_id, device_id)` pair has at most one live SSE connection
   at a time. Server closes the older connection on collision.
2. `StreamEvent.event_id` is strictly monotonic per `actor_id` and
   opaque (clients never parse it).
3. Clients trust `event_id` for ordering. Clients **never** order by
   `ts_unix_ms` or by local arrival time.
4. Every real-time event in Station goes through
   `EventBus.Publish(...)`. There are no other paths to a connected
   client.
5. A reconnect without `Last-Event-ID` is treated as first-connect.
   Server will not silently replay; the client must trigger its own
   cold-load.
6. Ring buffer overflow is **never silent**; it always produces a
   `Resync` event.
7. WebRTC code paths must not appear in any text-message code path.
   Enforced today by code review; a CI grep rule
   (`! grep -r friendChatP2p apps/desktop/src/store/socialChat.ts`)
   should be added once the deletion lands.
8. Polling timers in chat-related code paths are forbidden. The
   `setInterval` in `SocialChatPage.tsx` is the last one to delete; no
   new ones may be introduced.

---

## 8. Explicitly rejected designs

For future readers tempted to revisit: each of these was considered
and rejected with reason.

| Design | Why rejected |
| --- | --- |
| WebSocket instead of SSE | We do not need bidirectional. Client→server is well served by HTTP POST. WebSocket adds Upgrade negotiation, more reverse-proxy friction, no real benefit. |
| Multiple SSE endpoints (presence-stream, message-stream, signaling-stream) | Connection budget explosion; divergent reconnect; cross-stream ordering ambiguity. |
| WebRTC for text data plane | §1.1. Reliability cost > privacy benefit. Privacy is solved by E2EE + sealed-sender. |
| "Notify-then-pull" (event says 'pull now', client GETs body) | Two RTTs per message. SSE can carry kilobytes per event; carrying ciphertext inline is free latency. |
| Long-poll instead of SSE | Functionally identical (Matrix's `/sync` is essentially this), but SSE is cheaper protocol-wise (one connection held open vs. repeated request/response cycles) and we already use SSE elsewhere. |
| Drop pending queue once SSE lands | Pending queue is the §2.5 case-2 cold recovery. Cannot be deleted; just demoted from everyday path to escape hatch. |
| Per-message HTTP push from server back to client | Connection-per-message; doesn't survive NAT; not a real option. |

---

## 9. Implementation note — phased delivery

The architecture is fixed; the rollout is phased so each step is a
small, reviewable PR. Phases are listed as **implementation note**
because future engineers may reorder or compress as long as the
endpoints remain the same.

1. Realtime proto schema + generated code (Go + Rust + TS).
2. Station `events` subserver + `EventBus` + ring buffer + Resume.
3. Desktop `event_stream` infra (Rust) + `eventStream.ts` dispatch.
4. Wire `friend_chat.handleSendMessage` to publish `MessageEnvelope`;
   client subscribes; delete the 60s `setInterval`.
5. Migrate presence: `events` subserver publishes `PresenceFlip`,
   delete the dedicated presence SSE endpoint and standalone client
   listener.
6. Delete WebRTC text data plane code; rename `friendChatP2p.ts` to
   reflect its future media-only scope (or leave the file empty until
   voice/video lands).
7. Migrate WebRTC signaling onto `CallSignal` events; delete HTTP
   polling signaling.
8. Independent: chat first-click cold-load fixes (DB connection
   pool, cold-load slicing). Not architectural; tracked separately.

Each phase ships as a conventional commit on the `peers-chat`
branch. Verification at every phase: `go build/test`, `cargo
check/test`, `pnpm tsc`, `ReadLints`.

---

## 10. Open work explicitly out of this doc's scope

These exist; they are tracked elsewhere and reference back to this
document for the realtime contract:

- Federation server-to-server protocol details
  (`docs/architecture/federation/...`, future).
- Voice/video protocol on top of `CallSignal`
  (`docs/architecture/calls/...`, future).
- Sealed-sender encryption design and key management
  (`docs/architecture/encryption/...`, partial).
- Read-receipt UX semantics across multi-device
  (`docs/architecture/identity/...`, partial — references this doc's
  per-device cursor model).
