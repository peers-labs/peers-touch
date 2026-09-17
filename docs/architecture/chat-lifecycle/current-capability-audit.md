# Chat Lifecycle - Current Capability Audit

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-16 | **Updated**: 2026-09-16
> **Owner**: Chat Product Team
> **Audited HEAD**: `c6d3b79b409013c921fafcb8c735b7f419cc303f`

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
| Find people | `PARTIAL` | Desktop/Mobile local and federated search UI and APIs exist | Station-scoped search is inert; federation catalog is local-only; no current native search-to-result proof |
| Friend request and contact | `IMPLEMENTED_UNPROVEN` on Desktop; `PARTIAL` on Mobile | Send/list/accept/reject and relationship projection exist | Desktop failures can be log-only; Mobile cross-Station materialization is unresolved; no current UI lifecycle proof |
| Open/create Direct | `IMPLEMENTED_UNPROVEN` | Existing conversation reuse, canonical create, peer-bound inline retry path exist | No current exact-source search/contact-to-conversation proof |
| Text send/receive | `IMPLEMENTED_UNPROVEN` | Durable Engine command, Direct/MLS encryption, ordered inbox, projection refresh exist | Current-source native proof is absent |
| Offline/reconnect/restart | `IMPLEMENTED_UNPROVEN` on Desktop; `PARTIAL` on Mobile | Durable outbox, inbox cursor, replay, SQLCipher reopening exist | Required current runtime cells and Mobile recovery are unproven |
| Visible send/retry state | `PARTIAL` | Engine persists pending/retry/submitted/failed states | Desktop lacks complete message-level failed/retry UI; Mobile can render failed as read |
| Conversation list/history/read/search | `PARTIAL` | Conversation projection, local history, FTS, settings, receipt paths exist | Desktop preview/unread loaders contain no-op paths; history pagination is incomplete; Group/Mobile receipt parity is absent |
| Message interactions | `IMPLEMENTED_UNPROVEN` | Reply/thread/edit/retract/reaction/pin/read contracts and projections exist | Repository-local Native interaction report is `FAIL`; no current proof |
| Typing | `IMPLEMENTED_UNPROVEN` | Authenticated ephemeral Direct/Group paths and TTL projection exist | Stored PASS is stale relative to current source; Mobile proof absent |
| Image/file attachments | `IMPLEMENTED_UNPROVEN` on Desktop; `PARTIAL` on Mobile | Encrypted resumable transfer, rendering, open/download, recovery foundations exist | Current-source product proof and complete Mobile lifecycle are absent |
| Recorded voice message | `PARTIAL` on Desktop; `MISSING` on Mobile | Desktop records WebM, stages it as encrypted audio attachment, and plays it inline | Duration is discarded before persistence; no progress/seek/retry contract; no Mobile recorder/player; no Gate |
| Group lifecycle | `PARTIAL` | Conversation create and MLS add/remove/send paths exist | Rename/roles/owner/dissolve still use legacy Group routes; leave is incomplete; readiness is projected too early |
| Live one-to-one voice/video | `PARTIAL` on Desktop; `MISSING` on Mobile | Desktop WebRTC manager, sealed signaling, audio/video call surface, camera controls, and TURN discovery exist | Calls require unrelated P2P-connected state; no native audio/video call proof; Mobile explicitly defers calls |
| Cross-Station/multi-device/recovery | `PARTIAL` | Substantial Station/Desktop paths and historical proof exist | Current-source matrix, Mobile, and complete cross-Station product proof are absent |

Current product result: **0/11 required Chat capabilities are current-source
product-proven**.

## 3. Evidence Integrity Findings

1. Repository-local Native PASS reports are bound to older commits such as
   `5ed85551`, `b4207062`, `638679c0`, `13d867e8`, and `ef89b11`, not the
   audited HEAD.
2. `tooling/acceptance/reports/chat-native-interactions-run.json` is an explicit
   failure: the local authority head is behind the interaction plan.
3. `docs/architecture/acceptance-framework/coverage-report.md` reports only
   1/11 Chat features complete and 0/9 Mobile features complete.
4. The friend-request Gate proves a gateway/API lifecycle, not Native find,
   request, accept, conversation open, and first-message UI.
5. Mobile native Chat scenarios are registered but six dispatch paths remain
   unimplemented. They now emit typed `BLOCKED/PARTIAL/UNPROVEN` evidence
   instead of crashing during report construction; fake-memory tests still do
   not prove the product.
6. Existing attachment evidence does not exercise microphone capture, recorded
   voice transfer, playback, or live calls.

## 4. Safety Baseline

- Production Station and Mobile source contains no hard-coded collector URL or
  temporary debug-point block under the audited Chat safety scope.
- Mobile `social.people.search` accepts only a query and projects
  `federationId` from the observed production search result. Desktop
  `federationContext` continues to project the Federation list returned by the
  production API.
- Every registered Mobile native scenario has traceability metadata and can
  emit typed blocked evidence while its physical implementation is absent.
- Formal Gate `chat-lifecycle-safety-e2e` is the source-bound proof owner for
  this baseline.

This closes the safety baseline only. It does not promote any product
capability in section 2.

## 5. Historical Evidence Disposition

Historical Direct, Group MLS, typing, attachment, multi-device, recovery, and
cross-Station runs demonstrate that portions of the architecture are feasible.
They are retained as regression references only. The new plan starts every
capability at its audited current status and requires a fresh exact-source
result before promotion to `PROVEN`.
