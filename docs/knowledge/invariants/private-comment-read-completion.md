---
kind: invariant
title: Private Comment reads complete within their active scope
status: active
owns:
  - apps/desktop/src/store/privateComments.ts
  - apps/desktop/src/store/privateComments.test.ts
referenced-by: []
related:
  - docs/client/desktop/runtime-projections.md
detected: 2026-10-25
---

# Private Comment reads complete within their active scope

## What must hold

The original private Comment Store MUST own completion of its asynchronous
reads. An equivalent in-flight read MUST NOT resolve before the shared Native
read and projection publication complete. A different refresh, cursor or
historical anchor MUST NOT be silently dropped because the thread is loading.

A superseded read MUST NOT publish a page or error or release a newer read.
Actor activation, renderer teardown, Native session replacement, post removal,
and unavailable-parent transitions invalidate the corresponding in-flight
read. Late callbacks MUST NOT recreate cleared private content. An unchanged
or older Native bootstrap generation MUST NOT cancel the current read.

## Why this is non-negotiable

Runtime reconciliation and detail opening both await `loadComments`. Returning
early from a loading branch exposes an empty or stale projection as a completed
read. Caller polling would leave every other caller with the same defect.

Read ownership is an in-memory Store concern. It does not grant read authority,
copy private plaintext outside Secure Content storage, or replace Native
authorization. The Native adapter remains responsible for current original
read policy and page identity validation.

## How to verify

Run the owning package's tests:

```bash
pnpm --dir apps/desktop exec vitest run \
  src/store/privateComments.test.ts src/runtimes/momentsRuntime.test.ts
```

The controlled pending-Native cases must prove shared completion and errors,
independent retry, refresh during pagination, historical anchor replacement,
subscriber reentrancy, scope and post invalidation, terminal parent state, and
unchanged versus replaced Native session generations.

Run the existing `social-content-search-desktop-native-e2e` Journey against
the current native source. Its original recipient acquisition, historical
comment opening and return checks remain product evidence; source tests alone
do not establish a native PASS or uniquely attribute a prior native failure.

## Crosswalks

- [Desktop projection owner](../../client/desktop/runtime-projections.md)
- [Social Search feature](../../../tooling/acceptance/features/social-content-search.yaml)
