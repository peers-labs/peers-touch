# Chat Lifecycle - Product Definition

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-16 | **Updated**: 2026-09-16
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

1. Alice searches for Bob by local identity or federated handle.
2. Alice sends a request and Bob accepts it.
3. Both clients show the same contact and one Direct conversation.
4. Alice and Bob exchange exact text and observe truthful delivery state.
5. Both restart and retain the conversation and plaintext history.

Recurring value extends this result to media, recorded voice, live voice,
groups, multiple devices, and multiple Stations.

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
| CHAT-C01 | Person discovery and identity | required | Search local and federated people, show stable PTID/Home Station identity, and fail visibly when resolution is unavailable |
| CHAT-C02 | Relationship establishment | required | Send, receive, accept, reject, block, and unblock with one durable relationship result |
| CHAT-C03 | Conversation entry | required | Open or create exactly one Direct conversation from a person/contact and return to it after restart |
| CHAT-C04 | Durable text lifecycle | required | Send, receive, order, retry, reconnect, and restart without loss, duplication, or hidden terminal failure |
| CHAT-C05 | Conversation projection | required | Conversation list, unread/read, previews, history pagination, local search, and settings reflect durable truth |
| CHAT-C06 | Rich attachments | required | Image and file content is encrypted, resumable, visible, downloadable, and recoverable |
| CHAT-C07 | Recorded voice messages | required | Record, preview/cancel, send, receive, play, seek, retry, and restore an encrypted voice note with truthful duration/progress |
| CHAT-C08 | Message interactions and presence | required | Reply/thread, edit, retract, reaction, pin, read, and typing converge across members and restart |
| CHAT-C09 | Group lifecycle | required | Create, add/remove/leave, role/owner changes, rename, dissolve, message, and preserve entitled history |
| CHAT-C10 | Live one-to-one voice | required | Ring, accept/reject, connect, mute, change input, reconnect, and end through WebRTC direct/TURN paths |
| CHAT-C11 | Continuity and portability | required | Cross-Station, multi-device, revoke, offline delivery, fresh-install recovery, and failure diagnostics preserve product truth |

## 4. Platform Applicability

| Capability | Desktop | Mobile | Browser | Claim boundary |
|---|---|---|---|---|
| CHAT-C01-C09 | required | required | not claimed | Each platform needs independent native evidence |
| CHAT-C10 live voice | required | required | not claimed | One-to-one audio only; video is deferred |
| CHAT-C11 continuity | required | required | not claimed | Cross-Station and device/recovery cells are explicit |

Desktop proof cannot substitute for Mobile. Simulator or emulator evidence
cannot substitute for a required physical-device claim when the platform
contract requires hardware behavior.

## 5. Voice Definitions

Recorded voice and live voice are separate products:

- A **recorded voice message** is durable encrypted Chat content. It uses the
  attachment data plane but has voice-specific capture, duration, playback,
  seek, progress, retry, and recovery behavior.
- **Live voice** is an ephemeral one-to-one WebRTC session. Station routes
  sealed signaling; media uses direct ICE with TURN fallback. It never uses
  the durable message lane as a media stream.

Resumable chunk upload is not called streaming voice. Video and group voice are
deferred and cannot be counted toward CHAT-C10.

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
| Cross-actor or cross-device state leakage | 0 |
| Current-source required Gate coverage at release | 100% |

## 8. Non-Goals

- Browser Chat readiness.
- Group voice or video conferencing.
- Server-side plaintext search or media processing.
- Anonymous SimpleX-style addressing.
- Permanent compatibility routes or parallel Chat authorities.
- Treating old runtime-cell evidence as current product acceptance.

## 9. Product Gate

The user directive on 2026-09-16 accepts this capability scope as the new Chat
product baseline. Readiness remains `UNPROVEN` until every required journey in
`acceptance-matrix.md` passes on current exact source.
