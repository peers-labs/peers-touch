# Chat Lifecycle - Current Capability Audit

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-09-16 | **Updated**: 2026-09-24
> **Owner**: Chat Product Team
> **Audited source**: active `CCU-20260922` Plan workspace; proof identity is
> taken from immutable Evidence Store manifests, not this document

This audit classifies source feasibility only. No row becomes `PROVEN` without
current exact-source receiver evidence from its named formal Gate.

## 1. Classification

| State | Meaning |
|---|---|
| `PROVEN` | Required current-source receiver evidence passed |
| `IMPLEMENTED_UNPROVEN` | Production loop exists; required Gate has not passed |
| `PARTIAL` | Some required actions/platforms/recovery states are absent |
| `MISSING` | No production product loop exists |

## 2. Chat Capability Feasibility

| ID | Status | Repository-backed foundation | Smallest feasible loop and executable proof |
|---|---|---|---|
| CHAT-C01 | `PARTIAL` | Desktop/Mobile person search and Federation resolution surfaces exist | Search one actor, render Station/trust context, preserve failed query; `CHAT-G01` |
| CHAT-C02 | `IMPLEMENTED_UNPROVEN` Desktop; `PARTIAL` Mobile | Social send/list/accept/reject/block projection exists | Alice sends, Bob accepts/rejects, both read one relationship; `CHAT-G02` |
| CHAT-C03 | `IMPLEMENTED_UNPROVEN` | Canonical Direct create/reuse and peer-bound retry surface exist | Contact-to-one-Direct with retry/readback; `CHAT-G03` |
| CHAT-C04 | `IMPLEMENTED_UNPROVEN` | Messaging Core durable command, Direct/MLS crypto, ordered Inbox and SQLCipher projection exist | Bidirectional unique text with retry/restart; `CHAT-G04` |
| CHAT-C05 | `PARTIAL` | Conversation list/history/read/search/settings projections exist | Active transcript + row preview/unread/search survive restart; `CHAT-G05` |
| CHAT-C06 | `IMPLEMENTED_UNPROVEN` Desktop; `PARTIAL` Mobile | Encrypted resumable transfer, attachment rendering and open/download exist | Byte-identical image/file after interruption and restart; `CHAT-G06` |
| CHAT-C07 | `PARTIAL` Desktop; `MISSING` Mobile | Desktop WebM capture and audio attachment playback exist | Record, preview, send, receive, seek/retry/restart on both clients; `CHAT-G07` |
| CHAT-C08 | `IMPLEMENTED_UNPROVEN` | Reply/thread/edit/retract/reaction/pin/read/typing contracts and projections exist | Direct/Group interaction convergence after duplicate/restart; `CHAT-G08` |
| CHAT-C09 | `PARTIAL` | Conversation Group create, MLS add/remove/send and projection foundations exist | Three actors complete membership, role/owner, leave/dissolve and entitled-history flow; `CHAT-G09` |
| CHAT-C10 | `PARTIAL` Desktop; `MISSING` Mobile media | Desktop WebRTC, sealed signaling, TURN, audio/video surface and device controls exist | Two native clients complete audio/video direct and TURN calls; `CHAT-G10` |
| CHAT-C11 | `PARTIAL` | Durable outbox/inbox/replay/recovery and cross-Station foundations exist | Offline, restart, revoke, fresh-device and cross-Station recovery; `CHAT-G11` |
| CHAT-C12 | `MISSING` in this worktree | Group membership and one-to-one media foundations are reusable | Three-client authorized SFU room after separate SFU architecture; `CHAT-G14` |
| CHAT-C13 | `PARTIAL` | Sender companion/read cursor contracts, call state models and control-plane prototype exist | Same-actor Desktop+Mobile message/read and call-resolution flow; `CHAT-G18`, `CHAT-G19` |

## 3. CCU Feasibility

| ID | Status | Repository-backed foundation | Smallest feasible loop and executable proof |
|---|---|---|---|
| CCU-C01 | `PARTIAL` | Canonical Conversation/Message identities and mixed-client fixtures exist | Desktop/Mobile read the same Direct/Group identity; `CHAT-G15`, `CHAT-G16` |
| CCU-C02 | `IMPLEMENTED_UNPROVEN` | Both clients submit through native Messaging Engine paths | Bidirectional Direct/Group text and state convergence; `CHAT-G16`, `CHAT-G17` |
| CCU-C03 | `PARTIAL` | Durable replay, dedupe and restart paths exist | Offline/reconnect/restart without duplicate or legacy fallback; `CHAT-G17`, `CHAT-G18` |
| CCU-C04 | `PARTIAL` | Conversation MLS and mixed-client projection foundations exist | Three-actor mixed Group create/add/remove/rejoin, role/owner, leave/dissolve, epoch and entitled-history convergence; `CHAT-G20` |
| CCU-C05 | `IMPLEMENTED_UNPROVEN` | Canonical interaction, receipt and typing paths exist | Mixed reply/edit/read/typing convergence after restart; `CHAT-G16`, `CHAT-G17` |
| CCU-C06 | `PARTIAL` | Shared attachment identity/transfer contracts exist | Mixed-client byte-identical attachment after restart; `CHAT-G16`, `CHAT-G17` |
| CCU-C07 | `PARTIAL` | Confirmed platform-adapted prototypes and typed state mapping exist | Desktop/Mobile expose equal message and call outcome semantics; `CHAT-G15`, `CHAT-G16`, `CHAT-G19` |
| CCU-C08 | `PARTIAL` | Sender companion/read cursor prototypes, client call states and Station arbitration foundation exist | One actor on Desktop+Mobile converges message/read/call winner; `CHAT-G18`, `CHAT-G19` |

Capability-level global readiness remains `UNPROVEN` while required
Linux/Windows Desktop, Android Mobile, and physical-device cells remain unrun.
Current macOS Desktop + iOS Simulator proof is reported per Gate and must not be
generalized to those unsupported cells.

## 4. Current Evidence Gaps

1. Mixed same-Station, cross-Station, multi-device and Group MLS Gate runners
   cover the macOS Desktop + iOS Simulator cells only; every claim still
   requires current exact-source evidence.
2. The call-resolution Gate uses one actor on Desktop plus Mobile and a
   separate caller, but unsupported platform cells remain `UNPROVEN`.
3. `CHAT-G22` requires canonical Evidence Store authoritative latest manifests
   for every `CHAT-G15..G21` result. Missing, stale, failed, partial, unproven,
   optional, or skipped prerequisites block the aggregate.
4. Full macOS/Linux/Windows/iOS/Android and mixed runtime-cell evidence is not
   current at this source.
5. Group live voice/video remains outside CCU implementation and cannot become
   `PROVEN` without its separate accepted SFU design.

## 5. Safety And Historical Evidence

- Production source must contain no undeclared debug egress.
- Fixture-provided expected values cannot become observed product results.
- Historical Direct, Group, typing, attachment, multi-device, recovery and
  cross-Station runs establish feasibility only.
- Every required but unrun Gate remains `UNPROVEN`; no historical artifact,
  source scan, build, mock or screenshot upgrades product readiness.
