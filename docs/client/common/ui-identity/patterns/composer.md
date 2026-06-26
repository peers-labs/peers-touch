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
