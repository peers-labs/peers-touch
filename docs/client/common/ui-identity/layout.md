# UI Identity Layout

> Status: Canonical layout contract for client UI identity.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-06-18.

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
