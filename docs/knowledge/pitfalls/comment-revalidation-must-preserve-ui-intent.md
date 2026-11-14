---
kind: pitfall
title: Comment revalidation must preserve UI intent
status: active
owns:
  - apps/desktop/src/store/moments.ts
  - apps/desktop/src/store/momentsNavigation.ts
  - apps/desktop/src/components/moments/
  - apps/desktop/src/pages/moments/
  - packages/ui/web/src/moment-card.tsx
  - packages/ui/web/src/moment-comments.tsx
  - packages/ui/web/src/moments.css
referenced-by: []
related:
  - docs/client/common/ui-identity/interaction.md
  - docs/client/common/ui-identity/modules/social/desktop.md
detected: 2026-11-14
owner: Client Platform / Social
review-cadence: on-change
---

# Comment revalidation must preserve UI intent

## Symptom

An acquired empty comment panel disappeared and reappeared during periodic
reads. A collapsed panel could reopen when a different feed alias won and
remounted the card. A read started before a confirmed comment operation could
erase the new comment, restore a deletion or roll back its confirmed reaction.

## Root cause

The renderer interpreted every in-flight read as initial acquisition.
Card-local expansion state was keyed by transport post ID, while the timeline
deduplicated by logical public resource. Confirmed mutations did not supersede
already-started reads. Target focus was repeated whenever row count changed.

## Mitigation

- Acquisition readiness is independent of loading; an acquired empty snapshot
  retains the same empty presentation through revalidation.
- The existing Moments navigation Store owns expansion by logical identity,
  and its existing Runtime scope reset clears choices. Stable card/draft keys
  use that identity. A collapsed acquired thread stays mounted without
  viewport read interest.
- Public pages reuse unchanged entities and arrays. The acquired head range
  is tracked separately from cursor-acquired rows; full authoritative reads
  can still remove absent data. Confirmed mutations invalidate older reads.
- Focus is scoped to the active thread and consumed once per explicit intent.
  Shared comment-row arrival markers retire, including while hidden.

The governing UI rule is in `interaction.md`; this entry records the failure
mechanism and detection, not a second UI contract.

## How to detect a recurrence

Run in `apps/desktop`:

```sh
pnpm exec vitest run src/test/moments-store.test.ts \
  src/components/moments/CommentList.test.tsx \
  src/components/moments/MomentCard.test.tsx \
  src/components/moments/MomentCommentsSection.test.tsx
```

The cases retain DOM/entity identities during reads, preserve drafts and
selection, close across aliases/remounts, fence late create/delete/like reads,
retain pagination outside an authoritative head and consume focus once.

Native verification must observe unchanged and acquired-empty reads, collapse
then reconciliation, new row arrival and return to an alive page. Source/DOM
unit results alone do not establish Native product proof.
