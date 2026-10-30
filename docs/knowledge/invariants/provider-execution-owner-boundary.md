---
kind: invariant
title: Provider execution preserves resource and actor ownership
status: active
owns:
  - apps/station/app/subserver/agent/service/provider_authority.go
  - apps/station/app/subserver/agent/service/provider_management_service.go
  - apps/station/app/subserver/agent/service/provider_service.go
  - apps/station/app/subserver/agent/service/provider_secret.go
  - apps/station/app/subserver/agent/service/credential_config_service.go
  - apps/station/app/subserver/agent/service/runtime_admission_service.go
  - apps/station/app/subserver/agent/service/cli/
  - apps/station/app/subserver/agent/handler/provider_handler.go
  - apps/station/app/subserver/dashboard/handler_ai.go
  - apps/station/app/subserver/dashboard/web/src/api/client.ts
  - apps/station/app/subserver/dashboard/web/src/hooks/useControlPlaneAction.ts
  - apps/desktop/src/store/provider.ts
  - model/domain/agent/provider.proto
  - tooling/docker/compose.yml
referenced-by: []
related:
  - docs/architecture/domains/agent/provider-control-plane.md
  - docs/architecture/domains/agent/provider-managed-cli-install.md
detected: 2026-10-30
owner: Agent domain
review-cadence: annual
next-review: 2027-10-30
---

# Provider execution preserves resource and actor ownership

## What must hold

Apply the accepted [control-plane contract](../../architecture/domains/agent/provider-control-plane.md)
and [managed CLI contract](../../architecture/domains/agent/provider-managed-cli-install.md)
whenever changing Provider lookup, dispatch, discovery or management. Resource
ownership MUST remain separate from the requesting actor. Denied shared identity
MUST NOT fall back to a personal same-named Provider; storage UUIDs MUST NOT
bypass the effective owner. Each subsequent dispatch MUST revalidate current
model and grant authority, including tool continuations.

Shared credentials MUST remain owner-bound encrypted envelopes and write-only
in management projections. Actor JWTs MUST NOT authorize shared mutations or
installation. Late asynchronous completions MUST NOT publish or mutate state
for a different actor or administrator session.

The installer MUST own shared binaries independently of invocation state.
Machine PATH and managed binaries MUST use the same private environment.
Availability checks MUST resolve structured catalog argv through the same
managed PATH as execution; formatted display commands are not executable names.
Installation success MUST NOT be interpreted as authentication or task success.
The runtime host MUST satisfy the managed CLI contract's orphan-reaping
boundary. Process-group cancellation alone does not reap descendants; the
Station container requires its standard init process.

## Why this is non-negotiable

Resource IDs alone cannot distinguish shared configuration from an actor's
private same-named resource. Cached admission alone also cannot revoke a grant.
Mixing these identities creates owner bypasses and permits stale continuations.

Sharing an installed executable does not authorize sharing the Station account's
HOME, login files, caches or credentials. A separate binary lookup in the UI
handler can incorrectly reject a managed executable even while dispatch finds it.
Keep lookup and installation facts in the Agent owner.

## How to verify

- Run affected service tests from `apps/station/app`:
  `go test ./subserver/agent/service -run 'Test(ProviderControlPlane|ProviderManagement|QuickCompletion|RuntimeDefaultCAS)'`.
- Run `go test ./subserver/agent/handler -run 'TestProvider(Management|Consumer)'`.
- Run `go test ./subserver/agent/service/cli/...` for environment, process
  cancellation, structured argv, activation rollback and archive boundaries.
- On the reviewed Station container, verify init is enabled and cancelled
  owned process groups leave neither running descendants nor zombies.
- Run `go test ./subserver/dashboard -run TestAIControlPlane` for live
  administrator, Actor JWT, role and revoked-session denial.
- Verify a real current-source journey: configure and grant a shared model,
  call as its allowed actor, revoke, and observe the next dispatch rejected.
  Exercise real installation and actor HOME separation separately. Unit tests
  and version probes alone do not prove these product outcomes.
