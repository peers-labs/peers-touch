# Mobile Social Desktop Parity - Acceptance Matrix

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-06 | **Updated**: 2026-10-06
> **Owner**: Mobile Product / Social Product

---

## 1. Claim Boundary

The only full readiness claim is:

```text
SOCIAL_MOBILE_DESKTOP_PARITY_PROVEN
```

It requires every runtime cell and assertion below. Source scans, unit tests, prototype screenshots,
generated Proto, same-Station-only evidence, or a single mobile OS cannot establish this claim.

## 2. Required Runtime Cells

| Cell | Runtime | Claim |
|---|---|---|
| `MPS-RC01` | Alice/Bob/Eve on two isolated iOS Simulators + real Station/OSS | iOS same-Station full Social |
| `MPS-RC02` | Alice/Bob/Eve on the current USB-authorized physical Android device + real Station/OSS | Android same-Station full Social |
| `MPS-RC03` | Desktop Alice on Station A -> iOS Bob on Station B | Desktop-to-iOS cross-Station |
| `MPS-RC04` | iOS Alice on Station A -> Desktop Bob on Station B | iOS-to-Desktop cross-Station |
| `MPS-RC05` | Desktop Alice on Station A -> physical Android Bob on Station B | Desktop-to-Android cross-Station |
| `MPS-RC06` | physical Android Alice on Station A -> Desktop Bob on Station B | Android-to-Desktop cross-Station |
| `MPS-RC07` | iOS Alice on Station A <-> physical Android Bob on Station B | cross-mobile interoperation |
| `MPS-RC08` | Bob/Bob2 Native Mobile + restart/recovery/device revoke | trusted recovery |
| `MPS-RC09` | Alice/Bob/Eve/Anonymous direct HTTP/object probes | authorization and metadata minimization |
| `MPS-RC10` | two Stations + injected outage/duplicate/reorder/restart | retry, replay, invalidation convergence |

Android Emulator is prohibited for this Plan Run. Before Android execution,
record `adb devices -l`, the authorized serial, model, and Android version.
If no authorized physical device is available, `MPS-RC02`, `MPS-RC05`,
`MPS-RC06`, and `MPS-RC07` remain `BLOCKED/UNPROVEN`; the independent iOS,
security, recovery, and two-Station cells continue. Browser is not a runtime
cell.

## 3. Product Assertions

| ID | Journey | Action and visible result | Durable/readback proof | Cells |
|---|---|---|---|---|
| `MPS-PA01` | J01 | Home refresh/paginate keeps visible content and anchor | receiver timeline cursor/projection | RC01, RC02 |
| `MPS-PA02` | J01 | Explore sort/paginate expands one public thread in place without losing scope/anchor | public timeline/sort cursor | RC01, RC02 |
| `MPS-PA03` | J02 | Search local/remote actor, open Profile and authored posts | canonical PTID, profile and relationship readback | RC01, RC02 |
| `MPS-PA04` | J03 | Create/rename/delete Circle and add/remove local/remote member | Circle revision/member readback | RC01, RC02, RC10 |
| `MPS-PA05` | J04 | Publish text+image for each canonical Audience | source Post/Audience, no private plaintext in Station/OSS | RC01..RC07 |
| `MPS-PA06` | J04 | Invalid/oversized/unverifiable Audience preserves draft and commits nothing | no Post/PreKey partial consumption | RC09, RC10 |
| `MPS-PA07` | J05 | Authorized receiver reads text/media from Feed overlay and exception direct-link Detail | viewer envelope/object grant chain | RC01..RC07 |
| `MPS-PA08` | J05 | first 10 public/private comments show by default; overflow folds; reply/delete/pagination preserve Feed anchor and survive reload | canonical interaction readback | RC01..RC07 |
| `MPS-PA09` | J05 | five reactions/unreact converge after reject or lost response | command/result identity and reaction summary | RC01..RC07, RC10 |
| `MPS-PA10` | J06 | Bob2 recovers an unseen historical Moment; revoked device fails | actor recovery envelope and device revoke | RC08 |
| `MPS-PA11` | J07 | remote outage shows pending/retrying and creates one projection | outbox/inbox replay and dedupe readback | RC10 |
| `MPS-PA12` | J07 | remote Comment/Reaction unknown outcome reconciles without duplicate | source authority command status | RC10 |
| `MPS-PA13` | J08 | author delete, friend-loss, block or unblock converges Feed/exception Detail/comment/media/recovery | ordered mutation readback, invalidation and cache purge | RC03..RC10 |
| `MPS-PA14` | J09 | background/restart restores draft and verified projection | encrypted draft/private command readback | RC01, RC02 |
| `MPS-PA15` | J09 | Station/account switch exposes zero old-scope plaintext/key refs | teardown/generation/storage absence | RC01, RC02 |
| `MPS-PA16` | J10 | all six Desktop/iOS/Android directions produce equivalent outcomes | source and receiver readback chain | RC03..RC07 |
| `MPS-PA17` | negative | Eve/Anonymous with real IDs obtain no private data or metadata | uniform denial and response inspection | RC09 |
| `MPS-PA18` | quality | safe area, keyboard, long locale/text, screen reader, reduced motion and large lists remain usable | screenshot + AX + geometry + timing | RC01, RC02 |
| `MPS-PA19` | J04, J05 | text, image, video, link, poll, repost and location render with equivalent public/private semantics; create actions appear only for advertised canonical capability | canonical Post type/payload and capability snapshot; no fallback content kind | RC01..RC07 |

## 4. Architecture Gates

| Gate | Required evidence |
|---|---|
| `MPS-AG01` contracts | canonical Proto generation, no manual Social domain model, no legacy/private fallback |
| `MPS-AG02` ownership | one Mobile Social facade; Station authority; one Rust durable/private owner |
| `MPS-AG03` iOS native | source-bound iOS Simulator functional + Acceptance evidence |
| `MPS-AG04` Android native | source-bound USB physical Android functional + Acceptance evidence |
| `MPS-AG05` interop | Desktop/iOS/Android two-Station bidirectional matrix |
| `MPS-AG06` security | plaintext/key absence, IDOR corpus, actor/device/object binding |
| `MPS-AG07` recovery | restart, Bob2, revoke, unknown outcome and exact replay |
| `MPS-AG08` lifecycle | background/resume, Station/account switch and resource baseline cleanup |
| `MPS-AG09` UX | DOM/AX/screenshot evidence for inline comments, media overlay, default, pending, error, recovery, revoked and long-data states |
| `MPS-AG10` performance | declared workload; tap-to-visible P95 <= 100 ms, no unbounded mounted rows or unexplained >50 ms main-thread task |

## 5. Capability Traceability

| Capability | Journeys | Product assertions |
|---|---|---|
| `MSP-C01` navigation | J01, J02, J03, J05 | PA01..PA04, PA07 |
| `MSP-C02` Home feed | J01, J05, J10 | PA01, PA07, PA16 |
| `MSP-C03` Explore | J01, J05 | PA02, PA07 |
| `MSP-C04` Search/profile | J02, J08 | PA03, PA13 |
| `MSP-C05` Circles/audience | J03, J04 | PA04..PA06 |
| `MSP-C06` Composer/media/content kinds | J04, J05 | PA05, PA06, PA19 |
| `MSP-C07` Moment thread/comments | J05, J08 | PA07, PA08, PA13 |
| `MSP-C08` Reactions | J05, J07 | PA09, PA12, PA13 |
| `MSP-C09` Private trust/recovery | J04..J06, J08 | PA05, PA07, PA10, PA13, PA17 |
| `MSP-C10` Cross-Station | J01, J04, J07, J08, J10 | PA05, PA11..PA13, PA16 |
| `MSP-C11` Lifecycle/isolation | J04, J06, J07, J09 | PA10..PA15 |
| `MSP-C12` Native quality | J01, J09, J10 | PA16, PA18 |

## 6. Non-Claims

- Passing RC01 without RC02 is iOS-only.
- An unavailable physical Android device does not block independent iOS cells,
  but it forbids `SOCIAL_MOBILE_DESKTOP_PARITY_PROVEN`.
- Passing RC01/RC02 without RC03..RC07 is same-Station/mobile-only.
- Passing public Journeys does not prove private Social.
- Passing private publish/read does not prove Reaction, Circle, recovery or revocation.
- Prototype confirmation proves intended experience only.
