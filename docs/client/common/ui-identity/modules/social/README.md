# Social UI Identity

> Status: Canonical module UI identity for Human federated social.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-06-18.

## 1. Purpose

Social UI is the first validation module for Peers Touch UI Identity.

It must prove that the shared identity works under incomplete real product capability, not only under polished mock states.

Current scope:

- Human federated social activity.
- Feed, public feed, detail thread, composer, reaction, comments, search, circles, profile, follow, and moderation states.
- Agent, A2A, Applet social are future extension points and must not dominate current Human social UI.

## 2. Inherited Identity

Social inherits [Quiet Protocol Minimalism](../../README.md).

Social-specific interpretation:

- Quiet: a feed should feel readable for daily use.
- Protocol: station, audience, reason, and moderation are clear but compressed.
- Minimalism: content and relationship come before badges and panels.
- Human-first: author, text, media, comments, and reactions dominate the surface.
- Verifiable: when trust or policy affects interaction, the source of truth is visible.

## 3. Social Product Promise

Every Social surface should answer:

- Who authored this activity?
- Which station did it come from?
- Why can I see it?
- Who is the audience?
- What is my relationship with the author?
- What can I safely do next?

The UI should answer these questions without turning every post into a protocol inspection card.

## 4. Visual Model

Social uses a continuous activity stream.

Rules:

- Feed is a reading flow, not a dashboard grid.
- Detail plus comments is a thread surface, not a separate card stack.
- Composer is an action surface attached to the feed or thread context.
- Federation metadata appears as a quiet meta line by default.
- Trust or policy state expands only when it changes the user's decision.

## 5. Social Surface Hierarchy

Priority order:

1. Human content: author, body, media, comment text.
2. Social relation: time, reaction, comment, reply, follow context.
3. Federation context: station, audience, reason.
4. Trust/policy state: blocked, degraded, hidden, pending moderation.
5. Secondary actions: delete, report, block, copy link, inspect source.

Rules:

- Do not visually promote station metadata above author/content unless trust is degraded.
- Do not use strong color for routine protocol metadata.
- Destructive actions must be secondary until explicitly invoked.

## 6. Current Incomplete Capability As Validation

Social must validate UI Identity with incomplete capability because real product development is staged.

Use these incomplete capabilities as methodology tests:

| Capability | Current/possible state | UI Identity requirement |
| --- | --- | --- |
| Reaction | implemented but may have runtime/pending states | count, selected state, pending state, rollback are local to reaction group |
| Comment | partially implemented across list/detail paths | thread remains continuous; empty/pending/error states do not look like broken cards |
| Station moderation | policy source exists, aggregate notice incomplete | UI never fabricates block state; pending and unavailable states are explicit |
| Follow/profile relation | may be incomplete across remote actors | relationship reason remains clear; unavailable follow action is explained |
| Circles | UI exists before full social graph maturity | empty state explains purpose and next action |
| Search | may return partial/local data | empty, loading, remote unavailable, and permission states are distinct |

## 7. Required Social Documents

- [desktop.md](./desktop.md) — Desktop-specific Social surface constraints.
- [examples.md](./examples.md) — validation cases using current incomplete capabilities.
- [../../patterns/feed.md](../../patterns/feed.md) — shared feed pattern.
- [../../patterns/composer.md](../../patterns/composer.md) — shared composer pattern.
- [../../patterns/trust-state.md](../../patterns/trust-state.md) — shared trust-state pattern.

## 8. Covered UX Dimensions

This module contract covers:

- Task success for social reading and interaction.
- Visual continuity for feed/detail/thread.
- Information hierarchy for Human content and federation metadata.
- State ownership for social actions.
- Trust and safety for station/audience/moderation.
- Extreme data for long names, long station domains, media, and comments.

Out of scope:

- Backend protocol design.
- Station policy persistence.
- Agent/A2A/Applet social interaction beyond future extension points.
- Exact component implementation details.

## 9. AI Agent Checklist

- [ ] Does the surface answer the six Social product questions?
- [ ] Does Human content visually dominate protocol metadata?
- [ ] Are feed/detail/comment surfaces continuous?
- [ ] Are reaction/comment/follow states locally owned and recoverable?
- [ ] Is station moderation displayed only from authoritative data?
- [ ] Are incomplete capabilities explicit instead of visually broken?
