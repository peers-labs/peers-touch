# Mobile Shell Interaction Gap Register

> **Status**: resolved
> **Verdict**: confirmed interaction baseline
> **Reviewed**: 2026-10-12
> **Scope**: `packages/prototypes/mobile/chat/`
> **Implementation gate**: Owner-confirmed on 2026-10-12. Production changes
> remain subject to the mounted production Plan and worktree binding.

## 1. Purpose

This register resets the Mobile prototype review after current rendered
evidence contradicted the prior `pending-review` claim. It records the
experience gaps that must be resolved before Mobile and Desktop Chat parity
work resumes.

The governing direction is:

```text
record gaps
  -> revise interaction contract
  -> rebuild executable prototype
  -> Owner confirmation
  -> resume production implementation
```

The current capability/proof gaps remain owned by
`docs/architecture/domains/chat/lifecycle/current-capability-audit.md`. This
document owns interaction quality only.

## 2. Review Basis

The review inspected the current prototype at a 390 x 844 device viewport:

- Station selection and Auth.
- Chat conversation list and Direct thread.
- Chat details.
- Moments, Contacts, and Me.
- Chat delivery failure.
- Route unavailable.
- Long conversation list.

The review also inspected current source under:

- `packages/prototypes/mobile/chat/src/`
- `apps/mobile/src/pages/ChatPage.tsx`
- `apps/mobile/src/components/MobileAvatar.tsx`
- `apps/mobile/src/styles.css`

Authority:

- `docs/client/common/ui-identity/`
- `docs/client/common/ui-identity/modules/social/README.md`
- `docs/client/common/ui-identity/patterns/{feed,composer,trust-state}.md`
- `docs/client/mobile/chat-layout-contract.md`
- `docs/client/mobile/error-feedback-contract.md`

Prototype renders are interaction evidence only. They do not prove native
runtime behavior.

## 3. Blocking Findings

### MUX-01 Prototype Review Status Is Incorrect

The current prototype is not ready for Owner review:

- the default Direct thread contains a failed delivery;
- one failed message renders both a page-level recovery banner and a
  message-level Retry;
- first-load, cached-refresh, older-history loading, and media-loading states
  are not represented;
- the visual token system still uses the old hard-coded `#6366f1` accent;
- core identity, message, and recovery anatomy is inconsistent.

Required disposition: return the prototype to `drafting`.

### MUX-02 Avatar And Identity Presentation Has No Coherent System

Observed:

- people and groups use randomly colored initial blocks;
- list, header, message, contact, comment, and profile avatars use unrelated
  sizes and radii;
- the prototype does not exercise image loading, broken asset fallback, or
  stable placeholder behavior;
- repeated incoming messages repeat a large avatar on every message;
- online state is attached inconsistently and can compete with unread state.

Required interaction contract:

- person identity uses a circular avatar; group identity uses a rounded-square
  avatar;
- source image is preferred; deterministic initials are the fallback;
- loading reserves the final geometry; asset failure falls back in place;
- online state appears only where presence changes a decision;
- consecutive messages are grouped, with identity shown once per cluster.

### MUX-03 Chat Loading States Are Missing Or Structurally Wrong

The current Chat prototype jumps directly to populated content. A long-list
sample proves row bounding, not product loading quality.

Required states:

- empty first load: geometry-preserving conversation skeletons;
- cached refresh: retain rows and show quiet local reconciliation;
- thread first load: retain header/composer and reserve message geometry;
- older history: anchored loader at the top without moving visible messages;
- attachment/avatar/media load: fixed-size placeholder with in-place success or
  failure;
- background sync: no full-panel mask over readable content.

### MUX-04 Error Ownership Is Duplicated And Visually Overstated

The default thread treats one failed outgoing message as both:

- a full-width `Delivery needs attention` banner; and
- a message-local failure icon and Retry control.

This creates two recovery owners for one intent and makes the normal Chat
journey start in an alarm state.

Required interaction contract:

- one failed message: message `MetaRow` owns failure and Retry;
- unknown outcome: the message owns `Check status`; Retry is forbidden until
  authoritative readback proves no commit;
- multiple affected messages: one aggregate banner may summarize the problem,
  while each row retains its own status;
- route unavailable: one route-local recovery state with Back and Retry;
- composer/attachment failure: composer owns the preserved draft and recovery;
- the default journey must contain no synthetic failure.

### MUX-05 Message Anatomy And Reading Rhythm Are Inconsistent

Observed:

- bubbles, files, replies, reactions, receipts, retry, and pinned content each
  use a different boundary model;
- timestamps and receipts are too small and visually detached;
- failed-message recovery creates a large empty gap above the composer;
- the permanent `Chat / Pinned` segmented row consumes vertical space even
  when pins are not the user's task;
- repeated sender avatars and metadata weaken message grouping.

Required direction:

- group consecutive messages by sender and time;
- use one stable `Bubble -> MetaRow -> ActionAnchor` anatomy;
- show sender name once per group conversation cluster;
- show timestamp/receipt on the final message in a cluster;
- expose one compact pinned-message banner; open all pins in a dedicated
  surface instead of a permanent thread tab;
- keep message actions outside readable message bodies.

### MUX-06 Mobile Touch And Bottom-Layer Geometry Is Below Contract

Observed source values include 36–38 px composer/header controls and a 26 px
reaction-add control. These are below the 44 px Mobile target. Keyboard, input
panel, and safe-area transitions are not exercised by the prototype.

Required states:

- 44 px minimum primary touch hit area;
- compact visible icons may use an expanded invisible hit area;
- composer, keyboard, emoji/attachment/voice panel, Home Indicator, and any
  visible tab bar share one clearance model;
- the last message remains readable in every bottom-layer combination;
- focus and draft survive panel changes and failure.

### MUX-07 Conversation List Does Not Present Trustworthy State

Observed:

- the tab badge is hard-coded to `7`, while visible unread rows do not reconcile
  to that count;
- pinned, group, mute, presence, time, and unread indicators compete in one
  compressed title row;
- loading, stale, unavailable, and empty states do not preserve the same list
  geometry;
- generated gradients dominate identity more than conversation state.

Required row anatomy:

```text
Avatar | Name + quiet relationship state | Time
       | Sender prefix + message preview | Unread/mute
```

Pin and group identity must not appear as unrelated inline glyphs. Unread count
must come from the same projected rows as the list.

### MUX-08 Visual Tokens Do Not Match The Current Design Identity

The prototype defines a private visual system around `#6366f1`, ad-hoc gray
values, raw shadows, and several local radius systems. This conflicts with the
current shared Design ID direction and makes Mobile appear unrelated to the
other product surfaces.

Required direction:

- consume the shared Design Token source instead of a private Mobile palette;
- use the authoritative brand accent from the shared token package;
- map every surface, text, action, trust, radius, border, and spacing value to a
  semantic role;
- remove duplicated legacy style blocks and raw component-library defaults;
- add light and dark rendered evidence before review.

### MUX-09 Details And Destructive Actions Lack Decision Hierarchy

The current Details page has a generic title, a detached profile block, large
unused space, and three red actions with equal visual weight.

Required direction:

- preserve conversation identity in the title;
- group reversible preferences separately from shared media and trust actions;
- separate local deletion, relationship blocking, and reporting by authority
  and consequence;
- require explicit confirmation and preserve return context;
- use a dedicated page or bottom sheet according to task depth.

### MUX-10 The Rest Of Mobile Shell Does Not Feel Like One Product

Observed:

- Moments uses repeated elevated cards while Chat and Contacts are flat lists;
- Contacts mixes group rows, alphabet dividers, and contact rows with different
  spacing rules;
- Me uses nested settings cards, a square profile avatar, and raw PTID wrapping;
- each module selects its own icon colors and surface treatments.

Required direction:

- preserve one Mobile shell grid, header rhythm, row anatomy, and avatar system;
- use cards only when the surface owns a separate user intent;
- keep social reading surfaces continuous;
- expose PTID/Station trust detail progressively instead of as broken primary
  copy.

### MUX-11 Accessibility, Localization, And Dynamic Type Are Unproven

Current prototype copy is largely hard-coded English. Several controls are
below the Mobile target size. Long names, expanded translations, dynamic type,
VoiceOver/TalkBack order, focus restoration, and reduced motion are not fully
covered.

Required evidence:

- English and Chinese, plus one expansion stress locale;
- long actor/group/station/file names;
- 200% text where the platform supports it;
- semantic status/error announcements;
- touch, keyboard, focus restoration, and reduced-motion paths.

### MUX-12 Call Experience Remains A Separate Partial Surface

One-to-one Call states exist, but permission, device selection, native media,
direct/TURN, reconnect cleanup, and production style/i18n remain unproven.
Group Call has no Mobile runtime or product surface.

Call does not block the first Chat interaction revision, but it cannot be
declared aligned or complete.

## 4. Proposed Review Order

The next prototype revision must be reviewed in this order:

1. Shared Mobile tokens, avatar roles, row anatomy, and shell grid.
2. Conversation list: default, first loading, cached refresh, empty,
   unavailable, and long content.
3. Thread: default success journey, first history load, older history,
   grouped messages, reply/file/image/voice, and composer panels.
4. Failure and recovery: failed, unknown outcome, attachment failure,
   route unavailable, reconnect, and restored draft.
5. Details, message actions, pinned messages, group administration.
6. Contacts, Moments, and Me consistency.
7. One-to-one Call; Group Call only after its product surface is designed.

## 5. Confirmation Decisions

The revised prototype must make the following decisions explicit for Owner
confirmation:

1. People are circular; groups are rounded-square; deterministic initials are
   fallback only.
2. Default Chat contains no error. Failure is entered through a dedicated
   scenario or real action.
3. A single failed message has one message-local recovery owner. Aggregate
   banners are reserved for aggregate impact.
4. Pinned content uses a compact banner plus a dedicated list, not a permanent
   `Chat / Pinned` thread switcher.
5. Incoming messages use sender clusters rather than one avatar per bubble.
6. Existing content remains visible during refresh; skeletons are first-load
   only.
7. Mobile uses shared Design Tokens and supports both light and dark review.
8. Production implementation remains frozen until these decisions are
   confirmed in the executable prototype.

## 6. Required Evidence Before Returning To `pending-review`

- L1: source trace for every state and semantic token role.
- L2: default, loading, empty, stale, failed, unknown, long-content, light,
  dark, English, Chinese, and expansion-stress captures.
- L3: list-to-thread, older-history load, send/fail/retry, unknown-status
  reconcile, attachment failure, keyboard/panel switching, detail/back, and
  draft preservation.
- L4: semantic tree, status announcements, touch targets, contrast, long-list
  behavior, layout shift, and route-to-visible evidence.

Any missing cell remains `UNPROVEN`; prior screenshots do not confer approval
on the revised interaction.

## 7. Revision Disposition

Current executable source and rendered evidence resolve:

- MUX-01: default thread is clean; dedicated failure scenarios own recovery.
- MUX-02: one identity primitive owns person/group geometry, source loading,
  deterministic fallback, presence, and cluster placement.
- MUX-04: single failure and unknown outcome each have one message-local owner;
  route unavailability has one route-local owner.
- MUX-05: sender clustering, final-message metadata, compact pinned banner, and
  dedicated pinned page replace the permanent thread switcher.
- MUX-07: unread total derives from the projected conversation rows and row
  anatomy separates relationship state from preview/unread state.
- MUX-08: shared semantic tokens drive CSS and antd in light/dark themes.
- MUX-09: details expose trust on demand and separate device-local clear,
  relationship block, and safety report hierarchy.
- MUX-10: Moments, Contacts, Me, and Chat use one continuous Mobile shell
  language.

Partially resolved:

- MUX-03: first-load, cached refresh, cached error, empty, thread first-load,
  and sticky older-history loading are rendered. Real attachment/media loading
  and failure recovery remain `UNPROVEN`.
- MUX-06: covered visible Chat actions meet the 44 px target and the composer
  reserves safe-area clearance. Real software keyboard and input-panel
  switching remain `UNPROVEN`.

Still open:

- MUX-11: long expansion and a Chinese journey sample are rendered, but
  full-shell localization, 200% type, and assistive-technology order remain
  `UNPROVEN`.
- MUX-12: Call remains governed by its separate partial-surface evidence.

## 8. Evidence

Evidence root:

`docs/architecture/platform/client/mobile/prototype/evidence/20261012-interaction-revision/`

Covered captures:

- clean list, light and dark;
- list first-load, cached refresh, cached error, empty, long content;
- avatar loading and fallback;
- clean thread, thread first-load, sticky older-history load;
- route unavailable, failed delivery, unknown delivery, and both resolved
  outcomes;
- dedicated pinned messages;
- Moments, Contacts, Me, and conversation details;
- partial Chinese Chat journey.

`visual-check.json` records token values, device geometry, mounted row counts,
recovery-owner counts, touch-target findings, overflow observations, and
console errors.

Verdict: the accepted eight-decision interaction baseline is implemented and
Owner-confirmed under
`USER-DECISION-20261012-MOBILE-PROTOTYPE-CONFIRMED`. The remaining
`UNPROVEN` cells stay explicit and production work may proceed only through its
mounted Plan.

## 2026-11-02 Pine grammar rebuild (antd dept closed)

Status change: the entire presentation layer of
`packages/prototypes/mobile/chat` was rebuilt on `@peers-touch/ui` +
`northStarVariables` (the same candidate theme as the desktop prototype).
`antd` and direct `lucide-react` usage are removed from the package; all
icons resolve through the registered glyph set and all controls through the
library primitives.

Accepted mobile density and grammar contract:

- conversation/contact rows 64px with 40px squared avatars (radius 11);
- group avatars carry the registered `users` glyph, no per-person gradient;
- own bubbles use neutral ink (`--pt-ownBubble`), peers use surface, own
  avatars render on the right (`row-reverse`);
- unread count badges are neutral ink, never semantic red/blue;
- relationship state renders as quiet pin/mute icons, not prose sentences;
- radius family restricted to 5 / 8 / 11 / 16 / 20 and full pills;
- primary action is single neutral ink; hue is reserved for trust/state.

Structural removals: Me vanity statistics, dead `Safety Number` /
`Chat Background` rows, the dead compose pencil, duplicated search entry
points, avatar gradient data (`avatarGradient`/`GRADIENTS`), and the iOS-green
custom toggle (replaced by the library `Switch`). Photos use the existing
`tool_text_to_image` media helper instead of CSS gradients.

Gates (all runnable against the standalone dev server):

- `scripts/check-layout.mjs` — pine grammar geometry over 390/554/1440:
  radius family, square non-circular avatars, ink badges, row heights, no
  horizontal overflow, no antd residue, no pastel tiles, no verbose
  relationship prose;
- `scripts/message-layout.mjs` — 28px avatar track, symmetric gutters,
  own-row reversal, 8/16 cluster rhythm, bubble containment;
- `scripts/emoji-action-sheet.mjs` — quick reaction row and full grid;
- `scripts/check-call-states.py` — seven call states plus header-start flow.

Verdict: the mobile prototype now speaks one design language with the desktop
prototype. Re-introducing antd/lucide, gradient avatar tiles, ad-hoc radii,
or semantic-color CTAs is a regression and fails `check-layout.mjs`.

## 2026-11-02 Mobile input grammar unification

Input surfaces were still a mixed population (native inset-filled wells in
contacts/global search, peers `TextField` in sheets, browser-default textarea
focus boxes with resize grips) and read as a dated admin form kit.

One mobile input grammar now covers every editable surface:

- surface fill, one-level hairline (`--pt-border`), **16px** corners;
- 46px touch height, 14px horizontal padding, 15px text;
- hover lifts the hairline one level; focus is a 1px ink hairline plus a
  4px neutral ink-tinted halo (no hard black 2px box, no admin outline);
- search rows carry a leading glyph and a circular clear action;
- textareas lose the native resize grip;
- embedded thread composer stays borderless (its container owns the surface).

Applied to: chat/contact list search wells, global search, find people,
create group, account/station forms, moments composer and circle pickers.
The chat list search entry moved back into the list header (the header
magnifier duplicate was removed). `check-layout.mjs` asserts the frame
radius family, 45px+ frame height, absence of legacy native wells, and
`resize: none` on textareas.

## 2026-11-02 Desktop message menu: density defect + protocol action parity

The message overflow menu rendered at 502px wide — nearly three times its
content — with only five sparse rows. Root cause was a peers-ui primitive
defect, not a skin issue: `.pt-menu-item` was an inline-level (`inline-flex`)
row, so the shrink-to-fit popup computed max-content as if every row sat on
one unbreakable line and summed all rows, instead of taking the widest one.

Primitive fix (`packages/ui`):

- menu rows are block-level (`display:flex`), so the popup width tracks the
  widest command (min-width 180px);
- new `--pt-control-menu: 32` geometry token — menu rows are 32px / 13px,
  the compact command-list density (Feishu parity), distinct from the 28px
  compact button and 36px normal control;
- `.pt-menu-separator` now paints a full-bleed hairline (previously an
  unstyled zero-height div), enabling real command groups.

Action parity with the real protocol vocabulary (`model/domain/chat`
`ChatCommand` oneof):

- added **hide-for-me** (`HideMessageForActorIntent`) — local-only removal
  available on every message, replacing the own-only "delete" entry;
  retract (everyone, windowed) stays separate as 撤回;
- added **report** (`ModerateMessageIntent`, reason-coded) on peer
  messages with a four-reason dialog (spam / abuse / misinfo / other);
- added **multiselect** — a pure client bulk mode (no protocol command of
  its own): row checkboxes and a bulk bar for forward / copy / hide.

Explicitly not added: favorite, translate, copy-message-link (no protocol
objects today) and Feishu-suite Add Task / Export to Docs / Shortcut Apps
(no peers-touch counterpart). Menus are grouped per ownership:
peer = thread / copy, multiselect / report, hide; own = thread / pin, copy,
multiselect / edit, recall (windowed, disabled-with-reason after) / hide.

Gates in `north-star.suite.json`: menu width/row/font geometry, peer and own
group structure, windowed disabled state, single hide, multiselect bulk
hide, and the report submit-enable flow.

## 2026-11-02 Desktop composer expand + send button grammar

Two defects in the desktop chat composer:

1. **Expand/collapse did nothing.** The toggle only changed the textarea's
   `max-height` cap, but the box was a native `rows=1` textarea with no
   auto-grow: its height never followed content (8 lines still rendered one
   row, 80px floor). Worse, `.sk-composer-input` carried `flex:1` inside the
   column-oriented FieldFrame, giving the textarea a zero flex-basis so even
   inline/!important heights were ignored. Fix: the textarea is `flex:none`
   and a layout effect auto-sizes it from scrollHeight clamped between
   row floors — collapsed 1–4 rows, expanded 6–12 rows — so expanding lifts
   the writing area immediately even when empty, and typing grows it
   naturally (scroll after the cap).
2. **Send was a circle.** `.sk-composer .pt-icon-button` forced
   `border-radius:50%`; the pine grammar sends on a squircle. It is now a
   36px control at `--sk-radius-control` (12px), bottom-aligned in the
   composer. Circles remain reserved for the small tool glyphs.

Gate: `composer-expand-grow` scenario asserts pressed-state on toggle and
the 12px send radius; full north-star suite (152) OBSERVED.

## 2026-11-02 Rail tile square + notification paging

Two outer-rail defects:

1. **Bell badge sat off the tile corner.** The peers-ui rule
   `.pt-icon-button[data-density=compact]` (specificity 0,2,0) overrode the
   rail tile width, rendering every rail tile as a 28×38 vertical rectangle
   while `.sk-rail-icon` declared 38×38 (0,1,0). The badge anchored to the
   38px wrapper so its center floated beside the button. Fixed by a
   higher-specificity rail rule (0,3,0) forcing 38×38 squares, and the badge
   wrapper is now a fixed 38px square with the badge at top/right -6px,
   straddling the corner consistently with conversation unread badges.
2. **More notifications had nowhere to go.** The 440px panel hard-clipped
   the last row with no overflow affordance. Seeds expanded to 10; the panel
   now shows one page of 5 with a sticky "show N earlier" pager, list-owned
   scrolling, a bottom edge fade while rows remain below the fold, and a
   viewport-aware max-height. Reopening resets to the first page (the bell is
   an at-a-glance surface).

Gates: bell tile 38×38 geometry, pager remaining-count / 5→10 expansion /
pager dismissal, and the all-deleted empty state; north-star suite 152
OBSERVED.

## 2026-11-02 Compact conversation header (WeChat parity)

The conversation header read as a thick, unbalanced toolbar: 60px tall with
three 36×36 chip buttons (resting fills, 16px glyphs, 4px gaps), so the bar
dominated the message surface and the right cluster looked arbitrary next to
the WeChat-style flat header.

Rebuilt as a slim one-line bar in `chat.css`:

- bar height 60 → **52px**, title 15.5px on the left baseline;
- the three actions (audio / video / info) are **borderless line glyphs** —
  transparent resting background, 19px icons on a fixed 34px hit target,
  even 6px rhythm, subtle ink wash on hover (no button chips, no arbitrary
  tiles);
- the detail side-sheet title tracks the new header so its hairline stays
  collinear (18px inset + 52px band), measured diff 0.

Gates: `chat-header` now asserts the 52px band, transparent action
backgrounds, and 19px glyph width; `detail-panel` keeps the collinear-title
assertion. North-star suite 152 OBSERVED.

## 2026-11-03 Mobile/Desktop semantic alignment (shared chat domain)

Mobile and Desktop Chat had drifted into two private interaction contracts:
the mobile prototype carried a 5-kind local reaction vocabulary, a 40-cell
emoji grid with a silent unknown-emoji fallback, a private local flag,
decorative i18n (every surface statically imported the English bundle), and
its own window/search/demo state semantics that no longer matched the gate
suite after the peers-ui rebuild. The alignment puts one headless contract
under both surfaces:

- **Shared domain** — `packages/prototypes/shared/chat-domain/` now owns the
  16-kind reaction catalog (`QUICK_REACTION_KINDS` = 8), strict
  emoji↔kind mapping (unknown emoji never silently falls back), viewer
  reaction operations (multi-select toggle, viewer-first ordering), and the
  message action catalog/group resolver (primary / organize / mutate /
  safety, ownership, mutation-window, danger). Desktop menu, mobile action
  sheet, and both reaction strips derive from it.
- **Reactions** — quick row of 8 with an expand toggle to all 16 on both
  surfaces; selecting a reaction no longer closes the popover/sheet, so
  multiple kinds are one gesture apart; reaction chips are toggle buttons
  with a viewer-selected state.
- **Mark for later replaces flag** — the personal local flag is now
  "mark for later" (`mark-later`, bookmark glyph): a chip on the message and
  a marked-messages list in conversation details on Desktop and mobile. It
  stays local-only; nothing about it is visible to peers.
- **Mobile message safety and bulk operations** — long-press / right-click
  action sheet groups come from the shared catalog; multiselect mode has
  real row checkboxes, a bulk bar (forward / copy / hide), a reason-coded
  message-level report sheet (spam / abuse / misinfo / other), bulk hide
  confirmation, and bulk forward through a real picker.
- **Real i18n runtime** — `src/i18n.ts` resolves `?lang` then navigator
  language, merges common/chat/search namespaces, re-renders the whole shell
  live on toggle, and syncs `document.documentElement.lang`. All interface
  chrome is keyed (including the tab bar); seeded narrative content stays
  untranslated by design. The search field, composer, thread More entry, and
  related locale values match the English the gate suite encodes.
- **Touch geometry** — `100dvh` shell, `viewport-fit=cover`,
  `interactive-widget=resizes-content`, safe-area insets, a
  visual-viewport keyboard-height variable that pads the composer, 44px
  reaction targets, and full-bleed layout under 540px.

Navigation-state defects surfaced while reactivating the long-list gates were
fixed at the shell level, not in the gates:

- conversation surface keys encode the active filter query (contacts/search
  already did), so filtering resets the window through remount while an empty
  query keeps the prior browsing position;
- list queries persist in shell-owned memory across thread/detail
  round-trips;
- search targets are one-shot intents (cleared after reveal), and a thread
  opened from a result returns to the search overlay on its first Back;
- the controlled search lifecycle now binds its owner on open, so submit
  tickets transition through loading;
- social evidence scenarios reopen on the contacts surface and the
  find-people sheet opens for `request-unknown`;
- a resolved direct conversation switches to the chat surface before the
  thread renders.

Gates: `check-long-lists.mjs` and `check-residual-parity.mjs` green on the
Make Portal; `check-layout.mjs` (static touch contract + dynamic emoji sheet +
message geometry) and `check-call-states.py` green on the standalone mobile
server; north-star suite updated to quick-8/16 + `data-react-kind`, 6-row
peer / 8-row own menu groups, the `mark-later` entry, and a new
`message-mark-later-toggle` scenario — full suite OBSERVED. Evidence remains
prototype-only; native and Station behavior stay unproven.
