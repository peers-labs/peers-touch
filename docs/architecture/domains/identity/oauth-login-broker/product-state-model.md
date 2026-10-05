# OAuth Login Broker - Product State Model

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-30 | **Updated**: 2026-10-01
> **Owner**: Identity and Access

---

## 1. Authorization Transaction

```text
created -> awaiting_callback -> exchanging -> consumed
              |                    |
              +-> expired          +-> failed
              +-> rejected
```

- `created`: state and verifier exist only inside the request.
- `awaiting_callback`: encrypted durable transaction and start audit committed.
- `exchanging`: transient process state; raw code is never durable.
- `consumed`: identity, credential, audit, and consumption marker share one
  repository commit.
- `expired`: callback arrived after `expires_at`; no provider exchange.
- `rejected`: state missing, provider mismatched, or already consumed.
- `failed`: provider exchange or durable completion failed.

A failed provider exchange does not consume the transaction. A successful
exchange followed by storage failure returns failure and requires a new login,
because the one-time authorization code is deliberately not persisted.

## 2. Provider Identity

```text
absent -> observed -> active
                    -> active(updated)
```

- `observed`: identity exists only in the provider response.
- `active`: durable identity record and matching credential commit succeeded.
- `active(updated)`: subsequent login updates profile fields, `last_login_at`,
  and `login_count`.

No cross-provider account merge is inferred.

## 3. Credential

```text
missing
  -> active
  -> expiring
  -> refreshable
  -> refresh_claimed
  -> active(rotated)
  -> refresh_uncertain -> reauthorization_required
  -> expired_non_refreshable
```

- Token values exist only in server memory and encrypted envelopes.
- `refreshable` requires a non-empty refresh token after decryption.
- Provider omission of a replacement refresh token retains the current one.
- `refresh_claimed` is durable and binds one operation ID to one credential
  generation before any provider call.
- A retry that observes an unresolved claim never calls the provider again.
- A provider success followed by a missing durable replacement is
  `refresh_uncertain`; recovery requires a new authorization because the
  provider may already have invalidated the old refresh token.
- Authentication or decryption failure never degrades to plaintext or an empty
  credential.

## 4. Record Encryption

```text
active_key -> envelope(active_key)
old_key -> envelope(old_key) -> read -> envelope(active_key)
unknown_key | authentication_failed -> unreadable
```

Normal reads report the encountered key ID without mutating append-only data.
The explicit maintenance command walks transactions, identities, credentials,
refresh-operation markers, and audits before key removal.

Every envelope authenticates its version, key ID, algorithm, update timestamp,
record kind, and repository path as AES-GCM associated data.

## 5. GitHub Commit

```text
read_head -> build_changes -> create_blobs -> create_tree
  -> create_commit -> compare_and_swap_ref -> committed
                                      |
                                      +-> conflict -> bounded retry
                                      +-> terminal_error
```

The callback has no partially committed domain state. All changed records enter
one tree and one commit before the branch reference moves.

## 6. Administration Surface

```text
unauthenticated -> challenged
authenticated -> loading -> ready
                         -> unavailable
```

- `challenged`: `401` with no storage access.
- `ready`: sanitized identities, credential metadata, and recent audit events.
- `unavailable`: generic server error; no secret or upstream response body is
  rendered.

All states are non-cacheable and non-indexable.

## 7. Native Desktop Handoff

```text
idle
  -> awaiting_provider
  -> broker_committed
  -> station_verifying
  -> station_candidate_ready
  -> local_credential_persisted
  -> station_activated
  -> local_session_active

awaiting_provider -> denied | expired
station_verifying -> rejected
station_candidate_ready -> local_persist_failed | cancelled | expired
local_credential_persisted -> acknowledgement_pending
acknowledgement_pending -> station_activated | cancelled | expired
```

- `idle` and `awaiting_provider` require no existing Desktop actor.
- `broker_committed` means provider identity and credential state are durable,
  but it does not imply a Station session.
- `station_candidate_ready` is an inactive, device-bound Station candidate
  whose encrypted credential remains recoverable until acknowledgement.
- `local_credential_persisted` is durable but not yet advertised as a completed
  login. Its acknowledgement binding and prior local snapshot are also durable.
- `acknowledgement_pending` retains the local credential while polling or
  process restart resolves Station truth. It cannot enter the authenticated
  shell until activation is confirmed.
- `station_activated` is authoritative only after acknowledgement or canonical
  readback proves activation.
- `local_session_active` is the first successful Desktop login state.
- Denied, expired, invalid-signature, bridge-unavailable, and local-persistence
  failures remain visible terminal failures and never create an active local
  OAuth connection.
- The renderer timeout equals the native loopback expiry and first requests
  cancellation. A concurrent activation winner is reported as completed.
- Station startup and periodic sweeps terminalize abandoned attempts without
  requiring request traffic.
