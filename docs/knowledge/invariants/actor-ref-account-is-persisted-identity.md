---
kind: invariant
title: ActorRef acct comes only from the persisted federated handle
status: active
owns:
  - apps/station/frame/core/plugin/native/federation/locator/
  - apps/station/frame/touch/actor/
  - apps/station/frame/touch/actor_handler.go
  - apps/station/frame/touch/auth/
  - apps/station/frame/touch/federation_api_handler.go
  - apps/station/frame/touch/oauth_handler.go
  - apps/station/frame/touch/session/
  - apps/station/frame/touch/accessgate/
  - apps/station/app/subserver/oauth/
  - apps/station/app/subserver/social/
  - apps/desktop/src-tauri/src/secure_content/
referenced-by: []
related:
  - docs/architecture/domains/identity/unified-actor-system.md
  - docs/architecture/shared/federation/decisions.md
detected: 2026-09-21
---

# ActorRef acct comes only from the persisted federated handle

## What must hold

`ActorRef.ptid` remains the actor identity. `ActorRef.acct` MUST be the
canonical `user@host` projection of `db.Actor.FederatedHandle`. Request URLs,
`Host` headers, reverse proxies, forwarded headers, loopback tunnels, and
runtime transport endpoints MUST NOT create or alter that handle projection.
Consumers MAY use `acct` as a profile-resolution hint, but MUST verify the
resolved profile's PTID against `ActorRef.ptid`.

Private-content read responses MUST project `metadata.author` from the
already-verified durable commit proof author. They MUST NOT reconstruct a
second `ActorRef` from scalar `author_ptid` columns, because that drops the
canonical `acct` and makes the metadata/proof identity binding diverge.

## Why this is non-negotiable

Transport addresses describe how one request reached Station; they do not
identify the Actor's Home Station. Deriving `acct` from a request host makes the
same persisted Actor acquire different identities through direct, proxied, and
SSH-tunneled paths.

Secure Content uses the sender's `ActorRef.acct` to resolve the signed
Home-Station profile. A tunnel-derived handle therefore resolves the wrong
profile and causes valid private content to fail with
`PRIVATE_CONTENT_VERIFICATION_FAILED`.

## How to verify

- `rg -n 'ProtoActorRef\\([^)]*,' apps/station --glob '*.go'` returns no hits.
- `rg -n 'acctFromBaseURL' apps/station` returns no hits.
- `cd apps/station/frame && go test ./core/plugin/native/federation/locator/... ./touch ./touch/actor/... ./touch/auth/...`
  passes the canonical handle, self-view, credential, and ActorRef projection tests.
- `cd apps/station/app && go test ./subserver/social/application/...` proves
  private Moment and Comment read metadata preserve the exact proof author.
- `apps/desktop/src-tauri/src/secure_content/adapter.rs` rejects a resolved
  profile whose PTID differs from the sender.
- The W7 Desktop receiver Journey reaches `CONTENT_READY` through the reviewed
  SSH transport.

## Crosswalks

- `docs/architecture/domains/identity/unified-actor-system.md` defines `ActorRef` as
  the only cross-process identity carrier.
- `docs/architecture/shared/federation/decisions.md` D-09 requires federation identity
  to reuse `ActorRef` and persisted federated-handle semantics.
