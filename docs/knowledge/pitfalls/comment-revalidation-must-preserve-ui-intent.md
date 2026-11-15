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
  - apps/desktop/src/acceptance/moments/feedObservation.ts
  - apps/desktop/src/acceptance/moments/commentReadFault.ts
  - tooling/development/secure_content/social_feed_ui.py
  - tooling/acceptance/gates/social/public_comment_revalidation.py
referenced-by:
  - tooling/acceptance/features/social-public-signed-feed.yaml
  - tooling/acceptance/features/social-private-moments-desktop.yaml
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
  src/components/moments/MomentCommentsSection.test.tsx \
  src/acceptance/moments/feedObservation.test.ts \
  src/acceptance/moments/commentReadFault.test.ts
```

The cases retain DOM/entity identities during reads, preserve drafts and
selection, close across aliases/remounts, fence late create/delete/like reads,
retain pagination outside an authoritative head and consume focus once.

Native verification must observe unchanged and acquired-empty reads, collapse
then reconciliation, new row arrival and return to an alive page. Source/DOM
unit results alone do not establish Native product proof.
Wait for the initial read to finish before recording the empty or populated
baseline. Pause scroll and visibility checks only during the inactive interval;
on return, compare against the original scroll position and require at least
two returned Native frames. An `alive` option must not exempt the subsequent
reconciles from those checks.

The original private AS20 uses `social_feed_ui.py` on both retained clients.
Its reaction trace and feed reconciliation trace are separate; the private
consumer validates every required phase and immutable capture. The public
Suite uses `public_comment_revalidation.py` to hold one actual verified
`socialGetComments` response before real create/delete/LIKE controls publish,
then continuously observes the confirmed UI while releasing that response.
The control expires within 30 seconds, rejects scope changes, and is cleared
at the end of each attempt. It supplies no synthetic rows or success.

Run `python3 -m unittest tooling.development.secure_content.test_social_feed_ui
tooling.acceptance.gates.social.test_public_feed_native
tooling.acceptance.gates.social.test_desktop_private_e2e`. Removed/reinserted
nodes, transient restored text/counts, lost selection/focus and missing
Native phases must fail. Execute `social-public-feed-native-e2e` and
`social-private-desktop-e2e` through the shared Runner for actual product proof.
