---
kind: pitfall
title: Feed projections must preserve signed authored timestamps
status: active
owns:
  - apps/station/app/subserver/social/infrastructure/feed_interaction_projector.go
  - apps/station/app/subserver/social/infrastructure/feed_interaction_projector_test.go
  - apps/station/app/subserver/social/infrastructure/feed_log_projector.go
  - apps/station/app/subserver/social/infrastructure/feed_log_integrity_test.go
  - apps/station/app/subserver/social/infrastructure/feed_log_store.go
  - apps/station/app/subserver/social/infrastructure/feed_thread_store.go
  - apps/station/app/subserver/social/infrastructure/feed_interaction_worker.go
  - apps/station/app/subserver/social/application/feed_thread.go
  - apps/station/app/subserver/social/application/feed_log_service_test.go
  - apps/desktop/src/services/publicFeedProjection.ts
referenced-by: []
related:
  - ../../architecture/domains/social/federation/actor-feed-log.md
detected: 2026-11-08
---

# Feed projections must preserve signed authored timestamps

A valid public post can become `FEED_PROJECTION_TAMPERED` after a reaction
because the Native consumer compares the entire authored body, including time.
GORM `Update` changes `updated_at` automatically when projecting a derived
reaction count. That timestamp then differs from the author's signed event.
GORM struct `Updates` also replaces an explicitly selected `updated_at` with
the database operation time when its Model is a different empty struct.
An author's valid edit therefore fails the same full-body binding.

The interaction projector uses `UpdateColumn` for derived counts and the post
projector uses `UpdateColumns` for signed edits. Creation/update/edit time comes
from the corresponding signed event. Keep the Native comparison strict;
discarding the timestamp would conceal an unauthorized body mutation.

## Transaction-wide lock ordering

The same projection owner also had a PostgreSQL lock cycle that per-receipt
parent locking could not prevent. A batch retained author A's thread head
after reacting to P, then waited for Q; a concurrent receipt held Q and
waited for A. Batches with disjoint parents can likewise acquire different
authors' thread heads in opposite orders.

The governing lock order and missing-parent snapshot contract live in
[Actor Feed Log §6.0](../../architecture/domains/social/federation/actor-feed-log.md#60-v1-冻结合同).
Append, thread import, direct delivery and worker projection must consume that
transaction-wide set, not reacquire a parent during a later receipt. The
snapshot is transaction-local derived state, not another durable Store.

## How to detect a recurrence

Verify set and remove through the original projector and compare the preserved
creation/update/edit timestamps as well as the changed count:

```sh
go -C apps/station/app test ./subserver/social/infrastructure \
  -run 'TestFeedInteractionCountsPreserveSignedParentTimestamps|TestFeedPostProjectionPreservesSignedTimeAndBlocksResurrection' -count=1
```

The Native public Suite additionally checks that the receiving author continues
to render the signed post after a non-follower's comment and reaction, then
checks author/receiver binding after a signed edit and receiver restart.

Check the actual append/import write boundaries, sorted multi-author heads,
late-parent deferral and same-batch authored updates:

```sh
go -C apps/station/app test ./subserver/social/infrastructure ./subserver/social/application \
  -run 'TestFeedAppendLocksWholeBatchBeforeReceiptAndThread|TestFeedInteractionBatchKeepsAbsentParentSnapshot|TestFeedAppendNewParentStaysDeferredThroughRepeatedAuthoredUpdates|TestFeedThreadImportLocksAllParentsBeforeReceipt|TestFeedInteractionBatchConcurrentSinglePostgres' -count=1
```

The isolated PostgreSQL regression uses `openPrivateContentStorePostgres` and
skips without `MESSAGING_TEST_POSTGRES_DSN`. SQLite boundary tests establish
lock-set sequencing, not PostgreSQL deadlock freedom or Native runtime proof.
