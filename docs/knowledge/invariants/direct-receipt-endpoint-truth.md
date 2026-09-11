---
kind: invariant
title: Direct receipts use committed endpoint truth
status: active
owns:
  - apps/station/app/subserver/conversation/application/interaction/
  - apps/station/app/subserver/conversation/infrastructure/delivery/
  - apps/station/app/subserver/conversation/production_http.go
  - apps/desktop/src-tauri/src/messaging/
referenced-by: []
related:
  - docs/architecture/messaging-platform/design.md
  - docs/architecture/messaging-platform/decisions.md
detected: 2026-09-11
---

# Direct Receipts Use Committed Endpoint Truth

## What must hold

Direct delivery receipt validation and aggregation MUST use the immutable
authority delivery commitments and exact persisted receipts for the event.
It MUST NOT require Direct endpoints to exist in
`conversation_member_devices`, which is the committed Group/MLS leaf
projection.

Group receipt aggregation MUST continue to require its committed member-device
rows. A missing Group leaf is an integrity failure and must roll back the
receipt transaction.

## Why this is non-negotiable

MP-D17 selects current Direct endpoints from the Actor Directory at send time.
A device activated after Direct genesis can therefore own a valid ciphertext,
queue item, and authority delivery commitment without appearing in the
genesis-era Conversation device projection.

Requiring that current Direct endpoint in `conversation_member_devices` rolls
back an otherwise exact consumption receipt. The Desktop durable outbox then
retries the same oldest receipt forever, starving later receipts and preventing
the sender from observing `DELIVERED`.

For Direct endpoints whose current revoke state cannot be proven from
authority-local truth, the aggregate remains outstanding. Missing Group state
must never be interpreted as Direct revocation or delivery.

## How to verify

- `go test ./subserver/conversation/infrastructure/delivery -run 'TestReceiptRecorder(UsesDirectCommitmentsOutsideGroupDeviceProjection|RollsBackWhenAggregateValidationFails)' -count=1` from `apps/station/app` must pass.
- `go test ./subserver/conversation/...` from `apps/station/app` must pass.
- `chat-native-current-profile-two-client-e2e` must show exact receiver
  plaintext and sender-visible `delivered` in both directions.

## Crosswalks

- `MP-A07`, `MP-A09`, `MP-A13`, and `MP-D17` in
  `docs/architecture/messaging-platform/`.
- Feature `tooling/acceptance/features/chat-direct-delivered-receipt.yaml`.
