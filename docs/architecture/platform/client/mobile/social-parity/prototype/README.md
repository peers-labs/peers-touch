# Mobile Social Desktop Parity - Prototype

> **Status**: confirmed
> **Version**: v1.0
> **Created**: 2026-10-06 | **Updated**: 2026-10-08
> **Owner**: Mobile Product / Social Product
> **Module**: `packages/prototypes/mobile/chat/`

---

## Prototype Location

`packages/prototypes/mobile/chat/`

This design amends the existing Mobile Shell prototype instead of creating a second shell.

## Landing Target

- `apps/mobile/src/pages/MomentsPage.tsx`
- `apps/mobile/src/pages/moments/`
- Mobile navigation descriptors and Social experience facade

The prototype is a React/Vite interaction reference only. Production remains Tauri Mobile Web + Rust.

Message presentation follows `docs/client/mobile/chat-layout-contract.md §14`:
avatar/content top alignment, owner-side transparent overflow, a shared
40-emoji catalog, and compact icon commands with accessible names. Station
entry uses one brand mark and one title. Account Info uses image previews,
without raw asset-address fields. Native product evidence remains owned by
the mounted whole-product usability Journey.

The Auth entry states are governed by
[`auth-entry-interaction-contract.yaml`](./auth-entry-interaction-contract.yaml).

## Run

```bash
make run-prototype
```

Open the Prototype Portal, choose `mobile`, then `Mobile Shell`.

## Design Coverage

The amendment traces to:

- `MSP-C01..MSP-C12`
- `MSP-J01..MSP-J10`
- `MPS-D01`, `MPS-D05`, `MPS-D06`, `MPS-D10`, `MPS-D12`

It covers:

- Home/Explore scope navigation;
- up to 10 comments visible per Moment by default, folded overflow, one on-demand composer,
  and route-free image/video preview;
- Social Search, User Profile and Circles full-screen routes;
- full Audience composer and full-screen target selection;
- Circle create/rename/delete/member management and Profile Block;
- text/image/video/link/poll/repost/location rendering with capability-gated creation;
- public/private inline Comment/reply and Reaction;
- remote pending/retrying/source-unavailable;
- recovery-required, integrity failure and deleted/revoked;
- stable Feed, overlay and true-route geometry.

## Ledger Status

`confirmed`

The Owner confirmed this Social parity UI and interaction amendment on 2026-10-06. It may be used as
the implementation reference; Native, Station, crypto, lifecycle and cross-platform proof remain separate.

## Evidence Requirements

- L1: state branches, token roles, route/sheet boundaries and capability traceability.
- L2: thin Home/Explore segment, default/folded Comment density, image/video overlay, Composer Audience,
  Search/Profile/Circles, pending, recovery, error and revoked states at 390x844 and 1440x1100;
  light theme is the current prototype scope.
- L3: exact segment dimensions, 10/comment default cap, overflow folding, media close/anchor restoration,
  composer/Audience flow, publish-in-Feed, retry/recovery and revocation interactions; no layout shift
  over 2px in same-boundary state switches.

## 2026-10-06 Evidence

The Portal ran at `http://localhost:3200/` from branch `feat/mobile-social-parity`.

| Layer | State                                      | Viewport           | Evidence                                                                                                                |
| ----- | ------------------------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| L2    | Home and Explore                           | 390x844, 1440x1100 | `evidence-l2/{390,1440}-social-parity.png`, `evidence-l2/390-explore.png`                                               |
| L2    | default 10 comments, overflow and composer | 390x844, 1440x1100 | `evidence-l2/{390,1440}-{comments-default-10,comments-expanded,comment-composer}.png`                                   |
| L2    | publish-in-Feed                            | 390x844            | `evidence-l2/390-published-feed.png`                                                                                    |
| L2    | image/video temporary overlays             | 390x844, 1440x1100 | `evidence-l2/{390,1440}-{image-overlay,video-overlay}.png`                                                              |
| L2    | Search, Profile and Block                  | 390x844            | `evidence-l2/390-{search,profile,profile-block-confirm,profile-blocked}.png`                                            |
| L2    | Circles CRUD/member surfaces               | 390x844            | `evidence-l2/390-{circles,circle-detail,circle-member-picker}.png`                                                      |
| L2    | Composer, full Audience and target picker  | 390x844            | `evidence-l2/390-{composer,audience,audience-target}.png`                                                               |
| L2    | seven canonical content kinds              | 390x844, 1440x1100 | `evidence-l2/{390,1440}-content-types-{primary,secondary,tertiary}.png`                                                 |
| L2    | remote delivery pending                    | 390x844, 1440x1100 | `evidence-l2/{390,1440}-social-private-pending.png`                                                                     |
| L2    | recovery required                          | 390x844, 1440x1100 | `evidence-l2/{390,1440}-social-recovery-required.png`                                                                   |
| L2    | source unavailable                         | 390x844, 1440x1100 | `evidence-l2/{390,1440}-social-source-unavailable.png`                                                                  |
| L2    | deleted/revoked                            | 390x844, 1440x1100 | `evidence-l2/{390,1440}-social-revoked.png`                                                                             |
| L3    | density and continuity                     | 390x844, 1440x1100 | 6 assertions prove 36px segment, 32px tab buttons, 10/12 comment folding, route-free media and exact anchor restoration |

`evidence-l2/captures.json` records 35 captures, 6 density/continuity assertions, zero geometry,
horizontal-overflow, unexpected text-clipping, continuity or console defects. The screenshots above were
opened and visually inspected. Recovery-required and revoked states expose no prior private plaintext;
source-unavailable retains verified content but disables new interaction. Playwright proves comments,
image/video preview, publish readback and private recovery states retain one Feed page tree and the Bottom
Tab, while true full-screen routes remain selected-only.

## 2026-10-07 Composer Amendment Evidence

The Portal ran at `http://localhost:3200/` from branch
`feat/mobile-social-parity-implementation`.

This geometry was superseded by the 2026-10-09 Owner correction below.

| Layer | State                                    | Viewport                    | Evidence                                                                                                        |
| ----- | ---------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| L2    | bottom-anchored dominant composer        | 390x844, 1440x1100          | `evidence-l2/{390,1440}-composer.png`                                                                           |
| L2    | compact Audience and publish controls    | 390x844, 1440x1100          | `evidence-l2/{390,1440}-composer.png`                                                                           |
| L3    | geometry and surrounding-flow regression | 390x844, 554x954, 1440x1100 | `packages/prototypes/mobile/chat/scripts/check-layout.mjs`, `check-residual-parity.mjs`, `check-long-lists.mjs` |

The updated composer uses a 310-322px text input, 42px Audience row, 44px
header, 32px publish action, and a 62px bottom-navigation clearance with zero
gap between the sheet and tabbar. `check-layout.mjs` produced 54 captures with
zero defects; residual parity passed 40 assertions and long-list checks passed
at all three viewports. The 390px and 1440px screenshots were opened and
visually inspected. This is prototype evidence only; the matching production
geometry is enforced by the Android RC02 Native Gate and remains unproven until
the exact-source OPPO run completes.

## 2026-10-09 Avatar And Composer Density Correction

> Historical evidence only. The short-lived 2026-10-12 circular-person
> interaction baseline was reverted on 2026-10-13; every actor identity again
> follows one rounded-square avatar rule (`max(8px, floor(size * 0.25))`),
> never circular. The canonical production contract is `MobileAvatar` plus
> `docs/knowledge/invariants/mobile-user-identity-visual-consistency.md`.

Owner review identified two prototype defects:

- Social people used ad hoc multi-letter `antd` Avatar fallbacks instead of the
  shared rounded-square user avatar contract.
- The fixed 610px Composer left excessive empty height between short text and
  the selected photo.

The Social prototype now uses one `UserSquareAvatar` presentation primitive:
single-letter fallback, full-bleed source/fallback surface, and a component-owned
radius of `max(8px, floor(size * 0.25))`. The Composer is 380-400px tall with a
96-120px text region and a measured 4-12px layout gap between the textarea box
and media slot. Opening the Composer shows an explicit add-image slot; an image
preview appears only after that control is activated.

| Layer | State                                             | Viewport                    | Evidence                                                   |
| ----- | ------------------------------------------------- | --------------------------- | ---------------------------------------------------------- |
| L2    | rounded-square Moment avatar and compact Composer | 390x844                     | `evidence-l2/390-composer-avatar-spacing-20261009.png`     |
| L2    | rounded-square Moment avatar and compact Composer | 1440x1100                   | `evidence-l2/1440-composer-avatar-spacing-20261009.png`    |
| L3    | Composer geometry and surrounding-flow regression | 390x844, 554x954, 1440x1100 | `packages/prototypes/mobile/chat/scripts/check-layout.mjs` |

`check-layout.mjs` produced 120 captures with zero geometry, overflow, overlap,
touch-target, recovery, or console defects. It asserts rounded-square avatar
geometry for every rendered Social identity, one-character fallback, 10px
comment input/send radius, the initial add-image slot, and post-selection
preview. Both Composer screenshots above were opened and visually inspected.
Native Android proof remains separate.

## 2026-10-08 Auth Entry Evidence

`check-layout.mjs` now captures normal and expired-session Auth in both Quick
Login and Email Login states at 390x844, 554x954, and 1440x1100. It rejects any
inactive login panel that still contributes layout geometry.

The run produced 66 captures with zero geometry, overflow, overlap, recovery,
raw-address, or inactive-panel defects. The four 390px Auth screenshots and the
1440px Email screenshot were opened and visually inspected. Quick Login remains
compact; Email Login exposes one wider secondary Station action and one clear
primary Sign In action without clipping. Production schema gates retain the
same primary action hierarchy through `AccessGateHost.test.ts`.

## Known Differences

- mock records and controlled state transitions do not call Station or Native commands;
- the prototype renders a bounded fixture; production feed/comment/picker virtualization remains Native evidence;
- Browser rendering does not prove safe area, keyboard, crypto, lifecycle or performance;
- dark theme is not claimed until implemented and captured;
- production iOS/Android evidence remains governed by `acceptance-matrix.md`.
