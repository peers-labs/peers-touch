# Mobile Shell — 体验合同

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-27 | **Updated**: 2026-08-27
> **Owner**: Mobile Product Team
> **Module**: `apps/mobile/`

---

## 1. Journey Index

| ID | Journey | Capabilities |
|---|---|---|
| MS-J01 | First Station entry | MS-C01, MS-C02, MS-C03 |
| MS-J02 | Returning session restore | MS-C01, MS-C02, MS-C10 |
| MS-J03 | Conversation work | MS-C04, MS-C05, MS-C06 |
| MS-J04 | Contact and group work | MS-C04, MS-C07 |
| MS-J05 | Moments participation | MS-C04, MS-C08 |
| MS-J06 | Profile, settings, and Station change | MS-C04, MS-C09, MS-C10 |
| MS-J07 | Interrupted work and degraded recovery | MS-C05, MS-C08, MS-C10, MS-C14 |

## 2. MS-J01 First Station Entry

1. User opens Mobile without an active Station.
2. System shows saved Stations and truthful checking/online/offline/unknown states.
3. User selects or adds one Station.
4. System performs Station handshake before exposing authentication.
5. Station returns the current access gate.
6. User completes Email login or GitHub/Google OAuth.
7. System verifies callback/session with the selected Station.
8. Remaining Station gates continue until access is granted.
9. Critical session runtimes bootstrap and the Shell becomes visible.

Recovery:

- Invalid address stays on Station selection with field-level recovery.
- Unreachable Station offers retry and Station change.
- A saved URL presenting another Station identity shows a blocking trust state;
  the user may go back or explicitly replace the saved Station.
- Removing a Station requires confirmation, removes only its local registry
  entry, and never silently deletes Station-owned data.
- OAuth cancellation returns to the same access gate without losing Station context.
- OAuth expiry/replay/provider mismatch preserves the Station and offers retry
  or Email login without activating a session.
- Gate denial never enters the Shell.

## 3. MS-J02 Returning Session Restore

1. User opens Mobile with a saved Station and secure session.
2. System validates Station and session.
3. Station resumes the access gate chain.
4. If access remains granted, critical projections bootstrap and Shell opens.
5. If revoked or expired, secure session is cleared and the current login gate appears.

The user must never see stale account data from another Station or actor while
the restore decision is pending.

## 4. MS-J03 Conversation Work

1. User opens Chats and sees Station-backed friend and group conversation projections.
2. Search filters the projected list without changing authoritative data.
3. User opens a conversation; the detail surface hides the bottom tab bar.
4. History loads while preserving the current scroll anchor.
5. User sends text or attachment content and sees explicit pending/committed/failure state.
6. Realtime events update messages, receipts, typing, reactions, pins, and mutations.
7. Missing events are repaired by reconciliation.
8. Back returns to the prior list context.
9. Attachment upload, typing, search, delete, and conversation settings expose
   their own waiting, success, failure, and recovery state.

Message actions must preserve readable content and provide local recovery.
Non-idempotent writes with unknown outcomes are never silently replayed.
Conversation drafts survive tab changes and background/resume; process restart
restores the latest safely persisted draft without presenting it as sent.

## 5. MS-J04 Contact And Group Work

1. User opens Contacts and sees pending requests, friends, and groups.
2. User searches local contacts or resolves a federated handle.
3. User accepts/rejects a request or sends a new request.
4. User opens a profile and may start a conversation or manage block state.
5. User creates a group, selects initial members, and enters the resulting group.
6. Authorized group roles manage membership and ownership through explicit,
   confirmed actions.

No-result local search, unresolved federated handle, duplicate request,
permission denial, and remote Station unavailable are distinct states with a
valid next action.

## 6. MS-J05 Moments Participation

1. User opens Moments and sees the latest Station projection.
2. User paginates or refreshes without losing already visible content.
3. User publishes text or images with visible audience.
4. User reacts, comments, or replies and sees pending, committed, or failed state.
5. Runtime events or reconciliation update affected feed/detail projections.

An empty feed, filtered feed, unavailable feed, and policy-hidden feed are
different visible states.
Composer text, successful attachments, and audience survive tab change,
background, submission failure, and process restart until publish or discard.
Optimistic reaction/comment state rolls back to Station readback on rejection.

## 7. MS-J06 Profile, Settings, And Station Change

1. User opens Me and sees identity, Station, trust, and profile summary.
2. User opens a settings detail; only that detail surface mounts.
3. Account-level preferences persist through Station; device-level preferences
   remain local.
4. User changes Station or logs out.
5. System tears down session runtimes, clears actor-scoped projections and
   credentials, preserves the Station registry, and restarts the gate flow.

Language, notification, privacy, storage, and blocked-user surfaces distinguish
saved, unsaved, saving, permission-required, failed, and externally changed
states. Leaving an unsaved detail requires save, discard, or stay.

## 8. MS-J07 Interrupted Work And Degraded Recovery

1. User performs a write while connectivity or Station response becomes uncertain.
2. The affected item shows queued, pending, unknown, retryable, or terminal
   state without claiming success.
3. The user may check status, keep editing a draft, or discard local tracking;
   replay is offered only when Station proves no prior commit.
4. Capacity exhaustion disables new writes with an explanation while read-only
   projections remain available.
5. Session revocation or Station identity mismatch closes writes immediately,
   hides prior-scope projections, and presents re-authentication or Station
   replacement.
6. A device-local message flag is explicitly labeled as local to this device;
   another device is not expected to show it.

## 9. Platform Adaptation

| Product behavior | Mobile contract |
|---|---|
| Primary navigation | Bottom tabs with same-frame visible feedback |
| Detail navigation | Stack semantics; tab bar hidden for immersive detail |
| Context actions | Bottom sheet or dedicated page |
| Secure credentials | Tauri/native secure storage |
| OAuth callback | Native deep link returns to the same Station/access attempt |
| Foreground freshness | Event stream plus reconcile |
| Background freshness | Push/wakeup marks stale; resume performs authoritative sync |
| Large lists | Virtualized or bounded rendering with preserved anchors |
| Accessibility | Screen-reader order, dynamic text, focus restoration, reduced motion, and labeled icon actions |
