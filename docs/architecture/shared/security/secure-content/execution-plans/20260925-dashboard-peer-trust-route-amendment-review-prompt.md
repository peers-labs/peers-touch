# Dashboard Peer Trust Route Amendment Review

> **Status**: conditionally passed
> **Version**: v1.0
> **Created**: 2026-09-25 | **Updated**: 2026-09-25
> **Owner**: Architecture Team

---

## 1. Review Scope

Review the W12A scope correction across:

- `docs/architecture/shared/object-storage.md`
- `docs/architecture/shared/security/secure-content/execution-plans/20260913-secure-content-hard-cut/tasks/W12A.md`
- `apps/station/app/subserver/dashboard/domain/dto.go`
- `apps/station/app/subserver/dashboard/handler.go`

## 2. Evidence

- The fiveArm Dashboard lists four with the obsolete unpinned signing key.
- `DELETE /dashboard/api/oss/federation/peers/:id` returns HTTP 400 before
  `handleOSSFederationForgetPeer` executes.
- `server.NewTypedHandler` rejects route parameters absent from the typed
  request, while the peer pin, unpin, and forget handlers use
  `domain.EmptyRequest`.

## 3. Required Findings-First Review

Return `passed`, `conditionally passed`, or `changes required`, with concrete
file and line findings. Verify:

1. The correction remains inside the accepted Dashboard operator contract.
2. Peer Station IDs bind through a typed request field before the handler runs.
3. Pin, unpin, and forget use one request contract and preserve audit behavior.
4. The regression check exercises the HTTP route binding, not only the service.
5. W12A re-freezes and reactivates both profiles before W7 and W8 replay.
6. No raw database mutation or compatibility route is introduced.

## 4. Claim Boundary

This amendment only corrects W12A source and check ownership. It does not
establish implementation completion, `FUNCTIONAL_PASS`, or formal Acceptance.

## 5. Review Result

The Plan correction is mechanically complete and preserves the accepted
Dashboard operator boundary. Final passage is conditional on the W12A source
change binding all three peer trust routes through one typed request and
proving the DELETE route through the HTTP adapter before profile activation.
