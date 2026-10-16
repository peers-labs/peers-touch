# Chat Lifecycle - Architecture Design

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-09-16 | **Updated**: 2026-10-16
> **Owner**: Chat Product Team
> **Module**: `apps/desktop/`, `apps/mobile/`, `apps/station/app/subserver/`

---

## 1. Design Level

Chat Lifecycle is a cross-domain product-composition architecture. It does not
create a new business authority. It defines the only allowed composition of
existing owners needed to complete the user-visible Chat lifecycle.

Upstream sources:

- `docs/architecture/engineering/api-governance/`
- `docs/architecture/domains/chat/messaging/`
- `docs/architecture/domains/social/runtime/`
- `docs/architecture/shared/communication/event-stream.md`
- `docs/architecture/domains/chat/calling/voice-video.md`
- `docs/architecture/domains/federation/`
- `docs/client/chat/`

## 2. Evidence Ledger

| Claim | Class | Evidence | Confidence |
|---|---|---|---|
| Basic Chat currently fails its product readiness contract | verified_fact | Current acceptance coverage is 1/11 Chat and 0/9 Mobile; current interaction report fails | high |
| Find-person through first-message is not one accepted Journey | verified_fact | Messaging J01 starts after authentication with an already selectable Bob conversation | high |
| Desktop voice notes have real capture/send/playback code | verified_fact | `ChatComposer`, `useChatVoiceRecorder`, and `AttachmentItem` | high |
| Recorded voice lacks a complete product contract and proof | verified_fact | No duration persistence, progress/seek/retry contract, Mobile recorder, or Gate | high |
| Desktop live voice/video has a real WebRTC foundation | verified_fact | `callP2p`, `CallSurface`, Realtime signaling, and TURN discovery | high |
| Current Chat readiness is not proven | verified_fact | Stored evidence binds older source; current worktree has no matching aggregate | high |
| A lifecycle-level integration owner is required | inference | Individual domains contain substantial code, but no source governs their user-facing composition | high |
| Existing domain ownership should remain unchanged | accepted_decision | CHAT-D01 through CHAT-D06 | accepted |
| Active peers can be rendered offline | verified_fact | Desktop sends offline on blur, renews every 300s against a 90s lease, and local Station queries cannot resolve remote authority | high |
| Dynamic badges and interaction metadata shift Chat geometry | verified_fact | Conversation rows have no reserved unread lane; message virtualization remeasures conditionally inserted thread/reaction content | high |
| Current `ADD_ACTOR` immediately prepares an MLS commit and Welcome | verified_fact | `MembershipTransitionPreparer` maps `ADD_ACTOR` to `added_endpoints` and emits Welcome payloads | high |
| Production has no current group-invitation authority or decision command | verified_fact | canonical Chat Proto contains membership transition and leave intent, but no invitation lifecycle contract | high |
| Notification UI can render `GROUP_INVITED` text but resolves decisions only for Friend Requests | verified_fact | `NotificationRow` binds decision buttons only to a pending Friend Request projection | high |
| Friend-only direct add is the default and confirmation is an actor choice | accepted_decision | Owner decision on 2026-10-16 | accepted |
| Per-group rejection must survive leave and override direct add or invitation | accepted_decision | Owner decision on 2026-10-16 | accepted |

## 3. Core Principles

1. Product journeys cross domains; business truth does not.
2. Actor/Social owns discovery and relationships.
3. Conversation owns conversation and group business facts.
4. Device Messaging Engine owns device-private encryption, durable delivery,
   local plaintext projection, attachments, and voice-note bytes.
5. Realtime owns sealed live-call signaling; WebRTC/TURN owns live audio/video
   media.
6. UI submits intents and renders typed projections; it never fabricates
   terminal truth.
7. Every readiness claim is current-source and receiver-perspective.
8. No alias, fallback, dual write, legacy owner, or undeclared debug egress is
   permitted.

## 4. System Topology

```mermaid
flowchart LR
    UI["Desktop / Mobile Chat UI"]
    DISC["Actor + Federation Discovery"]
    SOCIAL["Social Relationship Authority"]
    CONV["Conversation Authority"]
    ENGINE["Device Messaging Engine"]
    LOCAL[("Encrypted local projection")]
    RT["Realtime Signaling"]
    MEDIA["WebRTC direct / TURN"]
    FED["Federation Transport"]

    UI -->|"search / resolve"| DISC
    UI -->|"request / accept / block"| SOCIAL
    UI -->|"create/open / commands"| ENGINE
    ENGINE -->|"authenticated command"| CONV
    CONV -->|"ordered device delivery"| ENGINE
    ENGINE --> LOCAL
    LOCAL -->|"typed projection"| UI

    UI -->|"start / accept / end call"| RT
    RT -->|"sealed signaling"| UI
    UI <-->|"audio / video media"| MEDIA

    DISC <--> FED
    SOCIAL <--> FED
    CONV <--> FED
    RT <--> FED
```

## 5. Ownership

| State | Source of truth | Local projection |
|---|---|---|
| Actor identity and discoverability | Actor / Federation Discovery | Client profile cache |
| Friendship and block state | Social | Client relationship projection |
| Conversation and membership | Conversation | Device Messaging Engine projection |
| Group admission preference and rejected-group set | Actor Home Station Conversation capability | Desktop/Mobile Settings runtime |
| Group invitation and decision lifecycle | Invitee Home Station Conversation capability | Recipient Home Station inbox projection |
| Message and interaction order | Conversation event sequence | Engine SQLCipher projection |
| Device delivery and consumption | Device Inbox | Engine cursor/marker |
| Plaintext, ratchet, MLS private state | Device Messaging Engine | Encrypted local store only |
| Attachment and voice-note bytes | Encrypted object plane + Engine metadata | Verified local cache |
| Typing | Authenticated ephemeral Realtime path | Receiver TTL state |
| Presence | Actor Home Station lease | PTID-keyed Desktop runtime projection |
| Live call lifecycle | Client call runtime plus sealed signaling facts | Runtime-owned call projection |
| Live audio/video media | WebRTC peers | No Station media state |

## 6. Lifecycle Composition Contracts

### 6.1 Discovery To Conversation

- Search returns canonical Actor identity and verified Home Station metadata.
- Relationship history projects one row per counterparty PTID with latest
  authority state and total request attempts; display names never define
  identity.
- Federation runtime joins Station peer IDs to authoritative Station names for
  human-readable summaries, while raw identifiers remain copyable details.
- Social relationship acceptance is the only friendship truth.
- Conversation creation consumes the selected PTID and verified routing
  context; duplicate creation converges on one Direct ID.
- Relationship and conversation events trigger runtime-owned reconciliation.
- UI keeps the selected peer and typed failure until success or explicit exit.

### 6.2 Durable Messaging

- The Engine persists a logical intent and exact command before network submit.
- Conversation accepts one ordered fact and creates required device deliveries.
- Each receiver commits private state, plaintext projection, marker, and cursor
  before ACK.
- Command result readback never advances the authority head; ordered delivery
  remains the committed projection input.
- Conversation list and message surfaces read the same Engine projection.

### 6.3 Rich Media And Voice Notes

- Voice note is a typed audio specialization of the encrypted attachment plane.
- Encrypted private metadata carries MIME/container, duration, and optional
  bounded waveform summary; Station cannot read it.
- Capture and preview remain local draft state until durable send admission.
- Playback uses only the fully verified local cache.
- Transfer progress and playback progress are separate typed states.

### 6.4 Groups

- Group creation and all membership/role/owner/name/dissolve changes are
  Conversation commands and ordered events.
- An actor's Home Station Conversation capability owns the revision-fenced
  `friends_direct_add` preference and rejected-group set. Friendship remains
  Social truth and is read through a declared gate; Conversation does not copy
  relationship state.
- Group authority asks the invitee Home Station for one peer-authenticated,
  source-bound admission decision before preparing `ADD_ACTOR`: `DENIED`,
  `DIRECT_ADD`, or
  `CONFIRMATION_REQUIRED`. Missing, stale, unauthenticated, or unresolved
  admission fails closed.
- `DIRECT_ADD` reuses the existing membership transition unchanged.
  `CONFIRMATION_REQUIRED` creates one authority-owned invitation and one
  recipient notification; it creates no member, MLS commit, Welcome, session,
  or recovery entitlement.
- The invitee Home Station persists invitation, exact signed actor-device
  decision, admission grant, rejected-group state, and notification in one
  local ownership boundary. Group authority does not duplicate invitation
  truth; it consumes the source-bound grant and submits the existing
  `ADD_ACTOR` transition. An authorized active member may claim accepted
  invitations that still require an MLS commit.
- Invitation notification is derived attention. Its `target_id` is the
  invitation ID; deleting or reading the notification cannot decide the
  invitation.
- `Leave and reject future invitations` is a durable Home-Station saga:
  revision-fenced rejection commits before the signed leave intent is
  submitted. The rejected-group projection remains active if delegated MLS
  leave is delayed or fails.
- MLS transition and membership fact are one accepted transition.
- UI cannot mark a group ready before authoritative membership and local MLS
  projection agree.
- Legacy `/group-chat/*` mutation paths are deleted after consumers cut over.

### 6.5 Live Voice And Video

- Live voice and video use existing `CallSignal` over the Realtime stream.
- Signaling payloads remain sealed; Station validates sender, relationship,
  route, size, expiry, and replay metadata without reading SDP or candidates.
- Client call runtime owns permission, ringing, WebRTC, ICE/TURN, media tracks,
  reconnect, timeout, and teardown across page navigation.
- Video uses the same call identity and signaling lifecycle while adding camera
  permission, local preview, remote video, camera toggle, and camera-device
  selection.
- Conversation membership identifies the Direct peer but does not own media.
- Text messaging continues through the durable messaging path during calls.

### 6.6 Presence And Stable Conversation Geometry

- Presence means authenticated runtime reachability, not foreground focus.
  Window blur, minimization, or a hidden Chat page cannot mark an actor
  offline.
- The Desktop runtime renews its Home Station lease at no more than one third
  of the Station TTL. Logout, shutdown, confirmed network loss, revocation, and
  lease expiry are the only offline transitions.
- Clients query only their own Station. The local Presence owner partitions
  snapshots by Actor Identity's verified Home Station and uses the
  authenticated Federation peer-call transport for remote reads.
- Unknown routing, unavailable remote authority, invalid peer authentication,
  and omitted results remain unknown. They are never converted to offline.
- Same-Station `PresenceFlip` events update the PTID-keyed projection
  immediately. Realtime reconnect, inbound conversation activity, relationship
  changes, and the bounded runtime reconcile refresh remote snapshots.
- Event application advances a per-PTID revision. A snapshot may update a PTID
  only when no newer event was observed after that snapshot began.
- Conversation rows reserve a fixed trailing lane for unread state. Message
  rows keep interaction metadata in a bounded rail, and virtualized timelines
  preserve the visible anchor when measured row geometry changes.

## 7. Failure Semantics

| Failure | Required behavior |
|---|---|
| Search/resolve unavailable | Preserve query and scope; show retry |
| Relationship command uncertain | Preserve pending identity; reconcile canonical state |
| Direct creation failed | Preserve peer-bound pane; inline retry |
| Message submit timeout | Keep exact durable command retrying |
| Message terminal failure | Show failed-actionable; never read/delivered |
| Attachment/voice transfer interrupted | Resume from verified checkpoint |
| Microphone denied | Preserve draft context; show permission action |
| Camera denied | Preserve the conversation; expose retry or audio-only exit without false video-active state |
| MLS/membership mismatch | Stop send; reconcile before ready |
| Admission policy unavailable | Reject direct add/invite preparation with a typed retryable failure |
| Invitation accepted but no fulfiller is online | Keep `accepted_waiting_for_mls`; reconcile and retry without fabricating membership |
| Invitation decision replay | Return the original terminal decision; conflicting decision is rejected |
| Leave-and-reject partial completion | Keep rejection active and expose leave retry with the original intent |
| Call network loss | Enter reconnecting, then recover or terminate visibly |
| Station/restart loss | Reopen durable projections and workers |
| Presence authority unavailable | Render unknown; retry through bounded runtime reconciliation |
| Message metadata changes row size | Preserve the tail or visible-message anchor; never jump neighboring content |
| Evidence identity mismatch | Fail the Gate; never substitute fixture values |

## 8. Allowed And Forbidden Relationships

Allowed:

- UI -> typed client runtime intent.
- Client runtime -> declared resource-owner API.
- Conversation -> Device Inbox and Federation for ordered delivery.
- Realtime -> Federation for sealed cross-Station call signaling.
- Engine -> encrypted object plane for attachments and voice notes.
- Conversation authority -> invitee Home Station admission capability.
- Notification projection -> invitation ID for navigation and decision lookup.

Forbidden:

- UI -> direct Station database or foreign Station.
- Social or UI -> duplicate Conversation creation truth.
- Realtime/SSE frame -> durable message truth.
- Chunked file transfer -> claimed live voice stream.
- Client fixture -> observed identity or success result.
- Production source -> hard-coded debug/telemetry endpoint.
- Window focus/visibility -> authoritative actor offline state.
- Missing or failed remote presence read -> offline.
- Legacy friend/group Chat route -> fallback business owner.
- Notification row or client store -> invitation or membership authority.
- Group authority -> cached mutable copy of actor admission preference.
- Invitation acceptance -> direct membership mutation without a bound MLS
  transition and Welcome.

## 9. Quality Gates

The architecture is falsified when any required journey lacks:

- real producer and receiver actions;
- authoritative and device-local readback;
- failure/restart evidence appropriate to the changed state;
- privacy/log scans;
- required Desktop and Mobile runtime cells;
- reverse-order cleanup.

The specific Gate mapping is defined only in `acceptance-matrix.md`.
