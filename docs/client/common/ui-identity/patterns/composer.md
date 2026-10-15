# Composer Pattern

> Status: Shared UI pattern for composition surfaces.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-06-18.

## 1. Purpose

The composer pattern defines how users create text, posts, replies, prompts, messages, and future activity objects.

It applies to Social Moment composer, comment reply composer, Chat input, Agent prompt input, and Applet activity input.

## 2. Composer Promise

A composer must answer:

- What am I creating?
- Who or what will receive/see it?
- What state is required before submission?
- What is pending?
- What happens if submission fails?

## 3. Anatomy

```text
Composer surface
  -> Input area
  -> Attachment/context slots
  -> Audience/target selector
  -> Validation/recovery line
  -> Action row
```

## 4. State Ownership

Composer state belongs to the whole composer surface.

Rules:

- Empty, dirty, valid, invalid, uploading, pending, failed, and submitted states are composer-level states.
- Child controls may show local status, but cannot contradict the parent composer state.
- Submit action must explain disabled state when the user has already expressed intent.

## 5. Visual Rules

- Composer should look like an action surface, not a generic form card.
- Input and controls should feel like one semantic unit.
- Attachment previews must not break the composer boundary.
- Publish/send button must align with the composer action row.
- Audience/target must be visible enough to prevent mistakes.

### 5.1 Grounded chat composer (Desktop and Mobile)

The conversation composer is one grounded gray writing dock with a closed,
symmetric boundary — never a floating white card, never a flat full-width color
slab, and never a surface glued to one window edge:

- A white chrome bar spans the full column width flush to the window bottom,
  separated from messages by one 1px hairline; zero elevation shadow.
- The writing surface itself is soft-gray (`bgMuted`), fully rounded (12px)
  with a 1px hairline border on every edge, inset from the bar by an **equal
  frame on all four sides**: 4px compact / 6px regular (a hair-thin gap, never
  a card-width margin). Top, right, bottom, and left insets must be identical
  within 1px — an open or glued edge breaks the boundary.
- Empty and single-line drafts occupy one row: tools, transparent borderless
  textarea, and Send are aligned inside the dock. The input grows only as the
  draft gains lines, up to its bounded maximum, then scrolls internally.
  The actual textarea and its border must be measured; checking only the
  surrounding dock misses component-library form styles.
- Text and tools live inside the one dock; focus is expressed by a
  brand-tinted border plus a soft outer ring, not by lifting the surface.
- Transient tool drawers are mutually exclusive and return focus ownership to
  the composer. Outside focus/pointer, Escape, source context change,
  and app-window blur dismiss them without clearing the draft or accepted
  attachment context.
- Desktop's explicit expand/collapse changes the surface immediately (reserve a multi-line
  min-height), so the control has visible effect even with an empty draft.
- Geometry is verified, not eyeballed: the four frame insets, full-radius
  border, single-line content box, and expand/collapse heights are covered by
  the rect-level gate (see review-checklist §13).

## 6. Recovery Rules

- Text input must survive submission failure.
- Attachments must preserve success/failure status.
- Audience/target selection must survive failure.
- Retry should be local to the composer.
- Sensitive submissions must not show false success before server acknowledgement.

## 7. Incomplete Capability Rules

- If media upload is unavailable, the attachment slot should be absent or explicitly unavailable.
- If audience selection is incomplete, show the currently enforced audience and do not offer fake choices.
- If a target cannot be resolved, block submit and show contextual recovery.

## 8. AI Agent Checklist

- [ ] Does the composer state belong to the parent surface?
- [ ] Is submit disabled state explainable?
- [ ] Does failure preserve draft, attachments, and audience/target?
- [ ] Does the action row align with the input surface?
- [ ] Are unavailable capabilities explicit instead of broken?
