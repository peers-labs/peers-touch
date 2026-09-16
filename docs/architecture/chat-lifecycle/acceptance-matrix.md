# Chat Lifecycle - Acceptance Matrix

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-16 | **Updated**: 2026-09-16
> **Owner**: Chat Product Team

---

## 1. Acceptance Rule

```text
Capability -> Journey -> visible state -> owner truth
           -> sender action -> receiver result -> durable readback
           -> failure recovery -> cleanup -> current-source evidence
```

`PROVEN` requires a successful current exact-source run. Historical evidence,
static checks, API-only tests, mocks, screenshots, and source presence remain
supporting evidence only.

## 2. Capability Crosswalk

| Capability | Journey | Gate | Receiver assertion |
|---|---|---|---|
| CHAT-C01 discovery | J01 | CHAT-G01 | Search returns the intended local or federated person with stable identity and actionable failure |
| CHAT-C02 relationship | J01 | CHAT-G02 | Both users observe the same accepted/rejected relationship without duplicate effects |
| CHAT-C03 conversation entry | J01 | CHAT-G03 | Message opens exactly one peer-bound Direct conversation and preserves inline retry on failure |
| CHAT-C04 durable text | J01-J02 | CHAT-G04 | Receiver sees exact plaintext once; sender sees truthful queued/delivered/read/failure state |
| CHAT-C05 projection | J02 | CHAT-G05 | List, unread, preview, pagination, local search, settings, and restart readback agree |
| CHAT-C06 attachments | J03 | CHAT-G06 | Receiver opens byte-identical encrypted image/file content after retry and restart |
| CHAT-C07 voice notes | J03 | CHAT-G07 | Receiver plays byte-identical recorded audio with duration, progress, seek, and retry |
| CHAT-C08 interactions | J02/J04 | CHAT-G08 | Reply/edit/retract/reaction/pin/read/typing converge for Direct and Group |
| CHAT-C09 group lifecycle | J04 | CHAT-G09 | All active members agree on membership, role, MLS epoch, content, and terminal history state |
| CHAT-C10 live voice | J05 | CHAT-G10 | Both users exchange audible media through direct and TURN paths and converge on terminal state |
| CHAT-C11 continuity | J07 | CHAT-G11 | Offline, restart, multi-device, revoke, recovery, and cross-Station flows preserve exact truth |
| All required Mobile claims | J06 | CHAT-G12 | Mobile completes the same required outcomes with native lifecycle and permission behavior |
| Release claim | J08 | CHAT-G13 | All required cells pass at one exact source with zero unresolved product gaps |

## 3. Gate Definitions

### CHAT-G00: Safety And Evidence Integrity

- Production source contains no undeclared debug HTTP egress.
- Acceptance observations originate from the production result, not fixture
  echo or injected expected values.
- Required Mobile scenarios are executable and produce typed blocked evidence
  instead of missing-metadata crashes.
- Capability inventory reports source, historical evidence, and current proof
  as separate fields.

### CHAT-G01-G03: Discovery To Conversation

- A user performs local search, exact federated-handle resolution, and
  Station-scoped search in Native UI.
- Sender and receiver perform request, pending, accept, reject, duplicate, and
  retry states.
- Accepted relationship creates or reuses one Direct conversation.
- Conversation creation failure keeps the selected peer and exposes inline
  retry.

### CHAT-G04-G05: Daily Direct

- Two native clients exchange unique text in both directions.
- Offline delivery, reconnect, client restart, Station restart, duplicate
  delivery, and submitted-command reconciliation preserve identity/order.
- Queued, retrying, failed, delivered, and read states are distinct.
- Conversation preview, unread/read, older-history pagination, local search,
  settings, and cold-start readback agree with durable owners.

### CHAT-G06-G07: Rich Media And Voice Notes

- Image/file and recorded-audio messages use the production encrypted
  attachment path.
- Sender and receiver attachment IDs, byte hashes, private metadata, and
  visible message identity agree.
- Upload/download interruption, retry, restart, and recovery are exercised.
- Voice capture permission, cancel, duration, playback progress, seek, pause,
  resume, end, and failure states are visible.

### CHAT-G08-G09: Interactions And Groups

- Direct and Group reply/thread, edit, retract, reaction, pin, read, and typing
  converge after offline/restart/duplicate paths.
- Group create, add/remove, leave, role/owner change, rename, dissolve, and
  entitled-history behavior use Conversation-owned commands.
- Removed/revoked endpoints observe no future private content.

### CHAT-G10: Live Voice

- Two native clients prove incoming/outgoing ringing, accept, reject, no-answer,
  permission denial, active audio, mute, input selection, direct ICE, TURN
  fallback, reconnect, and hangup.
- Text messaging remains operational during a call.
- Station logs contain no sealed signaling plaintext, SDP, candidate address,
  TURN credential, or media payload.
- All media tracks, peer connections, timers, and call projections are released.

### CHAT-G11-G12: Continuity And Mobile

- Multi-device fan-out, revoke, fresh-install recovery, and cross-Station
  Direct/Group use the same logical identities and no fallback owner.
- Mobile proves discovery through message, rich media, voice note, group,
  interaction, and live voice on required native cells.
- Background/resume, permission, audio route, keyboard, and safe-area behavior
  are included where material.

### CHAT-G13: Release Aggregate

- Current exact source is clean and bound to every result.
- All CHAT-G00-G12 results pass in the required runtime-cell matrix.
- Gap detector, quality evidence, completion audit, and independent review have
  no unresolved required finding.

## 4. Required Runtime Cells

| Cell | Required coverage |
|---|---|
| macOS native Desktop | CHAT-G01-G11 |
| Linux native Desktop | CHAT-G04, G06, G08-G11 |
| Windows native Desktop | CHAT-G04, G06, G08-G11 |
| iOS native Mobile | CHAT-G01-G12 |
| Android native Mobile | CHAT-G01-G12 |
| Same-Station two actor | G01-G10 |
| Cross-Station two actor | G01-G05, G08-G11 |
| One actor, two active devices, one revoked device | G04, G09, G11 |

## 5. Current Baseline

At `c6d3b79b409013c921fafcb8c735b7f419cc303f`, no CHAT-G00-G13 gate has
current exact-source proof. Historical Chat runs are evidence of feasibility,
not readiness. See `current-capability-audit.md`.

## 6. Completion Rule

Any required Gate in `FAIL`, `BLOCKED`, `PARTIAL`, `UNPROVEN`, `NOT_RUN`, or
stale-source state keeps the corresponding capability and overall Chat
readiness unproven.
