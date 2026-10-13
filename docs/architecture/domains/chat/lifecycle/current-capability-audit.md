# Chat Lifecycle - Current Capability Audit

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-09-16 | **Updated**: 2026-10-12
> **Owner**: Chat Product Team
> **Audited HEAD**: `3e615e94dca50ba04931ef81ad458c244d9f9770`

This is a current-source classification, not a product-readiness report.
Historical Acceptance remains useful evidence but cannot promote this HEAD.
Browser prototype proof is listed only as product-intent evidence.

---

## 1. Classification

| State | Meaning |
|---|---|
| `PROVEN` | Current exact source passed required receiver-perspective evidence |
| `IMPLEMENTED_UNPROVEN` | Production path exists, but required current evidence does not |
| `PARTIAL` | Some layers or states exist, but the user journey is incomplete |
| `MISSING` | No production product path exists |

Historical proof is recorded separately and never upgrades current status.

## 2. Capability Matrix

| Product area | Current status | Implemented foundation | Missing product closure |
|---|---|---|---|
| Find people | `IMPLEMENTED_UNPROVEN` | Desktop/Mobile local and federated search UI, Station-scoped catalog search, Profile fallback, and explicit no-membership/no-result states exist | No exact-source native search-to-result Gate; cross-Station routing and result identity remain unproven |
| Friend request and contact | `IMPLEMENTED_UNPROVEN` | Generated send/list/accept/reject commands, durable Mobile result reconciliation, request-history projection, and contact/profile entry exist | No current exact-source native request-to-contact proof; cross-Station materialization remains unproven |
| Open/create Direct | `IMPLEMENTED_UNPROVEN` | Existing conversation reuse, canonical create, peer-bound inline retry path exist | No current exact-source search/contact-to-conversation proof |
| Text send/receive | `IMPLEMENTED_UNPROVEN` | Durable Engine command, Direct/MLS encryption, ordered inbox, projection refresh exist | Current-source native proof is absent |
| Offline/reconnect/restart | `IMPLEMENTED_UNPROVEN` | Durable outbox/inbox, SQLCipher reopen, cursor reconcile, generation fencing, and Mobile recovery owners exist | Required exact-source runtime cells, fresh-install recovery, and cleanup evidence are absent |
| Visible send/retry state | `IMPLEMENTED_UNPROVEN` | Pending/retrying/submitted/failed command state and message-level recovery UI exist on both clients | No current receiver-visible failure/retry/restart Gate for this HEAD |
| Conversation list/history/read/search | `IMPLEMENTED_UNPROVEN` | Canonical conversation summaries, latest message, unread counts, paged history, actor read cursors, FTS search, and scoped settings exist | Exact-source mixed-client pagination/search/read convergence and restart proof are absent |
| Message interactions | `IMPLEMENTED_UNPROVEN` | Reply/thread/edit/retract/reaction/pin/read commands, authoritative projection refresh, and role-gated moderation exist | Current interaction, duplicate, restart, and mixed-client readback Gates are unrun for this HEAD |
| Typing | `IMPLEMENTED_UNPROVEN` | Authenticated Direct/Group ingress, TTL projection, and best-effort Mobile publication exist | Current Mobile and mixed-client native typing evidence is absent |
| Image/file attachments | `IMPLEMENTED_UNPROVEN` | Encrypted staging, resumable transfer, cache/open/download, retry, and Mobile media projection exist | Exact-source bidirectional byte/readback, interruption, restart, and permission proof are absent |
| Recorded voice message | `IMPLEMENTED_UNPROVEN` | Desktop and Mobile record, cancel/finish, stage encrypted audio, persist duration/private metadata, render duration, and expose native audio playback controls | Current microphone permission, sender/receiver byte identity, seek/progress, retry, restart, and mixed-client Gate evidence is absent |
| Group lifecycle | `IMPLEMENTED_UNPROVEN` | Canonical Conversation update/invite/remove/role/owner-transfer/leave/dissolve commands and ordered Mobile readback exist | Exact-source mixed-client role denial, epoch recovery, leave/dissolve, and restart proof are absent |
| Live one-to-one voice/video | `PARTIAL` | Desktop and Mobile have sealed signaling, WebRTC/TURN managers, Direct call actions, shell-level surfaces, media controls, reconnect, and cross-device resolution actions | Mobile production styling/i18n and device selection remain incomplete; native media, direct/TURN, cleanup, cross-Station, and mixed-client proof are absent |
| Group live voice/video | `PARTIAL` | Station GroupCall authority + LiveKit adapter, Desktop group-call manager/surface, federation route, and native Gate exist | Mobile has generated contracts but no group-call runtime or product surface; no current multi-participant Gate proof |
| Cross-Station/multi-device/recovery | `IMPLEMENTED_UNPROVEN` | Mixed-client Gates, sender-companion fan-out, actor read convergence, call arbitration, revoke, and federation paths exist | Current exact-source runtime matrix and full cross-Station recovery proof are absent |

Current product result: **0/12 required Chat capabilities are current-source
product-proven**.

## 3. Evidence Integrity Findings

1. The immutable MICU-02/MICU-03 same-Station Chat and Session-class evidence
   is bound to an earlier product commit, not this audited HEAD.
2. Registered cross-Station, multi-device, Group MLS, call-resolution, live
   voice, and group-live Gates do not imply execution or proof.
3. Current unit/static checks prove source contracts only. They do not replace
   sender, receiver, durable readback, native media, restart, or cleanup proof.
4. Mobile Call browser prototype evidence proves state and interaction intent
   only; production Call remains `PARTIAL`.
5. The current standalone worktree cannot start exact-source Mobile runtime
   verification because the Workflow Kernel misclassifies `make mobile` target
   `mobile` as a source path and rejects it with `SOURCE_SCOPE_DENIED`.
6. Existing historical PASS/BLOCKED/FAIL artifacts retain their original
   status and source identity; none is promoted to this HEAD.

## 4. Safety Baseline

- Production Station and Mobile source contains no hard-coded collector URL or
  temporary debug-point block under the audited Chat safety scope.
- Mobile `social.people.search` consumes explicit query/Federation scope and
  preserves unavailable/no-result distinctions.
- Mobile has zero executable `/friend-chat/*` or `/group-chat/*` route callers;
  legacy table names remain persistence compatibility facts, not client owners.
- Every registered Mobile native scenario has traceability metadata and must
  keep missing runtime evidence `UNPROVEN`.
- Formal Gate `chat-lifecycle-safety-e2e` is the source-bound proof owner for
  this baseline.

This closes the safety baseline only. It does not promote any product
capability in section 2.

## 5. Historical Evidence Disposition

Historical Direct, Group MLS, typing, attachment, multi-device, recovery,
same-Station mixed-client, and cross-Station runs demonstrate that portions of
the architecture are feasible. They are retained as regression references
only. Every capability requires a fresh exact-source result before promotion
to `PROVEN`.
