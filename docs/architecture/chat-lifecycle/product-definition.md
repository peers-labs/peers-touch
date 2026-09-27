# Chat Lifecycle - Product Definition

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-09-16 | **Updated**: 2026-09-18
> **Owner**: Chat Product Team

---

## 1. Product Thesis

Target users are people who expect Peers-Touch Chat to work as a daily
communication product on Desktop and Mobile, including self-hosted and
cross-Station relationships.

Product promise:

> A user can discover a real person, establish the permitted relationship,
> enter one stable conversation, exchange durable private content, use voice,
> and recover the same conversation after ordinary failures without knowing the
> underlying Station, device, queue, or encryption topology.

First useful outcome:

1. Alice and Bob cold-launch previously authenticated native accounts without
   re-entering credentials; a configured PIN remains the only local unlock
   prompt.
2. Alice searches for Bob by local identity or federated handle.
3. Alice sends a request and Bob accepts it.
4. Both clients show the same contact and one Direct conversation.
5. Alice and Bob exchange exact text and observe truthful delivery state.
6. Both restart and retain the conversation and plaintext history.

Recurring value extends this result to media, recorded voice, one-to-one and
group live voice/video, groups, multiple devices, and multiple Stations.

## 2. Product Readiness Rule

Chat is not product-ready when only source, compilation, unit tests, API
readback, screenshots, or historical evidence exist.

A capability is ready only when the current exact source proves:

- the real user action;
- the intended sender and receiver visible result;
- the authoritative Station and device-local durable state when applicable;
- recovery after the capability's material failure boundaries;
- cleanup and isolation for the claimed runtime cells.

Prior evidence remains useful regression history but never substitutes for a
current-source claim.

## 3. Capability Profile

| ID | Capability | Class | Product claim |
|---|---|---|---|
| CHAT-C01 | Person discovery and identity | required | Search local and federated people, show a human-readable Home Station name, keep canonical PTID/Station peer ID copyable in details, and fail visibly when resolution is unavailable |
| CHAT-C02 | Relationship establishment | required | Send, receive, accept, reject, block, and unblock with one durable relationship result; request retries project as one PTID-keyed person row with attempt count and selectable history |
| CHAT-C03 | Conversation entry | required | Open or create exactly one Direct conversation from a person/contact and return to it after restart |
| CHAT-C04 | Durable text lifecycle | required | Send, receive, order, retry, reconnect, and restart without loss, duplication, or hidden terminal failure |
| CHAT-C05 | Conversation projection | required | Active transcript, conversation list, per-conversation unread/read attribution, latest-message previews, history pagination, canonical local search, immediate background preview with asynchronous persistence, and irreversible current-device conversation clearing reflect durable truth |
| CHAT-C06 | Rich attachments | required | Image, file, and screenshot content is captured without resizing the app, encrypted, resumable, visible, downloadable, and recoverable |
| CHAT-C07 | Recorded voice messages | required | Record, preview/cancel, send, receive, play, seek, retry, and restore an encrypted voice note with truthful duration/progress |
| CHAT-C08 | Message interactions and presence | required | Reply/thread, edit, retract, reaction, pin, read, and typing converge across members and restart without false failure after authority acceptance; visible presence is reconciled from the Presence owner and never guessed |
| CHAT-C09 | Group lifecycle | required | Create, add/remove/leave, role/owner changes, rename, dissolve, message, and preserve entitled history |
| CHAT-C10 | Live one-to-one voice and video | required | Ring, accept/reject, connect audio/video, mute, toggle or change camera/input, reconnect, and end through WebRTC direct/TURN paths |
| CHAT-C11 | Continuity and portability | required | Cross-Station, multi-device, revoke, offline delivery, fresh-install recovery, and failure diagnostics preserve product truth |
| CHAT-C12 | Group live voice and video | required | Start or join an audio/video call from an active group, converge participant/media state across active members, recover from reconnect, and end without leaking media to removed or revoked members |

## 4. Platform Applicability

| Capability | Desktop | Mobile | Browser | Claim boundary |
|---|---|---|---|---|
| CHAT-C01-C09 | required | required | not claimed | Each platform needs independent native evidence |
| CHAT-C10 one-to-one live voice/video | required | required | not claimed | One-to-one audio and video use direct ICE with TURN fallback |
| CHAT-C11 continuity | required | required | not claimed | Cross-Station and device/recovery cells are explicit |
| CHAT-C12 group live voice/video | required | required | not claimed | Lightweight calls launched from an existing group; enterprise meeting administration is not claimed |

Desktop proof cannot substitute for Mobile. Simulator or emulator evidence
cannot substitute for a required physical-device claim when the platform
contract requires hardware behavior.

## 5. Voice Definitions

Recorded voice and live voice are separate products:

- A **recorded voice message** is durable encrypted Chat content. It uses the
  attachment data plane but has voice-specific capture, duration, playback,
  seek, progress, retry, and recovery behavior.
- **Live one-to-one voice/video** is an ephemeral WebRTC session. Station
  routes sealed signaling; media uses direct ICE with TURN fallback. It never
  uses the durable message lane as a media stream.
- **Group live voice/video** is an ephemeral multi-participant call attached to
  an authoritative Group conversation. Participants independently join,
  decline, leave, reconnect, mute, or toggle camera while membership and revoke
  changes fail closed. Its media topology requires a separately accepted SFU
  design; it must not be implemented as an unbounded peer-to-peer mesh.

Resumable chunk upload is not called streaming voice. Group calling is
`CHAT-C12` and cannot be counted toward the one-to-one `CHAT-C10` closure.

## 6. Trust And Safety Promises

- Station never receives message, attachment, or voice-note plaintext or media
  keys.
- Live media remains end-to-end transport protected and Station does not parse
  sealed signaling payloads.
- Production code does not send debug or telemetry payloads to undeclared
  endpoints.
- Acceptance fixtures do not inject expected identity into the observed result
  and then claim verification.
- UI never converts failure into success, read, delivered, or ready state.
- No legacy route, local fallback, alias, or dual-write path may become a
  second business owner.

## 7. Product Metrics

| Outcome | Target |
|---|---|
| Direct text delivery while both clients are online | P95 <= 1 second from authority commit to receiver-visible plaintext |
| Duplicate visible messages after retry/restart | 0 |
| Accepted message loss after disconnect/restart | 0 |
| Hidden terminal send failures | 0 |
| Voice-note byte mismatch after transfer/restart | 0 |
| Live voice connection after acceptance | bounded timeout with explicit connecting/reconnecting/failure state |
| Group call membership/media divergence | 0 |
| Cross-actor or cross-device state leakage | 0 |
| Current-source required Gate coverage at release | 100% |

## 8. Deferred Or Optional Capabilities

- Browser Chat readiness.
- Screen sharing.
- Call recording and transcription.
- Durable call-history cards.

These capabilities remain visible product backlog. They do not count toward
the current release claim until promoted through a reviewed product amendment.

## 9. Non-Goals

- Scheduled webinars, calendar-backed meetings, and enterprise meeting
  administration.
- Server-side plaintext search or media processing.
- Anonymous SimpleX-style addressing.
- Permanent compatibility routes or parallel Chat authorities.
- Treating old runtime-cell evidence as current product acceptance.

## 10. Product Gate

The user directive on 2026-09-16 accepts this capability scope as the new Chat
product baseline. The 2026-09-18 amendment promotes group live voice/video to a
required capability while retaining enterprise meeting administration as a
non-goal. Readiness remains `UNPROVEN` until every required journey in
`acceptance-matrix.md` passes on current exact source.
