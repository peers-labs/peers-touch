---
kind: invariant
title: Default ordering is time or neutral relevance, never engagement
status: active
owns:
  - packages/ui/web/src/moment-card.tsx
  - packages/ui/web/src/feed-sort-float.tsx
  - packages/prototypes/shared/ui-system/moments/
  - packages/prototypes/shared/ui-system/chat/
  - packages/prototypes/shared/ui-system/search/
  - packages/prototypes/mobile/chat/src/app/
  - tooling/scripts/ui-system/suites/north-star.suite.json
related:
  - docs/architecture/platform/client/ui-system/prototype/north-star-frame.md
  - docs/architecture/platform/client/ui-system/prototype/components/moments-feature.md
detected: 2026-11-05
owner: Client Platform / UI System
review-cadence: on-change
---

# Default ordering is time or neutral relevance, never engagement

## What must hold

Every voice is equal in the **default order**. Likes, reactions, views, reply
counts, and other engagement signals are *expression*, not *ranking signals*.
The product must not, by default, promote a person or piece of content because
it got more engagement — “no one is more important”.

### Default order

- Conversations and content streams are ordered by time (`created_at` DESC,
  newest-first).
- Search is ordered by **neutral relevance to the query**, with time as the
  tie-break.
- Person-granular lists — contacts, conversations, members, notifications —
  must not introduce a “frequent contacts / high engagement” weighted entry.
  They stay in time or neutral order.

### Reader choice is not platform weighting

An explicitly labelled, **unselected-by-default reader view** (e.g. the feed
“最新 / 热门” segmented control, default “最新”) is allowed. It changes only
that reader's personal view when they choose it; the platform never
pre-selects hot and never implies hot is better.

### Conversation layer is stricter

Comment/reply areas have time order only — there is no “most liked” or any
engagement ordering control. Nested replies stay attached to their root and
follow the root's time position.

### Expression is not removed

Equality governs **ordering**, not the reactions themselves. Like/reaction
counts stay visible as expression; they simply never reorder anything.

### Scope

Applies to every entry that ranks people or content by engagement: feeds,
comments, contacts “frequent”, hot-based conversation pinning, hot search
ordering, recommendation slots, and notification ordering. Any new
list/search feature must declare whether its default order is time or neutral
relevance, or review rejects it.

## Why this is non-negotiable

Ranking by engagement silently assigns importance to voices and creates
incentive/performativity dynamics that contradict a decentralized
neighborhood network. The prototype briefly shipped a “最新/最早/最多赞”
comment sort and a feed whose “热门” could become a default-weighted view;
both were removed/converted under the communicative-equality first-class
principle (north-star frame grammar #9). Reintroducing an engagement-sorted
**default** is a violation even if the control looks innocuous.

## How to verify

```sh
node tooling/scripts/ui-system/evaluate-specimens.mjs \
  --suite tooling/scripts/ui-system/suites/north-star.suite.json
```

- `moments-comment-pagination`: `no-comment-sort-control` and
  `no-most-liked-option` prove the comment area exposes no engagement sort.
- `moments-feed`: `feed-default-time-order` proves the stream opens in time
  order; the sort control is a detached floating chip, not a card row.
- `moments-feed-order-view`: switching to hot is an explicit reader action
  and returns to time order; hot is never the initial state.

## Crosswalks

- Governing principle: north-star frame
  `docs/architecture/platform/client/ui-system/prototype/north-star-frame.md`
  Frame Grammar 原则 9「交流平权」.
- Moments landing:
  `docs/architecture/platform/client/ui-system/prototype/components/moments-feature.md`.
