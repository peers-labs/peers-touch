---
kind: invariant
title: Private Comment reads complete within their active scope
status: active
owns:
  - apps/desktop/src/store/privateComments.ts
  - apps/desktop/src/store/privateComments.test.ts
  - apps/mobile/src/runtimes/privateMomentsRuntime.ts
  - apps/mobile/src/runtimes/privateMomentsRuntime.test.ts
referenced-by: []
related:
  - docs/client/desktop/runtime-projections.md
  - docs/architecture/platform/client/mobile/social-parity/data-model.md
detected: 2026-10-25
---

# Private Comment reads complete within their active scope

## What must hold

The original private Comment Store or Mobile Runtime MUST own completion of its asynchronous
reads. An equivalent in-flight read MUST NOT resolve before the shared Native
read and projection publication complete. A different refresh, cursor or
historical anchor MUST NOT be silently dropped because the thread is loading.

A superseded read MUST NOT publish a page or error or release a newer read.
Actor activation, renderer teardown, Native session replacement, post removal,
and unavailable-parent transitions invalidate the corresponding in-flight
read. Late callbacks MUST NOT recreate cleared private content. An unchanged
or older Native bootstrap generation MUST NOT cancel the current read.

Desktop thread acquisition MUST complete even when an authorized page is empty
or identical to retained data. Row and cursor equality cannot retain a pending
`loading` flag, an unacquired `loaded` flag or an earlier error. Whole-thread
reuse requires an already acquired, settled, healthy thread. A completion that
changes only lifecycle state retains the existing unchanged comment array and
rows; an unchanged healthy background refresh retains the whole thread.

Content generation and reaction revision are independent lanes. Replacement
pages and snapshots retain the newer lane of each current comment. A reaction
completion updates only the currently retained target; it cannot overwrite a
newer body or recreate a removed comment. Reactivating the same Actor with equal
renderer and Native-session values still invalidates old completions.
Mobile reads validate ownership before Native dispatch and after synchronous
publication subscribers run. A subscriber can fence or supersede the read;
the caller must then receive a stale-completion refusal, never cleared content
or an undefined comment. Deferred reaction dispatch rechecks scope and access.

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
pnpm --dir apps/mobile exec vitest run \
  src/runtimes/privateMomentsRuntime.test.ts src/services/gateways/momentsGateway.test.ts
```

The controlled pending-Native cases must prove shared completion and errors,
independent retry, refresh during pagination, historical anchor replacement,
subscriber reentrancy, scope and post invalidation, terminal parent state, and
unchanged versus replaced Native session generations.
Desktop cases also require first-read empty completion, empty retry after failure,
unchanged viewport reacquisition and stable references during healthy empty and
nonempty background refreshes.

The reaction cases must also prove refresh/bootstrap lane merging, delayed
reaction versus body edit, target removal, and same-value scope reactivation.
Use generated protobuf summaries and enums in tests so a copied numeric kind
cannot mask a client/protocol mismatch.

Run the existing `social-content-search-desktop-native-e2e` Journey against
the current native source. Its original recipient acquisition, historical
comment opening and return checks remain product evidence; source tests alone
do not establish a native PASS or uniquely attribute a prior native failure.

## Crosswalks

- [Desktop projection owner](../../client/desktop/runtime-projections.md)
- [Social Search feature](../../../tooling/acceptance/features/social-content-search.yaml)
