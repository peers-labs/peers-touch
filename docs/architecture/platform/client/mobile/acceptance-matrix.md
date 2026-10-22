# Mobile Shell - Product Acceptance Matrix

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-08-27 | **Updated**: 2026-10-16
> **Owner**: Mobile Product Team

---

## 1. Platform Rule

Mobile is one product with Android and iOS release targets.

Every Mobile claim binds to:

```text
capability x release target x runtime mode x source revision
```

`Android + iOS` means separate source-bound cells, not one shared run. An
unregistered, missing, failed, or stale required cell is `UNPROVEN`.

## 2. Product Acceptance

| ID | Journey | User-visible result | Durable/readback proof | Required platform |
|---|---|---|---|---|
| MS-PA01 | MS-J01 | Add/select a reachable Station; current access gate appears | Station registry and access decision | Android + iOS |
| MS-PA02 | MS-J01 | Complete Email login; Shell appears only after access grant | Station session and grant | Android + iOS |
| MS-PA03 | MS-J01 | Complete OAuth callback/finalization and return to the same Station gate chain | Station attempt/finalizer and secure-session metadata; no token in Web state | Android + iOS; physical cells for live providers |
| MS-PA04 | MS-J02 | Restart with a valid session without leaking another actor's data | Secure session and actor-scoped projection | Android + iOS |
| MS-PA05 | MS-J02 | Resume with a revoked session; login gate appears and stale data clears | Station rejection and local-session absence | Android + iOS |
| MS-PA06 | MS-J03 | Send Direct/Group messages; receiver gets content and monotonic receipts | Conversation/message readback | two isolated Android clients + two isolated iOS clients |
| MS-PA07 | MS-J03 | Reply, edit, recall, react, pin, forward, and thread actions survive reload | Station event/history readback | Android + iOS |
| MS-PA08 | MS-J03 | Network loss during write produces retryable or unknown outcome without duplicate commit | Idempotency and result readback | Android + iOS |
| MS-PA09 | MS-J04 | Accept friend request, inspect profile, start Direct chat | Relationship and conversation readback | two isolated Android clients + two isolated iOS clients |
| MS-PA10 | MS-J04 | Create group and manage members by role | Conversation member/ownership readback | Android + iOS |
| MS-PA11 | MS-J05 | Read, paginate, publish, react, comment, and reply in Moments | Post/comment/reaction readback | Android + iOS |
| MS-PA12 | MS-J06 | Edit profile/privacy or device preference and reopen | Owner-specific or device-local readback | Android + iOS |
| MS-PA13 | MS-J06 | Change Station; old projections disappear before the new gate | Old scoped state absent | Android + iOS |
| MS-PA14 | MS-J02..06 | Background/resume reconciles stale state before writes reopen | Cursor/reconcile evidence | physical Android + physical iOS |
| MS-PA15 | MS-J03..05 | Long lists and rapid navigation stay within interaction budgets | Interaction-linked timing and bounded render | pinned physical Android + iOS |
| MS-PA16 | MS-J01, MS-J06 | Remove or replace a Station without altering unrelated scopes | Registry and scope readback | Android + iOS |
| MS-PA17 | MS-J01 | Complete or recover invite/device/terms/custom access gates | Access decision and audit | Android + iOS |
| MS-PA18 | MS-J03 | Attachment, typing, search, delete, and settings show truthful progress/recovery | Message/settings/event readback | Android + iOS |
| MS-PA19 | MS-J04 | Request and group actions handle duplicate, missing-result, and role-denied states | Relationship/group readback | Android + iOS |
| MS-PA20 | MS-J05 | Feed distinguishes empty, filtered, hidden, unavailable, and rejected actions | Feed/policy readback and rollback | Android + iOS |
| MS-PA21 | MS-J06 | Settings preserve Profile, Notification, Social, and device ownership | Owner-specific and device-local readback | Android + iOS |
| MS-PA22 | MS-J07 | Device-local message flag does not appear on another device | Local readback and peer absence | Android + iOS |
| MS-PA23 | MS-J03, MS-J05, MS-J07 | Drafts survive unmount, background, failure, and restart until publish/discard | Encrypted local draft readback | Android + iOS |
| MS-PA24 | MS-J01..07 | Primary journeys work with screen reader, large text, reduced motion, long locale, and restored focus | Accessibility tree, focus trace, screenshots | physical Android + iOS |
| MS-PA25 | MS-J01, MS-J07 | Trust mismatch, incompatibility, OAuth replay/expiry, and revocation fail closed | Handshake/access/session evidence | Android + iOS |
| MS-PA26 | MS-J07 | Admission/data overflow keeps reads available and explains blocked writes | Queue/admission/reconcile counters | Android + iOS |
| MS-PA27 | MS-J01, MS-J03, MS-J07 | Unsupported capabilities are absent or explain why unavailable | Surface inventory and interaction evidence | Android + iOS |
| MS-PA28 | MS-J08 | Every registered surface is operable with coherent hierarchy and valid next action | Route/state manifest, screenshots, DOM/accessibility, interaction trace | Android + iOS |
| MS-PA29 | MS-J08 | No raw identifiers, untranslated copy, clipping, overlap, occlusion, or blocking module notices | Automated assertions and reviewed screenshots | Android + iOS |
| MS-PA30 | MS-J03 | Direct audio/video covers ring, answer/reject/no-answer, active media, reconnect, hangup, and cleanup | Signaling, routing, receiver media, and zero leaked resources | physical Android pair + physical iOS pair; same/cross-Station |
| MS-PA31 | MS-J03, MS-J07 | Desktop and Mobile share one call identity; first terminal action wins | Realtime resolution readback | Desktop + Android and Desktop + iOS |

## 3. Architecture Gates

| Gate | Required cells | Pass contract | Current registration state |
|---|---|---|---|
| MS-AG01 Static/contracts | shared source | `pnpm mobile:check`; generated contracts and ownership scans pass | registered |
| MS-AG02 Lifecycle/isolation | Android + iOS | restore, revocation, Station switch, logout, monotonic generation, zero old-scope reads | iOS simulator Gates exist; Android Gate required and `UNPROVEN` |
| MS-AG03 OAuth security | Android + iOS; physical for live-provider claim | callback/finalizer binding, replay/mismatch rejection, secret absence, secure session | deterministic iOS Gate exists; Android and physical provider cells `UNPROVEN` |
| MS-AG04 Unknown outcome | Android + iOS | one Station commit; converged or visibly unresolved result after restart | iOS Gate exists; Android `UNPROVEN` |
| MS-AG05 Resume/teardown | physical Android + iOS | no cross-generation data; writes wait for reconcile; resources return to baseline | required physical matrix `UNPROVEN` |
| MS-AG06 Projection freshness | Android + iOS | receiver convergence and authoritative readback | iOS scenario Gates exist; Android `UNPROVEN` |
| MS-AG07 Interaction performance | pinned physical Android + iOS | declared P95/P99 budgets and attribution; no unbounded main-thread work | required physical matrix `UNPROVEN` |
| MS-AG08 Layout | Android emulator/device + iOS simulator/device | smallest/largest viewport, keyboard, orientation, safe area, no clipping/overlap | iOS layout Gate exists; Android `UNPROVEN` |
| MS-AG09 Admission/overload | Android + iOS | bounded queues, fairness, typed overflow, no silent loss or duplicate | iOS Gate exists; Android `UNPROVEN` |
| MS-AG10 Payload/storage | Android + iOS | payload bounds, atomic recovery, encrypted/no-secret disk scan | iOS Gate exists; Android `UNPROVEN` |
| MS-AG11 Accessibility/i18n | physical Android + iOS | TalkBack/VoiceOver order and labels, focus, text size, locale, reduced motion | required physical matrix `UNPROVEN` |
| MS-AG12 Whole-product usability | Android + iOS | full shared inventory visited; zero blocker/major usability defects | iOS Gate exists; Android `UNPROVEN` |
| MS-AG13 One-to-one call lifecycle | physical Android pair + physical iOS pair | audio/video ring through cleanup; Chat remains usable | required Mobile-native Gates `UNPROVEN` |
| MS-AG14 Cross-device call resolution | Desktop + Android; Desktop + iOS | dual ring, first-action-wins, loser cleanup, reconnect/restart | iOS mixed Gate exists; Android mixed cell `UNPROVEN` |

Current iOS Gates remain valid only for their declared cells. They do not
produce a whole-Mobile readiness verdict.

## 4. Product-To-Gate Mapping

| Product acceptance | Architecture gates |
|---|---|
| MS-PA01, MS-PA02, MS-PA04, MS-PA05 | MS-AG01, MS-AG02, MS-AG05 |
| MS-PA03 | MS-AG01, MS-AG03 |
| MS-PA06, MS-PA07, MS-PA08 | MS-AG01, MS-AG04, MS-AG06, MS-AG09, MS-AG10 |
| MS-PA09..MS-PA12 | MS-AG01, MS-AG06, MS-AG09, MS-AG10 |
| MS-PA13, MS-PA14 | MS-AG02, MS-AG05, MS-AG06 |
| MS-PA15 | MS-AG07, MS-AG08 |
| MS-PA16, MS-PA17, MS-PA25 | MS-AG02, MS-AG03, MS-AG05, MS-AG08 |
| MS-PA18..MS-PA21 | MS-AG04, MS-AG06, MS-AG08, MS-AG09, MS-AG10 |
| MS-PA22, MS-PA23, MS-PA26 | MS-AG04, MS-AG05, MS-AG09, MS-AG10 |
| MS-PA24, MS-PA27 | MS-AG08, MS-AG11 |
| MS-PA28, MS-PA29 | MS-AG08, MS-AG11, MS-AG12 |
| MS-PA30 | MS-AG08, MS-AG11, MS-AG13 |
| MS-PA31 | MS-AG14 |

## 5. Failure Rules

- Missing required platform evidence is `UNPROVEN`.
- Screenshots prove visible state only; durable claims require owner readback.
- Single-client evidence cannot prove delivery or receiver convergence.
- Simulator/emulator evidence cannot prove hardware/provider behavior it does
  not execute.
- Mocks and injected success are forbidden in product acceptance.
- Same-Station evidence cannot be promoted to cross-Station or Relay scope.
- Shared-core tests cannot be promoted to Android or iOS host proof.
