---
kind: pitfall
title: Ordinary conversation events must join the authority hash chain
status: active
owns:
  - apps/station/app/subserver/conversation/service_impl.go
  - apps/station/app/subserver/conversation/service_test.go
  - apps/desktop/src-tauri/src/interface/tauri_commands/mls.rs
referenced-by: []
related:
  - ../../architecture/federated-im/design.md
  - ../../architecture/federated-im/decisions.md
detected: 2026-08-02
---

# Ordinary conversation events must join the authority hash chain

## Symptom

An MLS message encrypted and decrypted correctly, but both Desktop recipient
ledgers entered `crypto_desynced` at the message event because Station emitted
an empty `event_hash`.

## Root cause

Membership transitions were committed transactionally with
`prev_event_hash`/`event_hash`, while ordinary message, edit, reaction, and
settings events used a separate non-transactional append path without hashes.

## Mitigation

### What was done in code

- Ordinary commands now lock the conversation and commit through the existing
  unit of work.
- The next sequence, previous authority hash, deterministic event hash, and
  event append are one transaction.
- Envelope broadcast occurs only after commit.

### What guards against regression

- `TestSubmitCommand_SendMessage` requires 32-byte current and previous hashes.
- Desktop continues to fail closed on a missing or malformed authority hash.

## How to detect a recurrence

```bash
go test ./apps/station/app/subserver/conversation
```

```sql
SELECT conversation_id, group_seq
FROM conversation_events
WHERE octet_length(event_hash) <> 32;
```

New events must never appear in this query.

## Crosswalks

- D-13/D-14 in `docs/architecture/federated-im/decisions.md`.
