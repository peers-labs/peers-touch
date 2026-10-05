# Group Call Architecture

> Status: Draft for review, 2026-09-21
>
> Scope: multi-participant voice and video calls in Group conversations.
> Depends on: `voice-video-calls.md` (1v1 baseline), `event-stream.md`,
> Group membership domain.

## 1. Goal

Enable three or more authorized Group members to join an ephemeral voice or
video call with production-grade media quality, using mature open-source
infrastructure rather than self-built SFU code.

## 2. Topology Boundary with 1v1 Calls

1v1 calls remain on the existing P2P WebRTC path (`callP2p.ts` + Station
`/realtime/signal`). That path is proven, lower latency for two participants,
and does not require a running SFU process.

Group calls (3+ participants) use LiveKit SFU. This is not a chimney — it is
two topologies for two fundamentally different participant counts. The Desktop
call manager selects the path based on conversation type (friend session →
P2P, group → LiveKit).

## 3. SFU Selection Analysis

### 3.1 Candidates

The open-source WebRTC SFU landscape has four production-proven options:

| Server | Language | Form | License | Signaling | Room mgmt |
|---|---|---|---|---|---|
| **LiveKit** | Go (Pion) | Standalone server | Apache-2.0 | Built-in (Protobuf/WS) | Built-in |
| **mediasoup** | C++ worker + Node.js/Rust | Embeddable library | ISC | Self-build | Self-build |
| **Janus** | C | Standalone + plugins | GPLv3 | Self-build (JSON) | Plugin (VideoRoom) |
| **Jitsi** | Java | Standalone (multi-component) | Apache-2.0 | Built-in (XMPP) | Built-in |

### 3.2 Performance Benchmark

Source: [tumarm.com — LiveKit vs Janus vs Mediasoup](https://www.tumarm.com/blog/webrtc-media-server-comparison/).
Environment: 4-core / 16 GB VM, VP8 1 Mbps 720p 30fps, all participants sending.

| Metric | LiveKit | mediasoup | Janus |
|---|---|---|---|
| Max participants (4 cores) | ~300 | ~400 | ~150 |
| CPU per 10 participants | 8% | 6% | 15% |
| Latency p50 (same DC) | 45ms | 40ms | 65ms |
| Latency p99 (same DC) | 110ms | 95ms | 180ms |
| Memory per participant | 8 MB | 6 MB | 12 MB |
| Time to first frame | 380ms | 310ms | 520ms |

Jitsi not included — no same-condition benchmark data available.

### 3.3 Evaluation

**Janus — eliminated.** GPLv3 license is incompatible with this project.
C language is a maintenance mismatch with the Go/TS/Rust stack. Weakest
performance in benchmarks.

**Jitsi — eliminated.** Java stack is heterogeneous. Deployment requires
multiple coordinated components (JVB + Jicofo + Prosody + Jibri). Designed
as a full conferencing product, not an embeddable call capability. Over-
engineered for our use case.

**mediasoup — considered but not selected.** Best raw performance (lowest
latency, highest density). However: Node.js/C++ stack is heterogeneous with
Station (Go). Provides zero built-in signaling, room management, or client
SDK — all must be self-built. High engineering cost for a solved problem.

**LiveKit — selected.** Reasons:

1. **Go stack** — same language as Station, natural SDK integration.
2. **All-in-one** — signaling, rooms, participant management, simulcast,
   active speaker, reconnection, E2EE, TURN, recording are all built-in.
3. **Apache-2.0** — license compatible.
4. **Self-host friendly** — single binary, single-node needs no Redis.
5. **20.7k GitHub stars**, actively maintained (v1.13.7, Sep 2026).
6. **Production users** — OpenAI ChatGPT Voice, Skydio, La Suite Meet.
7. **Client SDKs** — JS/TS, Swift, Kotlin, Rust, Flutter, React.

### 3.4 References

- [Open Source WebRTC Media Servers (webrtc.ventures, 2026-06)](https://webrtc.ventures/2026/06/open-source-webrtc-media-servers/)
- [LiveKit vs Janus vs Mediasoup benchmark (tumarm.com, 2026-01)](https://www.tumarm.com/blog/webrtc-media-server-comparison/)
- [Janus vs Mediasoup vs LiveKit for scalable apps (enfintechnologies.com, 2026-06)](https://www.enfintechnologies.com/janus-vs-mediasoup-vs-livekit-webrtc-media-server/)
- [LiveKit GitHub (20.7k stars)](https://github.com/livekit/livekit)
- [LiveKit self-hosting docs](https://docs.livekit.io/transport/self-hosting/)

## 4. Core Decision: LiveKit as Media Infrastructure

Group video calling is a solved problem. LiveKit Server (Apache-2.0, Go,
Pion-based) is the best-fit open-source SFU per the analysis above. Station
integrates with it as infrastructure — not embedded, not reimplemented.

**Station does NOT handle media.** Station handles authorization and
membership enforcement. LiveKit handles everything else: WebRTC negotiation,
SFU forwarding, simulcast, active speaker detection, reconnection, bandwidth
estimation.

## 5. Non-Goals

- Self-built SFU or media forwarding code.
- Embedding LiveKit as a Go library (it is a standalone server).
- Replacing LiveKit's signaling (WebSocket) with our SSE stream.
- P2P mesh for group calls (forbidden by product definition).
- Migrating 1v1 calls to LiveKit (no benefit, adds SFU dependency).
- Recording, screen sharing, live captions in this delivery.

## 6. Deployment

LiveKit Server runs as an independent process alongside Station:

```
apps/
  station/          # existing Go server
  livekit/          # LiveKit Server config and compose service
```

In the Station compose profile, LiveKit is one more container. Single-node
self-hosted deployment: Station + LiveKit + PostgreSQL. No Redis needed for
single-node LiveKit.

Operator config in Station profile:

```yaml
livekit:
  api_url: "http://livekit.internal:7880"
  public_url: "wss://livekit.example.com"
  api_key: "<from-env>"
  api_secret: "<from-env>"
  webhook_url: "http://station:18132/hooks/livekit"
```

**Secrets**: `api_key` and `api_secret` MUST come from environment variables
or the operator's secret store. Never committed to code or config files.

`api_url` and `public_url` are intentionally separate. Station uses the
HTTP(S) API endpoint for room administration; Desktop receives the WS(S)
public endpoint in the join response. Every Station in a Federation points to
the same LiveKit deployment and key pair.

**TURN reuse**: LiveKit's built-in TURN MUST be disabled (`turn.enabled: false`).
Station already runs a Pion TURN subserver on port 3478 with RFC-5766
credentials. Group call participants obtain ICE servers from the same
`/api/v1/turn/ice-servers` endpoint as 1v1 calls — passed to LiveKit SDK
via `RoomConnectOptions.rtcConfig`. This avoids port conflicts and keeps
one TURN infrastructure for all call types.

## 7. Architecture

### 7.1 Adapter Pattern

All call logic depends on provider interfaces, not on LiveKit directly.
Switching to mediasoup, a self-built Pion SFU, or any other backend only
requires a new adapter — handler, UI, proto, and config stay unchanged.

```
Station                                Desktop
┌──────────────┐                       ┌──────────────────┐
│ handler.go   │                       │ CallManager      │
│ (routing +   │                       │ CallSurface      │
│  auth only)  │                       │ (UI only)        │
└──────┬───────┘                       └────────┬─────────┘
       │ interface                              │ interface
       ▼                                        ▼
┌──────────────────┐                   ┌──────────────────────┐
│ RoomProvider     │                   │ GroupCallProvider     │
│  CreateRoom()    │                   │  connect()           │
│  GenerateToken() │                   │  disconnect()        │
│  RemoveParticip…│                   │  onParticipantChanged│
│  CloseRoom()     │                   │  setMicEnabled()     │
│  HandleWebhook() │                   │  setCameraEnabled()  │
└──────┬───────────┘                   └────────┬─────────────┘
       │ adapter                                │ adapter
       ▼                                        ▼
┌──────────────────┐                   ┌──────────────────────┐
│ LiveKitAdapter   │                   │ LiveKitAdapter       │
│ (server-sdk-go)  │                   │ (@livekit/client)    │
└──────────────────┘                   └──────────────────────┘
```

**Station `RoomProvider` interface (Go):**

```go
type RoomProvider interface {
    CreateRoom(ctx context.Context, groupULID string) (roomName string, err error)
    GenerateToken(ctx context.Context, roomName, actorPTID string) (url, token string, err error)
    RemoveParticipant(ctx context.Context, roomName, actorPTID string) error
    CloseRoom(ctx context.Context, roomName string) error
    HandleWebhook(ctx context.Context, body []byte, authHeader string) error
}
```

**Desktop `GroupCallProvider` interface (TS):**

```ts
interface GroupCallProvider {
  connect(url: string, token: string): Promise<void>;
  disconnect(): void;
  onParticipantChanged(cb: (participants: Participant[]) => void): Unsubscribe;
  onActiveSpeaker(cb: (actorPtid: string) => void): Unsubscribe;
  setMicEnabled(enabled: boolean): Promise<void>;
  setCameraEnabled(enabled: boolean): Promise<void>;
}
```

Current delivery implements `LiveKitAdapter` for both interfaces. Future
alternatives (mediasoup adapter, self-built Pion SFU adapter) implement the
same interfaces with zero changes to handler, UI, or proto.

### 7.2 Data Flow

```
Desktop                     Station                    LiveKit Server
  │                            │                            │
  │ 1. start/join group call   │                            │
  ├──POST /group-call/join───→ │                            │
  │                            │ 2. validate group member   │
  │                            │ 3. RoomProvider.CreateRoom  │
  │                            ├──adapter──────────────────→│
  │                            │ 4. RoomProvider.GenerateToken
  │  ←── {url, token} ────────┤                            │
  │                            │                            │
  │ 5. GroupCallProvider.connect                             │
  ├──────adapter (WebSocket + WebRTC)────────────────────→ │
  │                            │                            │
  │                            │ 6. RoomProvider.HandleWebhook
  │                            │ ←─ room_started            │
  │                            │ ←─ room_finished           │
  │                            │                            │
  │ 7. SSE: call notifications │                            │
  │  ←── CallSignal(ROOM_ACTIVE)                            │
  │  ←── CallSignal(ROOM_ENDED)                             │
  │                            │                            │
  │                            │ 8. group membership change │
  │                            │ RoomProvider.RemoveParticipant
  │                            ├──adapter──────────────────→│
```

### 7.3 Station Responsibilities

**Join endpoint**: `POST /group-call/join`

1. Validate caller is current group member.
2. Check if group already has an active LiveKit room (keyed by `group_ulid`).
   If not, create one via LiveKit `CreateRoom` API.
3. Generate a participant JWT with:
   - Identity: `actor_ptid`
   - Room: `group-{group_ulid}`
   - Permissions: publish audio/video, subscribe
4. Return `{livekit_url, token, room_name}` to Desktop.

**Webhook receiver**: `POST /hooks/livekit`

Register with LiveKit to receive room lifecycle events. This is how Station
knows when rooms start and end — no polling, no self-maintained state.

- `room_started` → broadcast `CallSignal(ROOM_ACTIVE)` on SSE to group members.
- `room_finished` → broadcast `CallSignal(ROOM_ENDED)` on SSE.
- `participant_joined` / `participant_left` → optional SSE updates for UI.

**Membership enforcement**: Subscribe to `GroupMembershipChange` events.
On `REMOVED/LEFT/DISSOLVED`, call LiveKit `RemoveParticipant` API to eject.

**No other call logic in Station.** No SDP handling, no ICE relay, no media
forwarding.

### 7.4 Desktop Responsibilities

1. See `ROOM_ACTIVE` on SSE → show "group call in progress" indicator.
2. User clicks join → `POST /group-call/join` → get `{url, token}`.
3. Connect using `@livekit/livekit-client` JS SDK.
4. SDK handles all WebRTC complexity: track publishing, subscribing,
   simulcast, reconnection, active speaker events.
5. UI subscribes to SDK room events for participant roster, media state,
   active speaker, connection quality.
6. On leave: `room.disconnect()`. SDK cleans up all media resources.

**Call projection**: One long-lived call state in Desktop runtime (same
pattern as 1v1). Stores `{roomName, groupUlid, connected, participants[]}`.
Survives page navigation.

**UI surface**: Reuse existing `CallSurface.tsx` pattern. Add grid layout
for multi-participant tiles. Active speaker highlight. Controls: mute,
camera, leave.

### 7.5 Cross-Station Federation

For groups spanning multiple Stations, the authority Station (group owner)
manages the LiveKit room. Remote participants:

1. Request token from their home Station.
2. Home Station forwards the request to authority Station via federation relay.
3. Authority Station validates membership and returns LiveKit token + URL.
4. Remote participant connects to authority Station's LiveKit instance directly
   (media plane — same principle as TURN in 1v1 architecture).

Desktop never makes HTTP/SSE API calls to foreign Station. Only the
LiveKit media connection crosses Station boundaries.

## 8. Proto Extension

Minimal addition to existing `CallSignal`:

```protobuf
message CallSignal {
  // ... existing fields 1-4 ...

  // Group call fields — empty for 1v1
  string group_ulid = 5;
  string room_name  = 6;
}
```

Two new `Kind` values:
- `ROOM_ACTIVE = 9` — Station → group: call in progress, join available
- `ROOM_ENDED = 10` — Station → group: call ended

SSE notifications carry `group_ulid` and `room_name` only. No tokens in
broadcast — participants get tokens individually via the join endpoint.

All media signaling (SDP, ICE, participant events) happens inside LiveKit's
WebSocket — not on our SSE stream.

## 9. Dependencies

| Component | Package | License |
|---|---|---|
| LiveKit Server | `github.com/livekit/livekit-server` v1.13+ | Apache-2.0 |
| Station Go SDK | `github.com/livekit/server-sdk-go/v2` | Apache-2.0 |
| Desktop JS SDK | `@livekit/livekit-client` | Apache-2.0 |

## 10. Capacity

| Parameter | Default | Source |
|---|---|---|
| Max participants per room | 16 | Station config (enforced at token generation) |
| Max rooms per Station | Unlimited | LiveKit handles scaling |
| Reconnect | Automatic | LiveKit SDK built-in |
| Room timeout (empty) | 30s | LiveKit `EmptyTimeout` config |

## 11. Decisions

### GC-D01: LiveKit Server as External Infrastructure

Use the mature, production-proven LiveKit SFU instead of self-building.
Station only handles auth and membership. Zero self-written media code.

### GC-D02: Independent Process, Not Embedded

LiveKit runs as a standalone process/container in the Station compose
profile. Simple deployment, independent upgrades, clear boundary.

### GC-D03: 1v1 Stays P2P, Group Uses LiveKit

Two topologies for two use cases. Not a chimney — P2P is better for two
participants (lower latency, no SFU dependency). LiveKit is better for
3+ participants (scalable forwarding). Desktop selects based on
conversation type.

### GC-D04: Extend CallSignal for Notifications Only

Add `group_ulid`, `room_name`, and two new Kind values to existing
`CallSignal`. All heavy signaling goes through LiveKit WebSocket.
SSE only carries lightweight call-active/call-ended notifications.
Tokens are never broadcast — always fetched individually.

### GC-D05: LiveKit Webhook for Room State

Station learns room lifecycle from LiveKit webhooks, not self-maintained
state or polling. This is the single source of truth for whether a group
call is active.

### GC-D06: Authority Station Hosts LiveKit Room

Group owner Station creates and manages the room. Remote participants
connect directly to its LiveKit instance for media. Membership enforcement
is immediate — authority Station owns both group roster and LiveKit room.
