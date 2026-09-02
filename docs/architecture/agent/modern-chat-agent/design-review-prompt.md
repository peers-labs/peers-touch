# Modern Chat Agent V2 — Independent DESIGN Review Prompt

> **Status**: review-complete
> **Created**: 2026-08-17
> **Updated**: 2026-08-22
> **Owner**: Peers-Touch Agent Team
> **Prior review result**: `MCA-D19A DESIGN_AMENDMENT_ACCEPTED` by Owner on 2026-08-22
> **Prior review result**: `MCA-D19B DESIGN_AMENDMENT_ACCEPTED` by Owner on 2026-08-22
> **Review result**: `MCA-D19C DESIGN_AMENDMENT_ACCEPTED` by Owner on 2026-08-22

---

You are the independent architecture reviewer for the Modern Chat Agent V2
Station-authorized external-idempotency restart takeover amendment.

Review DESIGN only. Do not implement, create execution tasks, commit, push, or
weaken accepted product requirements.

## Accepted Product Inputs

- `product-definition.md`
- `benchmark-disposition.md`
- `experience-contract.md`
- `product-state-model.md`
- `acceptance-matrix.md`
- `prototype/README.md`
- PRODUCT verdict: `PRODUCT_READY_FOR_ARCHITECTURE`

## Architecture Sources

- `lobehub-v2-reference-analysis.md`
- `design.md`
- `decisions.md` (accepted D19/D19A/D19B)
- `data-model.md` (especially §2.11, §2.14, and §8.9)
- `module-layout.md`
- `integration.md` (especially §3, §9.1, A07/A09/A12-A14, and C07/C09)
- `../execution-plans/20260817-modern-chat-agent-v2-execution.md` (F4 only,
  as evidence of the execution blocker rather than architecture truth)

## Review Dimensions

1. Station alone converts a committed decision into an executable request.
2. The targeted envelope binds decision revision, claim, lease, fence,
   dispatch sequence, payload hash, both deadlines, capability session, and
   device.
3. Rust persists `PREPARED` before side effects and handles duplicate delivery
   without a second execution.
4. Non-idempotent ambiguity becomes `UNKNOWN_SIDE_EFFECT`, never replay.
5. Each ToolCall accepts one immutable `result_id`; the final successful member
   of a provider-response ToolBatch atomically creates one batch continuation.
6. Web `toolRuntime` owns projection and decision intent only; it cannot claim,
   execute, or continue a ToolCall.
7. Actor/device/session/lease revision/fence/decision revision/payload/
   execution-deadline mismatch rejects before side effects.
8. Delivery, acknowledgement, retry, disconnect, takeover, cancellation,
   expiry, restart, and result replay semantics are complete.
9. Proto-first contracts do not expose local paths and do not rely on
   handwritten JSON authority.
10. Old Web, Rust waiter, Station broker, and client-only diagnostic paths have
    explicit deletion conditions.
11. Restart recovery cannot blindly replay an ambiguously emitted
    non-idempotent provider continuation.
12. `execution_deadline` permits side-effect admission while
    `reconciliation_deadline` permits terminal settlement only.
13. The recovery credential is persisted, single-purpose, scope-bound, and
    unusable without the bound actor-device Ed25519 signature.
14. Nonce consumption and terminal-result CAS allow identical acknowledgement
    replay but reject a conflicting terminal digest.
15. Capability lease renew/revoke is revision-fenced and cannot mutate
    capability-set or signing-key identity.
    Registration cannot accept client-selected actor, lease/session identity,
    revision, or expiry.
16. Replay policy and external idempotency key are Station-resolved and cannot
    be upgraded by Desktop.
17. Raw local paths/native handles remain only in the encrypted Desktop
    actor/device resource-ref registry.
18. A valid late APPLIED receipt records the side-effect fact without reopening
    a cancelled/expired Turn or blocked ToolBatch.
19. Envelope payload hash and recovery scope hash use the specified two-stage
    deterministic construction with no self-reference or cross-language drift.
20. Actor JWT authenticates actor only; `X-Device-ID`, lease ID, and session ID
    never authenticate a device.
21. Register, renew, revoke, pull, and active receipt each verify a canonical
    actor-device Ed25519 command proof before authority-state access.
22. Command nonce/digest replay returns the same durable write outcome for an
    identical command and rejects a changed command/body.
23. Generic command proof cannot replace the narrower D19A recovery proof.
24. Device-key revoke races reject before lease, pull, outbox, or result
    mutation.
25. Active receipt and terminal recovery use distinct endpoints/proof modes and
    cannot downgrade into each other.
26. Lease, execution, reconciliation, and proof-skew bounds are Station-owned
    and explicit.
27. Cutover revokes unsigned leases and settles historical PREPARED work
    without synthesizing recovery authority.
28. Terminal recovery remains usable after actor JWT/session revoke by loading
    identity solely from credential scope and verifying the current device key.
29. A process restart restores execution authority only through a Station CAS
    takeover and a newly fenced envelope under a current matching lease.
30. Takeover preserves ToolCall/decision/claim, immutable arguments, original
    execution deadline, and the exact external idempotency key while reissuing
    request/lease/fence/outbox/hash/recovery authority.
31. Old recovery authority is invalidated atomically with takeover; old-fence
    receipts cannot win the terminal result CAS.
32. Resource-bearing takeover fails closed until a separately accepted
    cross-session resource-rebind contract exists.

## Blocking Conditions

Return `changes required` if:

- The executable envelope can be fabricated or initiated by Web.
- Station dispatch is not atomically tied to its decision and claim.
- A duplicate envelope or result can execute or continue twice.
- Rust can perform a side effect before durable `PREPARED`.
- A stale/mismatched envelope can reach the local executor.
- A local path enters a portable contract or Station business truth.
- Replay or duplicate delivery can cause a second decision/execution/result.
- A target deletion lacks an explicit replacement owner.
- A proposed decision is treated as accepted without review.
- Recovery proof can enter PREPARED, start/repeat a side effect, renew a lease,
  pull work, or create a continuation.
- A late terminal receipt can settle without matching pre-deadline PREPARED,
  valid signature/nonce/scope, and live reconciliation deadline.
- Capability-session revoke destroys already-PREPARED settlement evidence, or
  device trust-key revoke fails to invalidate recovery.
- An identical signed-receipt retry cannot recover its original
  acknowledgement after nonce consumption.
- The client can claim replay safety or choose a different external
  idempotency key.
- Any normal capability path treats JWT/header/session/lease identifiers as
  device proof without verifying the actor-device signature.
- Body hashing includes the proof recursively or differs across Go/Rust.
- A nonce can be reused with a different command ID or body digest.
- Desktop can execute from a persisted PREPARED row, old lease, or recovery
  credential without a new Station-issued fence under a current lease.
- Takeover changes the external idempotency key, extends the original execution
  deadline, permits old-fence settlement, or bypasses the existing claim/result
  uniqueness rules.
- Resource-bearing takeover proceeds before cross-session resource rebind is
  explicitly designed and accepted.

## Required Output

1. Verdict: `passed`, `conditionally passed`, or `changes required`.
2. Blocking findings with exact file/line references.
3. Non-blocking findings.
4. Missing failure semantics, forbidden relationships, or evidence Gates.
5. Explicit result: `DESIGN_AMENDMENT_ACCEPTED` or
   `DESIGN_AMENDMENT_REQUIRED`.

The Owner explicitly accepted D19A, D19B, and D19C on 2026-08-22. These
verdicts authorize the corresponding Goal G1 execution only; they do not prove
G1-C or any Product Gate.
