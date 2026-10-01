# SC-D29 Audience Contract Amendment Review

> **Status**: passed
> **Version**: v1.0
> **Created**: 2026-09-24 | **Updated**: 2026-09-24
> **Owner**: Architecture Team

---

## 1. Review Scope

Review the W8 amendment across:

- `docs/architecture/social/product-definition.md`
- `docs/architecture/social/experience-contract.md`
- `docs/architecture/social/product-state-model.md`
- `docs/architecture/social/acceptance-matrix.md`
- `docs/architecture/secure-content/design.md`
- `docs/architecture/secure-content/decisions.md`
- `docs/architecture/secure-content/data-model.md`
- `docs/architecture/secure-content/integration.md`
- `docs/architecture/secure-content/execution-plans/20260913-secure-content-hard-cut/plan.md`
- `docs/architecture/secure-content/execution-plans/20260913-secure-content-hard-cut/tasks/W12A.md`
- `docs/architecture/secure-content/execution-plans/20260913-secure-content-hard-cut/tasks/W8.md`

## 2. Evidence

- W8 failure:
  `secure-content/W8/4bb2552fb9de8e46a43d56209474bb6a7cfff35a/audience/w8-audience-4bb2552fb9de-61699/result.json`
- Canonical Conversation identity:
  `model/domain/chat/conversation.proto`,
  `apps/station/app/subserver/conversation/domain/valueobject/value_objects.go`
- Conflicting Social target:
  `model/domain/social/post.proto`
- Missing PUBLIC recipient authority:
  `apps/station/app/subserver/social/infrastructure/private_content_authority.go`
- Missing W8 remote fixture:
  `tooling/development/secure_content/runtime_owner.py::_run_w8_scenario`

## 3. Required Findings-First Review

Return `passed`, `conditionally passed`, or `changes required`, with concrete
file/line findings. Verify:

1. The product contract honestly narrows v1 `CUSTOM_DENY` to `FOLLOWERS`
   without weakening the explicit PUBLIC content path.
2. The typed `circle_id` / `group_conversation_id` target has one canonical
   wire meaning and no compatibility alias.
3. Conversation remains the sole Group membership authority; its prepare and
   owner-held submit fence define same-RDS, read-only, callback-lifetime, and
   lock-order semantics without exposing persistence to Social.
4. Same-Station GROUP success plus membership epoch and authority head are
   frozen and revalidated inside the Social commit fence.
5. `CUSTOM_DENY(FOLLOWERS)` succeeds, while `CUSTOM_DENY(PUBLIC)`, a remote
   Group member, or an explicit remote recipient rejects the whole private
   publish before Content PreKey claim; evidence verifies zero claims.
6. Actor Identity locality validation covers every non-SELF recipient source.
   Its fixture provisioner owns the real remote identity, while the runtime
   owner only attaches the opaque, digest-bound handle.
7. W12A pre-freeze checks cover Conversation/Social, generated Go/Rust/
   Desktop/Mobile parity, and removal of the retired target contract. Prior
   W7/W8 evidence is replayed after fresh two-profile activation.
8. No product claim implies cross-Station private sharing support.

## 4. Claim Boundary

This amendment may establish accepted product, architecture, and plan
contracts. It does not establish implementation completion, `FUNCTIONAL_PASS`,
or formal Acceptance.

## 5. Review Result

The initial product and architecture reviews required explicit scenario
coverage, zero-PreKey proof, complete locality ownership, transaction-fence
semantics, fixture ownership, and named pre-freeze checks. Those findings were
incorporated. Final independent re-review returned `PASS` with no blockers on
2026-09-24.
