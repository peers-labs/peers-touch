---
kind: pitfall
title: Message publishing identity must not be a rotating credential
status: active
owns:
  - apps/station/app/subserver/conversation/application/publishing/
  - apps/station/app/subserver/conversation/infrastructure/persistence/publishing_store.go
  - model/domain/chat/publishing.proto
referenced-by: []
related:
  - ../../architecture/domains/chat/messaging/message-publishing.md
detected: 2026-10-14
---

# Message Publishing Identity Must Not Be A Rotating Credential

## Symptom

An ingress implementation can duplicate an already committed message after a
credential rotation or retention-window expiry, and message IDs derived only
from caller request IDs can collide across publishers.

## Root Cause

Credential paths and short-lived request buckets were used as publishing
identity. They did not persist the normalized request hash, sender, target, and
committed result under one stable delegation identity.

## Mitigation

- Idempotency identity is `(publishing_id, command_id)`.
- Credential rotation changes only authentication material.
- The first receipt freezes normalized request hash, sender, target, message,
  event, and sequence in the Conversation transaction.
- Replay authenticates the live grant, compares the exact request hash, and
  authorizes the frozen target.
- Internal command and message IDs include `publishing_id`.

## How To Detect A Recurrence

```bash
rg -n 'publishing_id|command_id|message_publication_receipts' \
  apps/station/app/subserver/conversation \
  apps/station/app/subserver/bot
```

The command must show the stable publishing identity on receipt and
message-identity paths.

Focused tests must cover credential rotation, changed default targets,
same-command conflicting content, and two publishers using the same command ID.
