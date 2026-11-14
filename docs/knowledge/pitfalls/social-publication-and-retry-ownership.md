---
kind: pitfall
title: Social publication and retry need their original owner
status: active
owns:
  - apps/desktop/src/store/relationships.ts
  - apps/desktop/src/store/relationships.test.ts
  - apps/desktop/src/store/privateMoments.ts
  - apps/desktop/src/components/moments/MomentCard.tsx
  - apps/desktop/src/components/moments/surfaces/SocialActionBar.tsx
  - apps/desktop/src/components/moments/surfaces/SocialActionBar.test.tsx
referenced-by: []
related:
  - docs/client/desktop/runtime-projections.md
  - docs/client/common/ui-identity/modules/social/desktop.md
detected: 2026-11-14
owner: desktop-social
review-cadence: on-change
next-review: 2027-11-14
---

# Social publication and retry need their original owner

## Symptom

PR185 RUI-01: a delayed status response removed a newer confirmed blocked-list
entry before the block command completed. An empty complete list could also be
undone by a delayed status with a revision not previously retained.

RUI-02: the reaction adapter offered retry for terminal rejection, which Native
refuses, but offered none for retained pending unknown outcomes or retry failures.

## Root Cause

Independent publishers compared against different revision baselines. Complete
list absence has no edge revision, and its page maximum cannot supply one.
The UI also inferred command admission from a status label instead of consuming
the original command owner's exact identity, deadline and live-flight state.

## Mitigation

- `relationships.ts` arbitrates status, command and complete-list publication
  in one owner. Per-target decisions retain removal floors; complete-list
  publication fences earlier status requests even for unseen higher revisions.
  A conflicting delayed command also revalidates after that list boundary.
  Unchanged status reads do not starve the concurrently acquired complete list.
- `privateMoments.ts` owns recovery eligibility, exact ID, backoff and live flights.
  One Store timer updates availability at the next eligible deadline. Scope
  reset cancels that wake-up; the UI has no policy timer.
- Exact retry callers share completion. Direct retry cannot dispatch over a
  live original submission. Terminal rejection remains terminal; transport
  failure retains the durable identity. Ballots and other reaction kinds do not
  acquire the affected post reaction's admission.

## How To Detect A Recurrence

From `apps/desktop`:

```sh
pnpm exec vitest run src/store/relationships.test.ts src/components/moments/surfaces/SocialActionBar.test.tsx src/components/moments/momentsInteraction.contract.test.ts src/test/moments-store.test.ts
pnpm exec tsc --noEmit -p tsconfig.json
```

Require list-before-command block/unblock ordering, unseen higher status after
complete-list removal, stale-list rejection, and overlapping unchanged status
reconciliation. Adapter regressions must use the real private Store and Native
normalizer, assert painted expiry without user action or another read, exact ID
forwarding, live-flight duplicate prevention, retained failure, terminal rejection
and ballot exclusion. Scope status-node assertions to the reaction owner,
excluding shared controls' pending spinners and unrelated live regions.

These are source regressions, not Native product proof or whole-PR merge approval.

## Crosswalks

- Desktop runtime projections define Store and Runtime ownership.
- Desktop Social UI Identity defines per-kind pending and recovery presentation.
- `renderer-generation-churn-must-not-teardown-native-actor.md` preserves the
  distinct renderer and Native activation lifetimes.
