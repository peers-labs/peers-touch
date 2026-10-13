# UI Identity Review Checklist

> Status: Canonical UI identity review checklist.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-10-12.

## 1. Purpose

Use this checklist before accepting any client UI change.

The goal is to catch "functionally correct but visually assembled" UI before it reaches E2E or review.

## 2. Required Inputs

- Screenshot or preview of the changed surface.
- User task the surface supports.
- Product thesis, surface type, main subject, and module signature from
  [craft-quality.md](./craft-quality.md).
- Module contract under `modules/` when one exists.
- Relevant shared pattern under `patterns/`.
- State matrix for normal, loading, empty, error, disabled, overflow, and narrow-window states.
- Dynamic evidence for the success and recovery paths.

## 3. Product Identity

- [ ] The surface follows Structured Expressive Minimalism; recurring workflow
  surfaces use Quiet Protocol Minimalism as the default expression.
- [ ] The screen does not feel like mixed LobeUI, antd, and one-off CSS defaults.
- [ ] Primary content reads before metadata and chrome.
- [ ] Federation/trust state is visible where it affects interpretation or action.
- [ ] Trust facts are placed by decision distance per
  [trust-state.md](./patterns/trust-state.md): absent from the in-flow
  conversation, a single quiet cue only on deviating items, full detail on
  demand, and strong treatment only at decision moments.
- [ ] Station/relay/verification chrome is not stacked in a live conversation
  header unless it is a trust decision point or a delivery/path failure.
- [ ] Detail/decision surfaces are recognition-first and plain-language: person
  and how to recognize them lead; network, station domains, relay/node ids, hop
  diagrams, and key hashes sit at the bottom or behind a technical disclosure,
  never as the headline.
- [ ] The UI does not look like an admin dashboard unless the module is an admin module.
- [ ] The module signature reinforces the product thesis and is not decorative
  benchmark imitation.

## 4. Layout And Boundaries

- [ ] Page canvas, content rail, action rail, trust rail, and recovery layer are identifiable.
- [ ] No unexplained large gutter or detached side void exists.
- [ ] Header, tabs, CTA, composer, and content align to one grid.
- [ ] Continuous content has a continuous surface model.
- [ ] Vertical rhythm follows one spacing scale; inputs/controls are sized to
  their content (no oversized fixed-min-height empty box that splits placeholder
  from its toolbar). Empty states are one quiet line aligned with section
  content — never a card/dashed-box nested inside another card, and never
  touching the section edge.
- [ ] Spacing, alignment, and edge-insets are verified with measured box values
  (padding/gap/min-height/edge distance), not only by looking at a screenshot;
  the machine-checked rules in §13 apply to every changed surface.
- [ ] Symmetry and optical balance are explicit: corresponding insets match,
  repeated rows share content/metadata/action axes, and mixed action counts
  or state transitions do not move them. Any purposeful asymmetry has a
  content/platform reason ([layout.md §3.1](./layout.md#31-symmetry-and-repeated-row-tracks)).
- [ ] Floating layers are anchored and do not cover primary content unexpectedly.
- [ ] **Transient popovers behave correctly**: only one menu/picker open at a time; it opens away from the item it acts on (flip only when space is lacking); clicking outside, pressing Escape, scrolling the source list, or switching context dismisses it. A popover that stays open over unrelated content is a defect.

## 5. Component Style

- [ ] Button roles are named and visually consistent.
- [ ] Every button sits on the canonical size/radius scale (components.md §3);
  bespoke per-surface button dimensions are a defect.
- [ ] Row action groups share one horizontal center line and trailing edge
  (button bottoms align); see components.md §3.
- [ ] **One entity, one component.** A recurring entity (relationship request,
  contact/session row, identity block, decision pair) renders from its single
  shared component on every surface, carrying the same `data-entity` /
  `data-decision-action` markers and identical control geometry. A second
  hand-built look-alike is a defect (components.md §3.1).
- [ ] Primary CTA does not visually fight tabs, header, or content.
- [ ] Cards/surfaces are not nested without distinct user intent.
- [ ] Inputs and composite controls have one parent boundary.
- [ ] Danger actions are scoped, explicit, and recoverable.
- [ ] **Every visible control is wired to a real outcome.** No `onClick={() => {}}`
  placeholders and no link-styled text without an action. If a capability is not
  built, remove the control or render it disabled with the reason; a click that
  does nothing is a defect.
- [ ] **Product UI carries no instructional, meta, or debug copy.** Do not explain
  how a standard internet product works, restate role permissions in prose, leave
  "try X = owner, Y = admin" scaffolding, or reference production behavior ("production
  should…"). Prefer a single label/badge; detail belongs in docs, not the UI.

## 6. State And Feedback

- [ ] Loading state belongs to the semantic action owner.
- [ ] Disabled state explains why when it blocks task completion.
- [ ] Error state preserves input and provides retry/recovery.
- [ ] Optimistic updates have rollback.
- [ ] Trust/policy states are server-authoritative when backend owns truth.

## 7. Content And Localization

- [ ] All user-facing text uses i18n keys.
- [ ] Empty states explain what the surface is and what the user can do.
- [ ] Error copy includes context without leaking secrets or PII.
- [ ] Long names, long station domains, and localized strings do not break layout.

## 8. Accessibility

- [ ] Keyboard users can reach primary and secondary actions.
- [ ] Focus ring belongs to the correct semantic owner.
- [ ] Popovers/menus restore focus to the source.
- [ ] Contrast is sufficient for text, metadata, and states.
- [ ] Icon-only actions have accessible labels.
- [ ] The complete task works with keyboard only.
- [ ] Mobile primary targets have robust touch hit areas.
- [ ] Status changes are exposed semantically to assistive technology.
- [ ] Reduced motion preserves state meaning and spatial continuity.

## 9. Craft Calibration And Runtime Quality

- [ ] Positive calibration names what is intentionally strong and ties it to
  the product thesis.
- [ ] Negative calibration checks the rejection patterns in
  `craft-quality.md`.
- [ ] L2 evidence covers real wide/narrow renders, critical states, long
  content, and localization expansion.
- [ ] L3 evidence covers success, failure/recovery, keyboard, Mobile touch,
  and reduced motion where material.
- [ ] L4 evidence records semantic/accessibility inspection, long-list or
  high-frequency behavior, and available performance measurements.
- [ ] Accidental overlap and layout movement are absent.
- [ ] Missing runtime, platform, accessibility, or performance evidence is
  marked `UNPROVEN`.
- [ ] The verdict does not use award language, averaged scores, or checklist
  counts as proof.

## 10. Frontend Tree And Alive

- [ ] The changed surface has a defined component tree layer in `frontend-component-tree.md`.
- [ ] The surface has an Alive / lazy / LRU / non-alive decision in `frontend-component-tree-registry.md` when it is a page, primary tab, provider section, applet runtime, overlay, or large list.
- [ ] Primary tab navigation changes visible route before data, schema, bundle, or runtime loading.
- [ ] Settings/provider UI mounts only the selected provider schema; CLI provider fields are not forced through a generic cloud-provider form.
- [ ] Hidden alive trees use narrow store selectors and do not re-render on unrelated runtime/store updates.
- [ ] Large feeds, messages, rosters, logs, and grids are virtualized or incrementally rendered.
- [ ] Long-task, remount, or route-to-visible risk is measured or explicitly marked as unproven.

## 11. Social Methodology Gate

When validating Social UI, include at least one incomplete or partially implemented capability.

Required checks:

- [ ] Feature unavailable state does not look broken.
- [ ] Pending backend capability is distinguishable from empty content.
- [ ] Station/moderation policy state is never fabricated locally.
- [ ] Comment/reaction/follow states expose loading and rollback.
- [ ] Feed/detail/thread surfaces stay visually continuous.

## 12. AI Agent Output Contract

When reporting UI work, include:

- Files changed.
- Contract files read.
- Frontend tree layer and Alive category when UI lifetime is affected.
- Registry row updated or reason it was not required.
- UI states verified.
- L1/L2/L3/L4 craft evidence collected.
- Positive and negative calibration findings.
- Performance evidence checked or explicitly unproven.
- Known gaps.
- Whether the change follows common UI Identity, module UI Identity, or both.

## 13. Geometric Measurement Gate

Human reviewers judge the container *model* in ~100 ms ("floating island",
"squeezed column"); behavior assertions ("button responds") cannot see those
defects. Every spacing/density/edge change must therefore be accepted against
measured geometry, not screenshots alone.

- [ ] **Assertions before pixels.** Before editing, list the expected rects of
  the changed surface — content-box size, four edge distances, alignment
  anchor x/y (e.g. composer field gutters with a bounded delta to the message
  rail), minimum readable text width, hit-target size, count of elevated
  boxes. Keep the
  checks in a runnable gate; a surface that was defective before the change
  must fail the gate red, and go green after.
- [ ] **Viewport matrix, not one hand-picked size.** Run at the user's real
  window plus a wide and a narrow width; when a compact branch depends on a
  shell content width (viewport minus rails), sweep across that threshold in
  steps so the branch flip is covered.
- [ ] **The four structural defects are scanned explicitly** on every
  viewport: horizontal overflow (`scrollWidth > clientWidth`), one-character
  columns (leaf text whose rendered width drops under ~5ch while its content
  is long), floating islands (leaf surface box detached from its base by
  >8px or carrying an elevation shadow the grounded model does not assign),
  and broken alignment (expected shared x/edge differs beyond tolerance).
- [ ] **Proportion checks.** Sizes are asserted relative to their container,
  not only absolutely (e.g. input content box vs bar height, value-column
  width vs detail pane, card height vs viewport), so a change that "fixes"
  one pixel while leaving the model wrong cannot pass.
- [ ] **Reachability is geometry.** Icon-only/quiet controls must still have
  a full hit target (≥28px, 34px in desktop chrome) and, when discoverability
  matters, a visual separator or boundary; "click works" is not enough.
- [ ] **Floating anchors are measured.** Check the popover's declared aligned
  edge against its source button's live rectangle across window resize,
  multiline content, and empty states (components.md §8). For a bottom-aligned
  rail popover, panel and button bottoms agree within 1 CSS pixel.
- [ ] **Complete viewers remain one surface.** Preview expansion mounts one
  dialog, with bounded current-page rows, working search, empty-result
  recovery, pagination and valid page correction after deletion. Verify
  stable dialog geometry, shared read/decision state, teardown and source
  focus restoration.
- [ ] **Painted boundaries are checked.** Foreground contours that overlap
  another surface remain visible on all four edges and rounded corners
  (components.md §4). Sample screenshot pixels against the boundary's declared
  color and use hit testing across its edges and primary content. Cover
  changes, clipping, and open menus are included; a transparent menu backdrop
  may intercept hits, but must still pass the contour checks. CSS properties
  and rectangle overlap alone cannot pass this class of check.
- [ ] **Screenshots are opened and judged after the gate is green.** Each
  evidence shot records path / state / viewport / theme / verdict; a saved
  path that was never viewed is not evidence.
- [ ] The zero-console-error / zero-page-error requirement applies to the
  whole matrix run, not the happy viewport.
- [ ] Harnesses live next to the surface they govern (example:
  `packages/prototypes/desktop/features/social-chat/qa/geometry_checks.py`);
  extend the existing gate rather than creating one-off scripts or docs.
- [ ] **Class-level, not case-by-case.** The gate encodes reusable visual
  invariants across all surfaces, not the current bug: the canonical button
  size/radius scale applied to every visible button; row action groups sharing
  one center line and trailing edge; cross-surface entity consistency
  (`data-entity` rows must expose the same `data-decision-action` controls with
  identical geometry wherever they appear). A surface-specific pixel is only
  added as an instance of one of these classes.
- [ ] **Cross-row symmetry is a separate class.** Compare corresponding
  start/end/center axes, visible action edges and opposed insets within
  1 CSS pixel. A centered dialog and aligned buttons inside one row do not
  establish alignment across its rows. Include mixed action counts,
  multiline content, metadata expansion and pending-to-resolved transitions.
- [ ] **Spatial declarations are covered and falsifiable.** Changed repeated
  surfaces declare `data-ui-rows`, `data-ui-row` and named `data-ui-column`
  slots with `data-ui-column-align` (`start/end/center/stretch`). Centered
  slots carry `data-ui-row-center`; trailing control groups carry
  `data-ui-controls-align="end"`. Balanced frames declare
  `data-ui-balance="inline block"` for the applicable axes. Require expected
  slot coverage; deliberately shift a column, unbalance an inset and offset
  a visible control, then check that the same production probe fails.
  These markers expose intended relationships, never waive an observed
  alignment defect. Screenshot review is still required for glyphs and
  optical weight that rectangle probes cannot assess.
- [ ] When the same entity appears in two surfaces (list, popover, detail,
  notification), the gate visits both and compares the entity control
  geometry — the check fails if the implementations drift.
