---
kind: pitfall
title: Station subserver map order can erase federation identity
status: active
owns:
  - apps/station/frame/core/server/server_base.go
  - apps/station/frame/core/plugin/native/subserver/bootstrap/
  - apps/station/app/subserver/conversation/
referenced-by: []
related:
  - ../../station/subserver-standard.md
  - ../../architecture/federation/design.md
detected: 2026-08-02
---

# Station subserver map order can erase federation identity

## Symptom

New group conversations committed with an empty `authority_station_peer_id`.
Their local MLS authority events and Welcomes were then written to
`envelope_outbox` as if the local Station were remote, and federation delivery
failed.

## Root cause

`BaseServer` initialized subservers directly from a Go map. Conversation and
Envelope could therefore snapshot federation identity before bootstrap created
and published the Station bootstrap host.

## Mitigation

### What was done in code

- `BaseServer` initializes `bootstrap` first.
- Remaining subservers initialize in sorted name order.
- Bootstrap remains the only owner that publishes federation Station identity.

### What guards against regression

- `TestOrderedSubserverNamesInitializesBootstrapFirst` verifies the ordering.
- Group creation must persist a non-empty `authority_station_peer_id`.

## How to detect a recurrence

```bash
go test ./apps/station/frame/core/server
```

```sql
SELECT conversation_id
FROM conversations
WHERE kind = 2 AND authority_station_peer_id = '';
```

The SQL query must return no newly created groups.

## Crosswalks

- `docs/station/subserver-standard.md` defines the initialization invariant.
