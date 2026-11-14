# Mobile North-Star Realignment — Execution Plan

> Created: 2026-11-09 · Status: **draft, awaiting acceptance**
> Architecture: [`../../README.md`](../../README.md) · Worktree: `peers-relay`
> (`pr170-combined`) · Target cell: iOS Simulator (Android scheduled separately)
>
> This plan is digest-bound after acceptance. It defines Slice 0 and Slice 1 in
> detail; later slices follow the same closure and are expanded at the start of
> each slice (not pre-frozen on guesses).

## 1. North star / completion criteria

iOS-cell program complete (delivery) only when:

1. `apps/mobile` presentation consumes `@peers-touch/ui` north-star; **zero**
   `antd`/`@lobehub/ui`/`--brand-*` residual in migrated surfaces, with the
   repository-wide count driven to zero by Slice 6.
2. Every functional point in [functional-coverage.md](../../functional-coverage.md)
   is REAL-RESTYLE / REAL-GAP-PRESENT-delivered, or explicitly removed
   (prototype corrected) / scheduled (NOT-THIS-PASS with a reason).
3. Prototype and real app implement three bottom destinations
   (messages/moments/me), with top chats/contacts subtabs inside messages;
   real capabilities preserved and fixture-only fakes removed.
4. iOS Simulator: required per-slice functional gates PASS on current source,
   and the full 162-surface whole-product gate passes at delivery (foreground +
   Station profile supplied).
5. Source gates green (`pnpm mobile:check`, vitest registry/contracts,
   presentation-free import guards, no-mock seam tests).
6. No regression to Rust/runtime/Station behavior (those paths are untouched
   and their existing gates stay green).

Not criteria: Android cell, dark mode, WebRTC on-device media matrix, new
product features (separately scheduled).

## 2. External prerequisites (human owner; gate, not source blocker)

- **E1** iOS **26.5** runtime + iPhone 17 / 17 Pro Max present
  (`xcrun simctl list runtimes | grep 'iOS 26.5'`); install via Xcode if
  missing (network, no paid account). Task 0.0 verifies before any gate run.
- **E2** one reviewed non-stable **remote** Station profile in sibling `env`
  for direct gates; two different profiles for station-lifecycle/settings.
- **E3** foreground Simulator for whole-product (`PT_MOBILE_FOREGROUND_REQUIRED=1`).

Source work and station-free gates proceed without E2/E3. Direct/whole-product
gates are parked with the exact missing prerequisite until supplied.

## 3. Per-slice closure (invariant)

Each task/slice closes in this order: real behavior preserved → peers-ui
presentation → adapter usage → fixture surface + inventory updated → prototype
reconciled → source checks → one exact-source iOS functional Journey → formal
gate(s) for that slice. Current-source evidence binds commit/workspace digest.

## 4. Slice 0 — Foundation

Goal: peers-ui renderable inside the real app with zero behavior change;
adapters and guards exist; iOS harness build proven.

| ID | Task | Outputs | Gate |
|---|---|---|---|
| 0.0 | Verify iOS 26.5 runtime; report E1 status | simulator readiness note | — |
| 0.1 | Add `@peers-touch/ui workspace:*`; `pnpm i`; wrap root in `UIProvider theme="light"` + north-star flat vars; add `mobile-northstar.css` skin (`--pt-m-*` geometry only, `.pt-ui` full size); replace lobehub `MobileThemeProvider` inner root while keeping light pin | provider wiring, skin | `pnpm --dir apps/mobile run build` |
| 0.2 | Instantiate one `createFeedbackChannel()` via `UIProvider feedback`; add thin typed wrappers (`confirm/confirmDestructive/notify*`); unit test queue/confirm | feedback singleton + wrappers | vitest unit |
| 0.3 | Bundle/compat audit: build size delta (exclude markdown/diagram chunks); enumerate dvh/`:has`/color-mix; decide iOS floor vs fallback (ADR-6); split `styles.css` into surface-owned chunks before any deletion; define residual guard (imports + orphaned selectors/tokens) | compat note → `ios-host.md`; CSS ownership map | build + static scan |
| 0.4 | Guards: presentation-free core import guard; per-surface antd/lobehub/`--brand-*`/orphan-CSS residual counter; wire into `pnpm mobile:check` | guard scripts/tests | vitest/Python static |
| 0.5 | Prove harness build on simulator (no product behavior changed) | source-bound .app | `mobile-native-build` |
| 0.6 | Station-free smoke gates stay green | evidence | access/platform/layout-a11y gates (E1 only) |

Exit: peers-ui mounted under the real app (coexisting with antd during
migration), adapters usable, build + native-build green, baselines recorded.

## 5. Slice 1 — Shell + Messaging (user-selected first product slice)

Goal: the chat experience is north-star end-to-end on real runtimes, framed
composer anatomy matches the prototype, and real functional gates pass.

### 5.1 Shell / navigation chrome

- Migrate `MobileShell` tab bar (three destinations), nav bar, badges, detail-stack
  chrome, call overlay host container to peers-ui (`IconButton/Icon`,
  `Badge`, navigation tokens) using `--pt-m-*` geometry.
- Combine chat/contacts inside messages with top subtabs
  (CONFIRMED-DESIGN-ALIGN, ADR-4 corrected 2026-11-13). Retain pane selection
  across detail return and tab changes; preserve contacts requests/group/search
  owners and native back. Existing four routes are not visual authority.
- Update `shell` fixture surfaces + inventory; keep native back/foreground
  behavior. Gates: layout-a11y, whole-product `shell`.

### 5.2 Chat rail

- Re-skin conversation rows, section headers, presence, unread badge, pinned/
  muted marks, inline search morph, "+" menu (real new-contact/new-group
  intents), empty/loading/error states with peers-ui `ListRow/Menu/Avatar/
  Badge/TextField`.
- Gate: chat fixtures + `chat-contacts` (Station-backed).

### 5.3 Thread + framed composer

- Migrate `ChatPageContent` message list/bubbles, date/service rows, typing
  (real signal), long-press action sheet (`BottomSheet`), reaction picker/chips
  (8×2 grid), reply/quote, pin banner, multiselect bulk bar.
- Rebuild composer as one framed tile following the prototype/desktop anatomy
  (emoji / file menu [choose file, camera] / voice / expand / send); treat that
  anatomy as a pending-acceptance prototype input — confirm its acceptance gate
  first or adapt to the real owner — driven by
  real `chatCommands`, `useMobileChatVoiceRecorder`, native media picker +
  real attachment upload; auto-grow `TextArea`; adapters for confirm/toast.
- Map message actions to real command ownership; hide actions the runtime does
  not own instead of faking; keep edit/recall window and reliability semantics.
- Voice bubble playback, image grids, attachment detail.
- Gates: chat fixtures (35 surfaces) regenerated; `chat-contacts` functional
  Journey (send text/image/voice, react, reply, edit, recall, forward, pin);
  voice recording validated on simulator (mic permission path).

### 5.4 Calls (messaging entry surface)

- Migrate call overlay chrome to peers-ui tokens and the accepted three-band
  layout; keep `callState` signalling/WebRTC untouched.
- The incoming-call accept/decline surface already exists
  (`MobileCallSurface`) and is mounted — re-skin it over the real `call-signal`
  owner (REAL-RESTYLE), do not rebuild it.
- WebRTC on-device media stays out of scope (NOT-THIS-PASS); signalling + UI
  states are proven.

### 5.5 Slice-1 acceptance

- Source: `pnpm mobile:check`, residual guards (chat paths at zero), vitest.
- Fixtures: chat + shell surfaces regenerate screenshot/DOM/a11y/interaction;
  44px targets, no i18n-key/PTID leak, token checks.
- iOS: `mobile-native-build`, layout-a11y, `chat-contacts` functional gate on
  current source (E2 profile). Whole-product `chat`+`shell` subset if time-box;
  full set at Slice 6.
- Prototype: three bottom destinations and top chats/contacts subtabs verified;
  detail return retains contacts scope; dead/fake chat controls removed.
  Prototype proof does not close the real App navigation migration.

## 6. Subsequent slices (expanded when entered)

- **Slice 2 Entry/Access** (station select/discover/verify, add-station, full
  access gate family, device link) — gates access/station-lifecycle.
- **Slice 3 Contacts/Groups** (contacts detail/add, friend requests, block,
  MLS group admin over real authority) — chat-contacts/social.
- **Slice 4 Moments/Social** (public + E2EE private, circles real routes,
  audience/composer/media/reactions/comments, search, profile) — moments,
  social-convergence.
- **Slice 5 Me/Settings/Recovery/Notification center** (credentials/encryption
  gap UI, preferences, station settings, mount notification center, recovery
  overlays) — settings/recovery.
- **Slice 6 Whole-product iOS closure** — residual antd/lobehub/`--brand-*` to
  zero; full 162-surface gate; acceptance matrix + release report updated.

## 7. Outcome comparison (filled at delivery)

| Criterion | Target | Actual | Verdict |
|---|---|---|---|
| Single design system in migrated surfaces | residual 0 per surface; repo →0 at S6 | | |
| Functional points bound to real owners | 100% mapped; no fixture-only delivery | | |
| Prototype/real structure reconciled | 3 bottom destinations + top chats/contacts subtabs; real capabilities retained; fakes removed | | |
| iOS functional gates | per-slice PASS; whole-product PASS at delivery | | |
| Runtime/Rust regressions | none; existing gates stay green | | |

Verdicts use PASS/PARTIAL/BLOCKED/UNPROVEN/NOT_APPLICABLE bound to current
source + evidence, never caller-authored.

## 8. Risks

- antd→peers-ui API drift (130+ button usages) → mitigated by per-surface
  waves and adapter-first ordering.
- CSS modern-feature floor on iOS → ADR-6 evidence gate in Slice 0.
- Whole-product gate historical failures (small touch targets, rotation) →
  resolved surface-by-surface against the 44px inventory before the full run.
- External prerequisites E1–E3 may delay Station/device gates; source work and
  station-free evidence are not blocked.
