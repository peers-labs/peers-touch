---
status: active
owner: Client Platform Team
updated: 2026-10-27
review-cadence: quarterly
next-review: 2027-01-27
related:
  - docs/client/common/ui-identity/review-checklist.md
  - docs/client/common/ui-identity/components.md
---

# UI Identity Layout

## 1. Purpose

Layout defines the user's reading and action path before component styling begins.

This document prevents pages from solving layout locally with arbitrary margins, nested cards, or empty gutters.

## 2. Layout Anatomy

Every client page must declare:

- Shell area: owned by the app frame, navigation, and persistent chrome.
- Page canvas: owned by the page route.
- Content rail: primary reading and task area.
- Action rail: primary and secondary actions.
- Trust rail: identity, station, audience, permission, moderation, or source explanation.
- Floating layer: popovers, menus, pickers, dialogs.
- Recovery layer: error, retry, degraded, offline, and partial-success states.

## 3. Content Rail

The content rail is the main vertical path for reading and task completion.

Rules:

- The rail must align page title, tabs, primary actions, composer, feed, detail, and empty states.
- The rail may be centered, split, or full-width only if the page contract states why.
- A blank side gutter wider than the active content gap is a layout defect unless owned by a split-pane or rail contract.
- Detail pages should preserve relationship to the list surface; do not create a detached mini-page inside the same rail.

### 3.1 Symmetry And Repeated Row Tracks

- Same-purpose opposed insets are equal. Centered subjects and controls sit
  on the declared center axis; side-anchored surfaces inherit their source
  edge. Deliberate asymmetry requires a named content or platform reason.
- A repeated list owns the tracks for avatar, primary content, metadata and
  actions. Corresponding slots share start/end/center axes across all rows;
  metadata width and action count must not independently resize each row.
- Single and multiple actions occupy the same reserved action track. Absent
  actions leave an empty structural slot without adding fake or disabled
  controls. Resolve the widest allowed action form before row rendering so
  a decision or refresh cannot move the reading axes.
- Within a row, vertically centered slots share its center; metadata may
  instead follow a declared title baseline. Multiline content must preserve
  that chosen rule and balanced block padding.
- Metadata uses readable intrinsic or bounded shared tracks. Narrow layouts
  may move metadata to a secondary line when the contract declares the
  change; they must not compress primary text into one-character columns.
- Verification compares corresponding axes and opposed spacing within
  1 CSS pixel across wide/narrow, mixed action sets, multiline content,
  metadata expansion and state transitions. Also inspect real screenshots
  for optical balance; do not encode literal screenshot coordinates.

### 3.2 Multi-phase overlay geometry

A dialog/sheet that walks through phases (e.g. QR → approval → processing →
complete) must keep one constant geometry; phase content swapping height is
the modal equivalent of a shifting row and is a defect.

Rules:

- Reserve the **terminal** geometry up front. All phases render inside one
  fixed-size stage using absolutely-positioned layers of identical bounds;
  only one phase layer is in the layout flow at a time.
- Status/error text occupies one reserved line (error merges into the status
  slot, never appends a second row).
- The footer action area reserves the real button height even when no
  action is available in the current phase; appearing/disappearing buttons
  must not grow or shrink the overlay.
- Verify with measured geometry across every phase transition, not a single
  state: the overlay width/height must be identical for all phases (the
  device-link modal is the reference, constant 360×497). See
  [review-checklist.md §13](./review-checklist.md#13-geometric-measurement-gate).

## 4. Header And CTA

Page header layout must make title, navigation, and CTA feel like one system.

Rules:

- The primary CTA belongs to the header action rail or composer action row, not an arbitrary corner.
- Header tabs and CTA must share vertical rhythm and tokenized button height.
- If a CTA is visually heavy, surrounding controls must support that hierarchy.
- Do not place a black filled button beside soft white tabs unless the theme defines that as the global primary style.

## 5. Surface Boundaries

Surface boundaries should express semantic grouping.

Rules:

- Use spacing first, hairline second, soft shadow third, heavy border almost never.
- Do not wrap a feed item, its detail state, comments, and reply composer in unrelated nested cards.
- When a user opens comments under a post, the post and comments become one thread surface.
- If content is continuous, the visual boundary must be continuous.

## 6. Desktop Adaptation

Desktop may use:

- Wider content rails.
- Hover affordances.
- Popovers for low-risk secondary choices.
- Split panes when parallel reading is required.

Desktop must not:

- Inflate every page into a dashboard layout.
- Use large unused gutters as visual padding.
- Hide core social actions behind hover-only affordances.
- Let side navigation visually collide with the page content rail.

## 7. Mobile Adaptation

Mobile may use:

- Single-column rails.
- Bottom sheets for selection.
- Sticky composers or bottom actions.
- Full-width feed surfaces.

Mobile must not:

- Copy desktop popover density when it hurts touch usability.
- Hide trust or audience state below fold when it affects posting or interaction.
- Let keyboard, composer, or bottom navigation cover primary content.

## 8. Covered UX Dimensions

This layout contract covers:

- Visual continuity.
- Spatial boundaries.
- Information hierarchy.
- Platform fit.
- Performance perception through stable layout.

Out of scope:

- Exact component rendering.
- Module-specific content ordering.
- Detailed keyboard accessibility, which is covered by component and platform contracts.

## 9. AI Agent Checklist

- [ ] Can I draw the content rail and action rail before looking at component code?
- [ ] Are page title, tabs, CTA, composer, and feed aligned by one system?
- [ ] Does opening detail/comments preserve a continuous surface?
- [ ] Are gutters intentional and proportionate?
- [ ] Are floating layers bounded to the source surface?
- [ ] Does the narrow-window state preserve the same semantic hierarchy?
