---
kind: pitfall
title: Remote Comment authors require complete resource delivery for recovery
status: active
owns:
  - apps/station/app/subserver/social/application/federated_private_interaction.go
  - apps/station/app/subserver/social/application/federated_private_resource.go
  - apps/station/app/subserver/social/application/private_comment_service.go
  - apps/station/app/subserver/social/infrastructure/federated_private_resource_store.go
  - apps/station/app/subserver/social/infrastructure/private_read_policy.go
  - apps/station/app/subserver/social/infrastructure/federated_private_interaction_store.go
referenced-by: []
related:
  - ../../architecture/domains/social/cross-station/design.md
  - ../invariants/actor-ref-account-is-persisted-identity.md
detected: 2026-11-13
---

# Remote Comment Authors Require Complete Resource Delivery

## Symptom and cause

The original federated Comment fixture reproduced replacement-device root and
reply Not Found, failed pagination, zero parent comments and unavailable read
policy. The interaction-result importer constructed the author's resource
projection from a response containing only the submitting endpoint envelope.
The source's complete resource fanout excluded that remote author. Consequently
the author's recovery envelope was never persisted at its Home Station.

Remote Comment reads also rejected absent current endpoint envelopes even when
an authorized actor recovery envelope was already retained for other viewers.

## Required boundary

The original source resource outbox delivers complete viewer-scoped envelopes
to remote Comment authors and recipients. Interaction results validate the
bound command and proof-key trust; they do not persist a second resource
projection or emit its committed wake. Resource delivery owns those operations,
regardless of result ordering or duplicate transport.

Comment point reads, pages, parent counts, reaction admission and policy prefer exactly one current
endpoint envelope and otherwise require exactly one actor recovery envelope.
Ambiguous endpoint envelopes cannot fall through to recovery. The application
verifies the retained signing envelope, exact proof author and payload binding
and returns no fabricated endpoint. Native uses the original recovery history
to obtain the actor envelope and decrypt locally.

After account restoration, an old Post still requires its own original Native
recovery action. Recovering another Post does not recover all interaction
parents. Parent denial, blocks, device revocation and resource invalidation
continue to control reads; retained delivery bytes are immutable.

## How to detect a recurrence

Run from `apps/station/app`:

```bash
go test ./subserver/social/application ./subserver/social/infrastructure
```

`TestFederatedPrivateCommentReplacementReadsRootAndReply` must retain root/reply
metadata, ciphertext, exact proof author, count two and recovery-history entries.
Its replacement-device LIKE and UNLIKE commands must enter the original outbox
and retain that replacement device as the command/result binding.
`TestFederatedPrivateCommentResultAndResourceDeliveryOrder` must admit both
transport orderings and duplicate delivery without constructing a partial
projection from a result alone.
`TestFederatedPrivateCommentRecoveryRejectsMissingAmbiguousAndTamperedEnvelopes`
must reject missing, ambiguous, wrong-actor, wrong-resource, wrong-payload,
wrong-sender and invalid-signature recovery at both point and page reads.

The original Native cross-Station AS23 must restore the fresh replacement,
recover the original interaction parents, then keep every existing painted
Comment and poll readback assertion. Source tests do not establish Native PASS.
