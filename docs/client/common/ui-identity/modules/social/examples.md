# Social UI Identity Validation Examples

> Status: Validation cases for Social UI Identity.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-06-18.

## 1. Purpose

This document validates the UI Identity methodology with Social capabilities that are not yet fully complete.

The goal is to prove that UI ID can guide staged implementation, not only final polished screens.

## 2. Raw Case From Current E2E

Observed Desktop Social surface:

- Large blank gutter between app shell and content rail.
- `New Post` uses a visually isolated black button beside quiet tabs.
- Root post, comment area, and reply composer look like separate assembled cards.
- Reaction and comment actions look like unrelated small buttons.
- Federation metadata exists, but the hierarchy is not disciplined.

Defect names:

- Detached content rail.
- CTA token mismatch.
- Thread surface discontinuity.
- Action-row fragmentation.
- Mixed component-library defaults.

Underlying user intent:

- Read a Social post.
- Understand source/audience/reason.
- React or comment.
- Continue in the same social thread without losing context.

Artifact decision:

- This is not a local visual patch.
- It affects Social feed/detail/comment surfaces and can recur across modules.
- Therefore, it creates a common UI Identity contract, a Social module contract, and shared feed/composer/trust patterns.

## 3. Methodology Validation Matrix

| Case | Capability maturity | What UI ID must prove | Expected behavior |
| --- | --- | --- | --- |
| Publish text post | Implemented | Composer state ownership | Empty disabled, pending localized, failure preserves draft, success clears draft |
| Reaction | Implemented but gateway/runtime can fail | Action group state ownership | Picker anchored, affected group disabled while pending, count rollback on failure |
| Comments | Partially complete | Thread continuity | Root post, comments, and reply composer form one thread surface |
| Station moderation | Policy source implemented, aggregate notice incomplete | Trust-state honesty | No fabricated block UI; pending/unavailable state is explicit only when invoked |
| Follow relationship | May be incomplete for remote actors | Relationship reason clarity | Feed reason remains visible; unavailable action explains missing capability |
| Search | May be local/partial | Empty vs unavailable distinction | "No results" differs from "remote search unavailable" |
| Circles | Product surface exists before mature graph | Purposeful empty state | Empty state explains circles and next valid action |
| Long station domain | Always possible | Metadata hierarchy | Domain truncates or wraps without dominating content |
| Narrow window | Always possible | Layout contract | Content rail remains coherent; no orphan gutter |

## 4. UI State Fixtures

Use these fixtures for manual or automated visual review.

### Feed

- One local public post.
- One remote public post.
- One post with long author name.
- One post with long station domain.
- One post with many reactions.
- One post with comments collapsed.
- One post with comments expanded.

### Composer

- Empty draft.
- Valid text draft.
- Upload pending.
- Audience selector open.
- Publish pending.
- Publish failure with draft preserved.

### Thread

- Detail with zero comments.
- Detail with one comment.
- Detail with nested reply target.
- Reply composer empty.
- Reply composer pending.
- Reply failure with text preserved.

### Trust And Moderation

- Normal station source.
- Remote station source.
- Station policy command pending.
- Station moderation projection unavailable.
- Actor block unavailable.
- Hidden-by-policy state when backend projection exists.

## 5. Acceptance Evidence

For every Social UI refactor, collect:

- Screenshot of Home feed.
- Screenshot of Public feed.
- Screenshot of detail thread with comments.
- Screenshot of composer empty/typing/pending.
- Screenshot or trace of reaction pending/success.
- Screenshot or trace of comment pending/failure.
- Screenshot of long station domain.
- Screenshot of narrow desktop window.
- Notes explaining which incomplete capabilities are represented as unavailable, pending, or absent.

## 6. Failure Criteria

Reject the UI if:

- It needs red annotation boxes to explain its boundaries.
- The primary CTA looks like it belongs to another design system.
- Comment thread looks detached from the post.
- Federation metadata overpowers Human content.
- Incomplete backend capability appears as broken UI.
- Moderation/block state is inferred locally instead of sourced from Station.
- The same action has different button styles in feed and detail.

## 7. AI Agent Checklist

- [ ] Did I classify incomplete capability as absent, pending, unavailable, degraded, or implemented?
- [ ] Did I preserve user input during incomplete/failure states?
- [ ] Did I avoid fake station moderation projection?
- [ ] Did I verify Social against common UI Identity and Social Desktop refinement?
- [ ] Did I record which screenshots or manual checks were used as evidence?
