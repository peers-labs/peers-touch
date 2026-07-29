# Voice and Video Calls Architecture

> Status: Draft for review, 2026-06-22
>
> Baseline revision: 2026-06-22, re-verified against the post-merge code on
> branch `high-chat` (after merging `feat/federation-applet-runtime`).
>
> Scope: one-to-one voice and video calls in friend chat. Group calls,
> recording, screen sharing, live captions, and SFU operation are explicit
> non-goals for the first delivery.

## 1. Goal

Peers-Touch needs production-grade one-to-one voice and video calls without
inventing a custom media stack. The architecture follows the mature industry
pattern used by Matrix / Element, Signal, WhatsApp, Discord, Slack, and browser
RTC products:

- use WebRTC for the media plane;
- use Station-mediated realtime events for signaling;
- use ICE direct connectivity first and TURN relay as the standard fallback;
- keep text messages on the canonical realtime stream, never on WebRTC;
- keep Station unaware of media payloads and signaling plaintext.

This is a capability upgrade over the existing chat realtime plane, not a
parallel realtime subsystem.

## 2. Existing Baseline

This section is re-verified against the post-merge code. The repository already
contains a near-complete one-to-one call skeleton; this design hardens and
formalizes it rather than building from scratch.

### 2.1 Verified reusable assets

| Area | Existing asset | Verified state |
| --- | --- | --- |
| Realtime contract | `docs/architecture/realtime/event-stream.md` | Single SSE stream; WebRTC reserved for media only; `CallSignal signaling = 15` and `PresenceFlip presence = 14` live in the same `StreamEvent` oneof. |
| Wire model | `model/domain/realtime/event.proto` | `CallSignal` is stable: `OFFER / ANSWER / CANDIDATE / HANGUP / CALL_REQUEST / CALL_ACCEPT / CALL_REJECT / CALL_END`. The post-merge `event.proto` additions are `MomentEvent`, unrelated to calls. |
| Station ingress | `apps/station/app/subserver/events/handler.go` | `POST /realtime/signal` decodes `{recipient_actor_id, session_ulid, kind, payload_b64}`, treats payload as opaque (64 KiB cap), fans out to recipient, and echoes to sender for multi-device. No per-feature SSE endpoint. |
| Desktop media manager | `apps/desktop/src/modules/p2p/friendChatP2p.ts` | Owns `RTCPeerConnection`, sealed signaling (`signalingEnvelopeSeal/Open`), candidate buffering, `CallSnapshot` state machine (`idle/outgoing/incoming/active/ended`), `startCall/acceptCall/rejectCall/endCall/toggleMic/toggleCamera`, and `direct`/`relay` transport probing via `getStats()`. |
| Desktop surface | `apps/desktop/src/components/chat/CallSurface.tsx` | Renders ringing modal and in-call HUD, subscribes to the call snapshot; consumed by chat page / message area. |
| TURN subserver | `apps/station/frame/core/plugin/native/subserver/turn/` | Pion TURN with RFC-5766 short-term credentials (24h TTL); historical password==username bug already fixed. |
| ICE discovery | `apps/station/.../turn/ice_handler.go` | `/api/v1/turn/ice-servers` returns TURN UDP+TCP URLs from config plus ephemeral credentials. |
| Desktop ICE bridge | `apps/desktop/src-tauri/src/interface/tauri_commands/ice.rs` | Reduced to a single `ice_get_servers` command; header contract forbids restoring the deleted ICE session polling surface. |
| Presence subsystem | `apps/station/app/subserver/presence/` + `model/domain/presence/presence.proto` | New DDD subserver: 90s lease, 10s expiry sweep, `PresenceFlip` SSE fan-out; Desktop drives it via `presence_notify` + `PresenceSupervisor` + `host_events`. |
| Federation relay | `apps/station/.../subserver/relay/` | Station-to-Station tunnel; post-merge adds the single broadcast topic `fed.invalidate.v1`. Unrelated to call media/signaling. |

### 2.2 Assumptions corrected after re-verification

The earlier draft of this section carried assumptions that the post-merge code
no longer supports:

- **Signaling is not HTTP polling.** Offer/answer/candidate exchange runs through
  sealed `POST /realtime/signal` + SSE fan-out. The deleted
  `/api/v1/ice/session/*` and `/api/v1/ice/peer/*` surfaces must stay retired
  (`ice.rs` enforces this as a code-level contract).
- **Presence is not `presence_stream.rs`.** That file was removed. Peer-online
  preconditions now come from the presence subserver (lease + `PresenceFlip`),
  not from the old ICE peer registry. Call setup should gate on
  `PresenceStatus` / `PresenceFlip`, not a polling registry.
- **WebRTC DataChannel does not carry chat text.** Text is SSE-only; inbound DC
  bytes are intentionally dropped. WebRTC is media/keepalive only.
- **`desktop_capture.rs` is not media capture.** It only registers the chat
  screenshot global shortcut. Real audio/video capture is browser
  `getUserMedia`; there is no Rust-side screen-share capability.
- **`client-media-security` is not call media security.** It encrypts offline
  chat attachment blobs (AES-256-GCM), not realtime SRTP/media frames. It is
  only relevant to a future "save call snapshot as attachment" path.

### 2.3 Net delta vs the previous draft

- The biggest change is positive: the call skeleton (state machine + sealed
  signaling + ringing protocol + in-call HUD + transport probe) already exists,
  so Phase 1 is mostly hardening (TURN productionization, signal authorization,
  runtime ownership), not green-field construction.
- `eventStream.ts` as the only "signaling bridge" is an oversimplification; the
  actual media/signaling orchestration lives in `friendChatP2p.ts`. The
  signaling bridge merely decodes `StreamEvent.signaling` into typed events.
- The presence subsystem is a new, callable precondition source that the
  previous draft did not account for.

The implementation plan should refine these assets instead of replacing them.

## 3. Non-Goals

- Do not transport text messages over WebRTC DataChannel.
- Do not add a call-specific SSE endpoint, polling endpoint, or WebSocket.
- Do not let Desktop directly access a foreign Station in federated calls.
- Do not build a custom media relay protocol.
- Do not make Station decrypt SDP, ICE candidates, or media metadata.
- Do not ship group calls as mesh P2P. Group calls require a separate SFU
  architecture decision.
- Do not hardcode TURN credentials or public infrastructure secrets in Desktop.
- Do not restore the deprecated ICE session polling surface. Offer / answer /
  candidate exchange must stay on `POST /realtime/signal` plus `/events/stream`.
- Do not confuse federation relay with TURN. Federation relay moves Station
  control-plane events; TURN relays WebRTC media packets.

## 4. Domain Responsibilities

| Domain | Owner | Responsibilities | Source of truth |
| --- | --- | --- | --- |
| Media session | Desktop | `getUserMedia`, `RTCPeerConnection`, track lifecycle, mute/camera state, device selection, ICE restart, media teardown. | Local runtime state |
| Signaling routing | Station | Authenticate sender, validate routing metadata, length-check encrypted payload, fan out `CallSignal` over the actor's realtime stream. | Station realtime plane |
| Call protocol | Model | Proto-first signal kinds and optional call metadata contracts. | `model/domain/realtime/*.proto` |
| Call projection | Desktop runtime | Keep active call snapshot independent of the currently mounted chat component. | Desktop runtime/store |
| Friend session identity | Station | Friend chat session existence, participants, permissions, and actor identity. | Station chat domain |
| Federation | Station-to-Station | Forward cross-station signaling server-side; client remains home-station-only. | Federation runtime |
| UI experience | Desktop | Header entry points, ringing modal, floating call card, device controls, failure explanations. | Desktop UI |

## 5. Architecture

### 5.1 Logical Topology

```text
Desktop A web
  └─ user action / media tracks
      └─ desktop-rust gateway
          └─ Station A /realtime/signal
              └─ Station realtime EventBus
                  └─ Desktop B /events/stream
                      └─ WebRTC answer / candidates

Media plane:

Desktop A RTCPeerConnection
  ├─ direct ICE path when available
  └─ TURN relay when direct path fails
      └─ Desktop B RTCPeerConnection
```

Federated topology keeps the same client contract:

```text
Desktop A -> Home Station A -> Station-to-Station relay -> Home Station B -> Desktop B
```

Desktop never directly dials Station B.

### 5.2 Media Plane

The media plane uses browser-native WebRTC APIs:

- `navigator.mediaDevices.getUserMedia` captures microphone and camera.
- `RTCPeerConnection` negotiates audio/video tracks.
- ICE uses host / srflx / prflx candidates first.
- TURN relay is used when direct connectivity fails.
- `connectionState`, `iceConnectionState`, and `getStats()` drive user-visible
  connection quality and diagnostics.

Recommended default RTC configuration:

```ts
{
  iceServers: [
    { urls: ['stun:...'] },
    { urls: ['turn:...'], username: '<ephemeral>', credential: '<ephemeral>' },
  ],
  iceTransportPolicy: 'all',
  bundlePolicy: 'balanced',
  rtcpMuxPolicy: 'require',
}
```

The concrete ICE server list and ephemeral TURN credentials must come from
Station / desktop-rust configuration, not from hardcoded frontend constants.

### 5.3 Global Infrastructure Reuse

This feature must reuse the existing infrastructure where it is architecturally
correct, and upgrade it where product-grade calls need stronger guarantees. It
must not preserve historical designs that conflict with the current realtime
contract.

| Infrastructure | Reuse decision | Required enhancement |
| --- | --- | --- |
| `turn` subserver | Reuse as the WebRTC media fallback provider. It already uses Pion TURN and short-term credential validation. | Productionize config, secret management, public address / DNS, TLS/TCP/UDP reachability, credential TTL, JSON response generation, and observability. |
| `/api/v1/turn/ice-servers` | Reuse as the ICE discovery endpoint behind desktop-rust. | Make response fully config-driven; remove hardcoded public STUN assumptions; authenticate and authorize the caller; return typed error responses. |
| `ice_get_servers` Tauri command | Reuse as the only Desktop bridge for ICE server discovery. | Keep it narrow; do not add offer / answer / candidate exchange back into this command. |
| `POST /realtime/signal` | Reuse for encrypted call signaling. | Add friend-session authorization and callId-aware validation where Station-visible metadata is required. |
| `/events/stream` | Reuse as the only realtime egress channel. | Ensure call signals participate in the same reconnect, cursor, and multi-device semantics as chat events. |
| Federation relay | Reuse only for Station-to-Station call signaling in federated deployments. | Add dedicated forwarding semantics only if local Station-to-Station routing cannot carry the event; preserve relay read-loop non-blocking invariants. |
| Old ICE session polling | Do not reuse. | Remove or keep blocked. It leaks signaling plaintext and creates per-conversation polling pressure. |

The global architecture split is:

```text
Control plane:
  CallSignal -> Station realtime -> optional federation relay -> peer home Station

Media plane:
  WebRTC direct ICE -> TURN fallback
```

These planes may share deployment infrastructure, observability, and operational
tooling, but they must not share protocols or state ownership.

### 5.4 Signaling Plane

Signaling reuses the canonical realtime plane:

```text
POST /realtime/signal
  Authorization: Bearer <jwt>
  Content-Type: application/json

{
  "recipient_actor_id": "<peer did>",
  "session_ulid": "<friend chat session>",
  "kind": "CALL_REQUEST | CALL_ACCEPT | CALL_REJECT | CALL_END | OFFER | ANSWER | CANDIDATE | HANGUP",
  "payload_b64": "<base64 sealed payload>"
}
```

Station behavior remains intentionally small:

- authenticate the sender from JWT;
- validate `recipient_actor_id`, `session_ulid`, `kind`, and payload size;
- do not parse encrypted payload plaintext;
- publish `StreamEvent.signaling` to the recipient actor;
- echo to the sender actor for multi-device consistency.

### 5.5 Sealed Signaling Payload

The signaling payload remains opaque to Station:

```text
payload_b64 = base64(sealed_box({
  version,
  callId,
  mediaKind,
  sdp | candidate | action,
  clientTs,
  deviceId
}))
```

AAD should bind at least:

- `session_ulid`;
- signal `kind`;
- sender actor id;
- recipient actor id;
- `callId`.

Every envelope must be independently decryptable because ICE candidates may
arrive out of order.

### 5.6 Call Identity

Each call attempt needs a stable `callId`.

Required properties:

- unique per call attempt;
- generated by the initiator before `CALL_REQUEST`;
- included in every ringing, offer/answer, candidate, and hangup payload;
- used to ignore stale signals from previous attempts in the same chat session;
- echoed across sender devices so non-originating devices can show consistent
  call state.

The current proto comment already documents `callId` in the ringing payload.
If the product needs Station-visible call history later, introduce a proto-first
call record instead of overloading encrypted payloads.

## 6. Call Lifecycle

### 6.1 State Machine

```text
idle
  ├─ start audio/video
  │   -> permission_checking
  │   -> ringing_out
  │   -> connecting
  │   -> active
  │   -> reconnecting
  │   -> ended
  └─ receive CALL_REQUEST
      -> ringing_in
      ├─ reject -> ended
      └─ accept -> permission_checking -> connecting -> active

Any non-terminal state
  ├─ CALL_END / HANGUP -> ended
  ├─ permission denied -> failed
  ├─ timeout -> missed / no_answer
  └─ fatal ICE failure -> failed
```

### 6.2 Start Call

```text
User clicks audio/video
  -> Desktop validates friend chat + peer identity
  -> Desktop creates callId
  -> Desktop requests microphone/camera permission
  -> Desktop sends CALL_REQUEST
  -> UI shows outgoing ringing HUD
```

The caller should not create the final SDP offer until either:

- callee explicitly accepts; or
- product chooses an "early media" policy in a later design revision.

For first delivery, acceptance-before-offer avoids unnecessary camera/microphone
activation on declined calls.

### 6.3 Accept Call

```text
Callee accepts
  -> Desktop requests microphone/camera permission
  -> Desktop sends CALL_ACCEPT
  -> caller creates OFFER
  -> callee creates ANSWER
  -> both sides exchange CANDIDATE
  -> media becomes active
```

If permission is denied, the callee sends `CALL_REJECT` with a sealed reason
code and the caller sees a localized rejection reason.

### 6.4 End Call

Any side may end the call:

```text
User hangs up
  -> stop local tracks
  -> close peer connection
  -> send CALL_END or HANGUP
  -> clear active call snapshot
  -> optionally render a chat system card
```

The receiver treats remote end as authoritative for that `callId`, clears the
ringing / active UI, and tears down media.

### 6.5 Reconnect

On `iceConnectionState = disconnected`:

- enter `reconnecting`;
- keep UI visible;
- keep local tracks alive;
- attempt ICE restart within a bounded timeout.

On `failed`:

- try ICE restart once when TURN credentials are available;
- otherwise end with a localized network failure reason;
- record diagnostics without SDP, candidate addresses, tokens, or PII.

## 7. Desktop Runtime Integration

Desktop pages must stay pure renderers. The call feature should not rely on a
chat component mount effect to be correct.

Target ownership:

| Layer | Responsibility |
| --- | --- |
| `socialRealtime` / call runtime | Subscribe to `EVENT.REALTIME_CALL_SIGNAL`, route to call manager, own active call snapshot. |
| `friendChatP2p` or successor call manager | Own `RTCPeerConnection`, media streams, signal sealing/opening, call state machine. |
| `socialChat` store or dedicated call store | Expose current call projection to UI. |
| `CallSurface` | Render global incoming / active / ended state and dispatch user actions. |
| Chat header / message area | Trigger start-call intents only. |

Long-lived call state must survive navigation between conversations. A user can
receive a call from peer B while reading peer C's chat.

## 8. Station Integration

The first delivery should reuse the current Station realtime and TURN surfaces,
but product-grade calls need these Station-side enhancements:

| Capability | Rationale | Contract direction |
| --- | --- | --- |
| TURN credential issuance | Avoid hardcoded relay secrets and support expiry. | Upgrade the existing `turn` subserver and `/api/v1/turn/ice-servers`; do not create a parallel endpoint unless the current path is formally retired. |
| TURN deployment config | Local config currently represents development defaults, not production. | Move public address, realm, auth secret, STUN list, TTL, and transport policy into environment-backed Station config. |
| Signal authorization | Ensure sender and recipient are participants in `session_ulid`. | Station validates friend session membership before fan-out. |
| Multi-device call resolution | Accept on one device should stop ringing on sibling devices. | Sender echo and recipient fan-out are already the right transport. |
| Federated signal forward | Cross-station calls need home-station-to-home-station forwarding. | Reuse federation routing / relay control-plane infrastructure; do not let Desktop dial foreign Station. |
| Optional call history | Render "Missed call" / "Call ended 03:12" as durable chat facts. | Separate proto-first chat system message or call record. |

Station must not become a business-level media relay. The existing TURN
subserver is infrastructure for WebRTC packet relay; it should be operated and
observed as infrastructure, while the chat/call domain owns only signaling,
authorization, and optional durable call facts.

## 9. Mobile Compatibility

Mobile uses Tauri v2 Mobile + Web UI + Rust + native plugins. The protocol must
remain client-platform-neutral:

- same `CallSignal` model;
- same encrypted signaling envelope;
- same home-station realtime stream;
- platform-specific media permissions and audio route handling below the client
  capability layer.

No Desktop-only signal kind should be introduced.

## 10. UI / UX Contract

The Desktop product contract is detailed in:

- Prototype entry: [`prototype/README.md`](./prototype/README.md)
  (implemented inside `packages/prototypes/desktop/features/social-chat/src/components/ChatArea.tsx`
  and surfaced through the Desktop Shell `chat` route).

Architecture-level UX invariants:

- call entry points live in the current chat header;
- incoming calls are global and not tied to the currently selected chat;
- active calls remain visible while the user continues messaging;
- video calls show remote video plus local picture-in-picture;
- every failure state must be user-explainable and localized;
- no UI surface may expose raw SDP, ICE candidates, TURN usernames, or device ids.

## 11. Phased Delivery

### Phase 0: Design Closure

Deliverables:

- this architecture document;
- Desktop UI/UX prototype;
- explicit non-goals and acceptance criteria;
- infrastructure reuse decision for TURN, ICE discovery, realtime signaling,
  and federation relay.

Acceptance:

- reviewers agree that no new realtime channel is introduced;
- reviewers agree that WebRTC is media-only;
- reviewers agree that TURN credential handling is not hardcoded;
- reviewers agree that old ICE session polling stays retired;
- reviewers agree that federation relay and TURN have separate responsibilities.

### Phase 1: One-to-One MVP

Deliverables:

- audio/video start, accept, reject, hangup;
- productionized `/api/v1/turn/ice-servers` backed by existing TURN
  infrastructure;
- permission-aware UX;
- direct ICE + TURN fallback;
- single active call projection;
- localized failure messages.

Acceptance:

- two local Desktop profiles can complete audio and video calls;
- both direct ICE and TURN relay paths use the same `ice_get_servers` bridge;
- rejected, missed, canceled, permission-denied, and network-failed calls show
  distinct UI states;
- text messages continue to flow through SSE while a call is active.

### Phase 2: Production Hardening

Deliverables:

- ICE restart and reconnecting UI;
- device selection;
- multi-device ringing resolution;
- optional chat call cards;
- diagnostics and quality metrics.

Acceptance:

- direct vs relay transport is visible in diagnostics;
- no diagnostic log contains SDP, candidate address, tokens, or PII;
- call state recovers correctly after navigation and SSE reconnect.

### Phase 3: Federation and Future Calls

Deliverables:

- Station-to-Station signaling forward path using federation control-plane
  infrastructure where appropriate;
- mobile compatibility validation;
- separate group-call / SFU architecture proposal if group calling is prioritized.

Acceptance:

- federated clients still only connect to their home Station;
- cross-station signaling semantics match local signaling semantics.

## 12. Verification Plan

| Dimension | Verification |
| --- | --- |
| Protocol | Generated proto and signal kind maps stay in sync. |
| Desktop | `pnpm run check`, `pnpm run test`, `pnpm run build`. |
| Station | `gofmt -l .`, `go test ./...`, signal authorization tests. |
| Runtime | Call state remains correct after chat navigation and SSE reconnect. |
| Media | Direct path and TURN relay path both tested through the existing ICE discovery bridge. |
| Infrastructure | TURN config is environment-backed, credentials are ephemeral, and federation relay changes preserve read-loop non-blocking invariants. |
| Security | Logs and diagnostics inspected for SDP, ICE addresses, TURN credentials, and PII. |
| UX | Prototype states reviewed against incoming, outgoing, active, reconnecting, ended, and failed flows. |

## 13. Feasibility Review

Conclusion: this plan is feasible and should be implemented in phases. It is not
a research project and does not require a custom media stack. The main risk is
not WebRTC itself; the main risk is keeping the control plane, media plane,
runtime projection, and federation boundaries consistent while productionizing
the existing relay / TURN infrastructure.

| Dimension | Review result | Reason |
| --- | --- | --- |
| Architecture consistency | Pass | The plan keeps `desktop-web -> desktop-rust -> station`, uses the canonical realtime stream, and keeps Desktop out of foreign Station access. |
| Industry fit | Pass | WebRTC + ICE + TURN is the standard one-to-one RTC stack; the design does not invent a media protocol. |
| Existing infrastructure reuse | Pass with required hardening | Existing `turn` subserver, `/api/v1/turn/ice-servers`, `ice_get_servers`, `CallSignal`, and SSE fan-out are the right foundations. |
| Security model | Pass with required authorization work | Signaling remains sealed and Station-opaque, but Station must add friend-session authorization before fan-out. |
| Runtime model | Pass with implementation discipline | The active call projection must be runtime-owned, not page-mount-owned. |
| Federation path | Feasible, not Phase 1 critical | Local one-to-one calls can land first; cross-station calls need Station-to-Station forwarding without changing client topology. |
| TURN readiness | Needs hardening before production | Current defaults are local-dev oriented and need environment-backed secrets, public address config, TTL, and observability. |
| UX readiness | Feasible | Required states are bounded: incoming, outgoing, active, reconnecting, ended, failed, permission recovery. |

Implementation recommendation:

- Phase 1 can ship local / same-station one-to-one calls after TURN and signal
  authorization hardening.
- Phase 2 should harden reconnect, device switching, multi-device ringing, and
  diagnostics.
- Phase 3 should add federated call signaling and any future SFU design.

Go / no-go:

- Go for one-to-one Desktop voice/video if Phase 1 includes TURN production
  hardening and signal authorization.
- No-go for group calls in this plan; group calls need a separate SFU design.
- No-go for any implementation that restores ICE polling or adds a second
  realtime signaling channel.

### 13.1 Phase 1 hardening status (2026-06-23)

The four hardening gaps that gated the Phase 1 Go decision are landed on
branch `high-chat`:

| Gap | Area | Status | Where |
| --- | --- | --- | --- |
| Runtime ownership | Desktop | Done | Active calls survive friend-chat session switches; only idle connections are torn down (`closeIdleConnections`), and all are closed on page unmount (`friendChatP2p.ts`, `SocialChatPage.tsx`). |
| Signal authorization | Station | Done | `handlePostSignal` enforces fail-closed friend-relationship authorization via a registered `SignalAuthorizer`; "is friend" = DID-pair session exists (`SessionExistsForPair`) and not blocked (`IsBlockedBetween`). Missing authorizer returns 503. |
| Unanswered timeout | Desktop | Done | 45s ring timer with a `CallEndReason` state machine; terminal reasons map to localized result toasts. |
| TURN configurability | Station | Done | `/api/v1/turn/ice-servers` STUN URL list, credential TTL, and credential username are config-backed (`stun-urls` / `credential-ttl` / `credential-username`) with backward-compatible defaults. |

Remaining for full Phase 1 acceptance: end-to-end two-profile call
verification across Desktop **and** Mobile.

## 14. Open Decisions

- Should call history be durable chat content in Phase 1, or a Phase 2 system
  message?
- Should video call acceptance request camera immediately, or allow "answer with
  audio" from a video incoming call?
- Should Desktop expose audio output selection in Phase 1, or only microphone /
  camera toggles?
- Which TURN provider and credential issuance strategy should be used for local
  development, staging, and production?
- What is the exact timeout for unanswered calls: 30s, 45s, or 60s? **Decided:
  45s** (Desktop `RING_TIMEOUT_MS`), revisit per-platform if Mobile needs a
  different ring duration.
