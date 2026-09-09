# Mobile Shell — 产品验收矩阵

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-27 | **Updated**: 2026-08-29
> **Owner**: Mobile Product Team

---

| ID | Journey | User action and visible result | Durable/readback proof | Required cell |
|---|---|---|---|---|
| MS-PA01 | MS-J01 | Add and select a reachable Station; current access gate appears | Station registry plus access decision | iOS simulator and Android emulator |
| MS-PA02 | MS-J01 | Complete Email login; Shell appears only after access grant | Station session and access grant | iOS + Android |
| MS-PA03 | MS-J01 | Complete GitHub/Google OAuth; callback returns to the same Station and enters the gate chain | Station session, provider callback, and secure-session metadata readback without exposing token material | iOS + Android |
| MS-PA04 | MS-J02 | Restart with a valid session; Shell restores without showing another actor's data | Secure session plus actor-scoped projection | cold restart |
| MS-PA05 | MS-J02 | Open with revoked session; login gate appears and stale projections are cleared | Station rejects session; local session absent | revoke + resume |
| MS-PA06 | MS-J03 | Send friend and group messages; peer receives content and receipts progress monotonically | Station conversation/message readback | two actors, two devices |
| MS-PA07 | MS-J03 | Reply, edit, recall, react, pin, forward, and open a thread; each committed action survives reload | Station event/history readback; local-only flag explicitly excluded | two actors |
| MS-PA08 | MS-J03 | Lose network during a write; UI shows retryable or unknown outcome without duplicate commit | Idempotency/readback evidence | disconnect/reconnect |
| MS-PA09 | MS-J04 | Accept a friend request, inspect profile, and start chat | Station relationship and conversation readback | two actors |
| MS-PA10 | MS-J04 | Create a group and manage members according to role | Station group/member/ownership readback | owner/admin/member |
| MS-PA11 | MS-J05 | Read, paginate, publish, react, comment, and reply in Moments | Station post/comment/reaction readback | two actors |
| MS-PA12 | MS-J06 | Edit profile/preferences and reopen the app | Station profile/account preference plus local device preference readback | restart |
| MS-PA13 | MS-J06 | Change Station; prior session projections disappear before the new gate renders | Old actor-scoped cache/session absent | two Stations |
| MS-PA14 | MS-J02..06 | Background then resume; stale state is reconciled before mutation controls re-enable | Cursor/reconcile evidence | native background/resume |
| MS-PA15 | MS-J03..05 | Use long lists and rapid tab switching; visible feedback remains within runtime budget | Interaction-linked timing and no unbounded render | populated native runtime |
| MS-PA16 | MS-J01, MS-J06 | Remove a saved Station or explicitly replace an identity-mismatched Station | Registry readback; unrelated Station sessions/caches unchanged | two Stations |
| MS-PA17 | MS-J01 | Complete invite/device/terms/custom schema-driven gates or observe pending/blocked recovery | Station access decision and audit readback | iOS + Android |
| MS-PA18 | MS-J03 | Upload attachment, observe typing, search, delete, and change conversation settings with truthful progress/recovery | Station message/settings/event readback | two actors, two devices |
| MS-PA19 | MS-J04 | Send/reject requests and handle duplicate, no-result, remote-unavailable, and role-denied states | Station relationship/group readback | two actors, two Stations |
| MS-PA20 | MS-J05 | Distinguish empty/filtered/policy-hidden/unavailable feed and recover rejected publish/reaction/comment | Station feed/policy readback and rollback evidence | two actors, two Stations |
| MS-PA21 | MS-J06 | Change language, notification, privacy, storage, and blocked-user settings; resolve unsaved/conflict/permission states | Station account preference plus device-local readback | restart + second device |
| MS-PA22 | MS-J07 | Flag a message locally; another device does not show the flag and UI names the device-only scope | Device-local readback plus peer-device absence | two devices |
| MS-PA23 | MS-J03, MS-J05, MS-J07 | Chat/Moments drafts survive tab/detail unmount, background, failure, and process restart until publish/discard | Encrypted device draft readback | restart + background |
| MS-PA24 | MS-J01..07 | Complete primary journeys with screen reader, maximum supported text size, reduced motion, long locale, and restored focus | Accessibility tree, focus trace, screenshots | iOS + Android |
| MS-PA25 | MS-J01, MS-J07 | Station peer mismatch, capability incompatibility, OAuth expiry/replay, and session revocation show blocking trust state and recovery | Signed handshake/access/session evidence | iOS + Android |
| MS-PA26 | MS-J07 | Fill command capacity or overflow data events; reads remain available and writes explain why they are blocked | Queue/admission/reconcile counters | native stress cell |
| MS-PA27 | MS-J01, MS-J03, MS-J07 | WeChat/call/Docs entries are absent or disabled with a useful reason; local-only capability is not advertised as shared | Surface inventory and interaction evidence | iOS + Android |

## Architecture Gates

All commands run from the repository root.
`tooling/acceptance/plans/mobile-shell.json` is created by execution-plan W0
before runtime gates run.

| Gate | Command | Runtime cell and sample policy | Pass threshold | Evidence |
|---|---|---|---|---|
| MS-AG01 Static/contracts | `pnpm mobile:check`, `pnpm --dir apps/mobile run check:mobile-shell-contracts`, and `./tooling/scripts/proto-gen-mobile.sh` | CI; one clean run | exit 0; PTID/manual-domain scans have zero violations | Evidence Store `ArtifactRef`s from the selected static Gates |
| MS-AG02 Lifecycle/isolation | `python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-runtime-lifecycle-e2e`; `python3 tooling/scripts/acceptance-run.py --gate mobile-simulator-station-lifecycle-e2e`; full physical cell remains in the Mobile bundle | iOS simulator + Android emulator for runtime-graph lifecycle; two disposable Stations plus both simulator clients for session restore/revocation and Station switching; physical devices for OS lifecycle | local graph order, valid restore, same-device-type revocation, 10 Station switches, logout, monotonic generation, and zero old-scope reads pass; physical background/foreground and secure-delete behavior remain separate | Evidence Store latest for both simulator lifecycle Gates plus `mobile-native-lifecycle-e2e` for the remaining physical scope |
| MS-AG03 OAuth security | same Acceptance command | iOS + Android physical device; GitHub/Google success, following-gate, cancel, expiry, replay, provider/Station mismatch | valid flows preserve access-attempt binding; session activates only after final grant; replay/mismatch fails closed | Evidence Store latest for `mobile-native-access-e2e`, including Mobile and Station proof `ArtifactRef`s |
| MS-AG04 Unknown outcome | same Acceptance command | two actors/two devices; disconnect at pre-dispatch, post-dispatch, post-commit; 10 trials each plus cold restart | exactly one Station commit; every command converges or remains visibly unresolved after restart | Evidence Store latest for `mobile-native-recovery-e2e` |
| MS-AG05 Resume/teardown | same Acceptance command | iOS + Android physical device; 20 background/resume, 10 Station/actor switches, unreachable Station during logout, secure-delete failure | no cross-generation data; writes wait for reconcile; secure-delete failure blocks; remote-revoke failure yields local completion + unconfirmed audit; resources return to baseline | Evidence Store latest for `mobile-native-lifecycle-e2e` and cleanup roles |
| MS-AG06 Projection freshness | same Acceptance command | two actors/two devices; event path and forced event-loss reconcile path per required domain | realtime convergence <= 5 s; forced reconcile convergence <= 30 s; Station readback matches both clients | Evidence Store latest for `mobile-native-social-convergence-e2e` |
| MS-AG07 Interaction performance | same Acceptance command | release profile on plan-pinned lower/current-tier iOS + Android physical devices with exact model/OS recorded; 100 conversations, 200 messages/thread, 100 Moments, 500 contacts; 5 warmups + 30 runs/route | P50/P95/P99 reported; P95 <= 100 ms; P99 <= 150 ms; zero unwaived main-thread task > 50 ms | Evidence Store timing and attribution `ArtifactRef`s |
| MS-AG08 Layout | same Acceptance command | smallest/largest supported viewport, keyboard open/closed, portrait/landscape | no overlap/clipping; one safe-area/keyboard occlusion model | Evidence Store screenshot, DOM and AX `ArtifactRef`s |
| MS-AG09 Admission/overload | same Acceptance command | 50 intents/5 s across 8 ordering keys; Station delay 10 s; fill ledger limits; flood 2,000 data events plus revocation | command bounds/fairness hold; overflow is typed; data overflow reconciles; revocation closes writes; zero silent drop/duplicate | Evidence Store admission and reconcile `ArtifactRef`s |
| MS-AG10 Payload/storage | same Acceptance command | payload at 256 KiB and +1 byte; media at Station-advertised maximum and +1 byte; process kill during ledger/draft transition | boundaries hold; media bytes stay external; command/draft stores recover atomically; disk scan finds no token, secret, or plaintext content | Evidence Store payload, recovery and redaction `ArtifactRef`s |
| MS-AG11 Accessibility/i18n | same Acceptance command | VoiceOver + TalkBack; maximum supported text size; reduced motion; longest supported locale; keyboard/focus traversal | semantic order and labels complete; focus restored; no clipped/overlapping text; motion preference honored | Evidence Store accessibility tree, focus trace and screenshot `ArtifactRef`s |

Missing native evidence remains `UNPROVEN`.
MS-AG07 records the pre-cutover baseline on the same pinned devices and workload;
the absolute thresholds remain authoritative and the baseline delta is reported.

## Product-To-Architecture Mapping

| Product acceptance | Architecture gates |
|---|---|
| MS-PA01, MS-PA02, MS-PA04, MS-PA05 | MS-AG01, MS-AG02, MS-AG05 |
| MS-PA03 | MS-AG01, MS-AG03 |
| MS-PA06, MS-PA07, MS-PA08 | MS-AG01, MS-AG04, MS-AG06, MS-AG09, MS-AG10 |
| MS-PA09, MS-PA10, MS-PA11, MS-PA12 | MS-AG01, MS-AG06, MS-AG09, MS-AG10 |
| MS-PA13, MS-PA14 | MS-AG02, MS-AG05, MS-AG06 |
| MS-PA15 | MS-AG07, MS-AG08 |
| MS-PA16, MS-PA17, MS-PA25 | MS-AG02, MS-AG03, MS-AG05, MS-AG08 |
| MS-PA18, MS-PA19, MS-PA20, MS-PA21 | MS-AG04, MS-AG06, MS-AG08, MS-AG09, MS-AG10 |
| MS-PA22, MS-PA23, MS-PA26 | MS-AG04, MS-AG05, MS-AG09, MS-AG10 |
| MS-PA24, MS-PA27 | MS-AG08, MS-AG11 |

## Capability Traceability

| Capability | Journey | Product acceptance | Prototype surface |
|---|---|---|---|
| MS-C01 | MS-J01, MS-J06 | MS-PA01, MS-PA16, MS-PA25 | Launch/Station selector + trust recovery |
| MS-C02 | MS-J01, MS-J02 | MS-PA02, MS-PA04, MS-PA05, MS-PA17 | Access Gate states |
| MS-C03 | MS-J01 | MS-PA03, MS-PA25 | OAuth progress/recovery |
| MS-C04 | MS-J03..06 | MS-PA15, MS-PA24 | Shell tabs + detail routes |
| MS-C05 | MS-J03 | MS-PA06, MS-PA18, MS-PA23 | Chat list/thread/composer/settings |
| MS-C06 | MS-J03, MS-J07 | MS-PA07, MS-PA08 | Message actions/forward/thread/uncertain write |
| MS-C07 | MS-J04 | MS-PA09, MS-PA10, MS-PA19 | Contacts/profile/group flows |
| MS-C08 | MS-J05, MS-J07 | MS-PA11, MS-PA20, MS-PA23 | Moments feed/composer/recovery |
| MS-C09 | MS-J06 | MS-PA12, MS-PA21, MS-PA24 | Me/settings/details |
| MS-C10 | MS-J02, MS-J07 | MS-PA04, MS-PA05, MS-PA08, MS-PA13, MS-PA14, MS-PA25, MS-PA26 | Runtime recovery scenarios |
| MS-C11 | MS-J01 | MS-PA27 | Disabled/absent WeChat OAuth entry |
| MS-C12, MS-C13 | MS-J03 | MS-PA27 | Disabled/absent call and Docs entries |
| MS-C14 | MS-J07 | MS-PA22, MS-PA27 | Device-only message flag |

## Architecture Requirement Traceability

| Product acceptance | Architecture requirements |
|---|---|
| MS-PA01, MS-PA16, MS-PA25 | MS-P07 signed Station identity/capability handshake |
| MS-PA02, MS-PA04, MS-PA05, MS-PA17 | MS-P01 PTID-only session identity; Access Gate chain |
| MS-PA03, MS-PA25 | MS-P02 OAuth attempt; MS-P03 callback/status |
| MS-PA06..MS-PA11, MS-PA18..MS-PA20 | Existing generated domain Proto plus MS-P04 mutation outcome lookup where a write is durable |
| MS-PA12, MS-PA21 | MS-P05 account preferences |
| MS-PA08, MS-PA13, MS-PA14, MS-PA26 | MS-P06 durable command envelope and runtime generation fencing |
| MS-PA22 | Device-local typed flag projection; no shared business contract |
| MS-PA23 | MS-P08 device-local draft envelope |
| MS-PA24, MS-PA27 | UI Identity and component-tree contracts; no new business schema |

Execution-plan W0 must register the concrete Acceptance JSON and run:

```bash
pnpm mobile:check
pnpm --dir apps/mobile run check:mobile-shell-contracts
./tooling/scripts/proto-gen-mobile.sh
make acceptance PLAN=tooling/acceptance/plans/mobile-shell.json
```

`check:mobile-shell-contracts` is registered in `apps/mobile/package.json` and
must continue to fail on numeric/aliased actor identity outside generated
compatibility ingress, manual domain types outside the gateway, imports of
retired JSON adapters, invalid runtime dependency graphs/budgets, URL-keyed
session/command scopes, or a second durable-command persistence owner.

The Acceptance artifact must index every `MS-PAxx` row and its mapped
`MS-AGxx` evidence. Each runtime gate records lifecycle generation, Station/PTID
scope, command ID, queue depth, active worker/listener/timer counts, transition
timestamps, and typed error codes without secrets or PII. A missing row, native
cell, Station readback, percentile, attribution metric, or artifact path is
`UNPROVEN`.

## Failure Requirements

- Missing native evidence is `UNPROVEN`, never passed by browser prototype proof.
- Screenshots prove visible layout only; persisted claims require Station readback.
- Single-actor tests cannot prove delivery, receipts, friend requests, reactions,
  comments, group membership, or cross-device convergence.
- Mock APIs are forbidden in production acceptance.
