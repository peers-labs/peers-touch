# Secure Content Recovery And Social Durability Amendment - Review Prompt

> **Status**: complete
> **Version**: v1.0
> **Created**: 2026-09-14 | **Updated**: 2026-09-14
> **Owner**: Architecture Team

---

Review proposed `SC-D16` and `SC-D17` in:

- `docs/architecture/shared/security/secure-content/decisions.md`
- `docs/architecture/shared/security/secure-content/security.md`
- `docs/architecture/shared/security/secure-content/data-model.md`
- `docs/architecture/shared/security/secure-content/design.md`
- `docs/architecture/shared/security/secure-content/integration.md`
- `docs/architecture/shared/security/secure-content/execution-plans/20260913-secure-content-hard-cut/plan.md`

## Context

W3 is complete. Pre-execution inventories for W5 and W6 exposed two missing
contracts:

1. the actor recovery master has no byte-exact per-key X25519 derivation;
2. Social requires durable prepare plans, claimed-slot mappings and exact submit
   receipts, while private submit currently collides with the existing public
   request type on the same route.

## Review Questions

1. Does `SC-D16` define one unambiguous cross-language HKDF transcript,
   including domains, length encoding, integer encoding, validation bounds,
   BIP39 normalization/checksum handling, X25519 handling and fixed vectors?
2. Can the derived private key always reproduce the public recovery PreKey
   without server-held private material or a whole-archive root-key catalog?
3. Do the `SC-D17` plan, slot and receipt identities support exact prepare
   replay across a crash after irreversible Key Exchange claim, including a
   persisted canonical claim request and exact claim response?
4. Does the submit transaction have enough durable state to prove exact replay
   and all-or-none Post/Comment, snapshot, envelope, delivery, object, grant,
   proof and receipt writes?
5. Are the proposed private-submit routes unambiguous while preserving the
   existing public request contracts?
6. Does moving W5 after W6 remove the persistence dependency cycle without
   weakening the W5 recovery Journey?
7. Do any proposed fields expose stable wrapping keys, plaintext, private
   metadata, or another recipient's envelope?
8. Are replay, conflict, expiry, cancellation, retry, revocation, and
   crash-recovery semantics complete enough for W5/W6 implementation?
9. Does submit revalidate endpoint activity/profile, recovery epoch and FRIENDS
   revision without transferring Social ownership to Actor Identity or Key
   Exchange?

## Required Output

```text
Verdict: PASS | HOLD

Findings:
- severity
- exact source reference
- violated invariant or missing semantic
- required correction

Decision checks:
- SC-D16: PASS | HOLD
- SC-D17: PASS | HOLD
- W6 -> W5 dependency correction: PASS | HOLD
```

A `PASS` means both decisions are internally consistent and sufficient to
resume W6 followed by W5. It does not approve implementation or claim product
or Acceptance proof.

## Outcome

- Independent review: `PASS`
- Owner acceptance: 2026-09-14
- Execution order unlocked: W6, then W5
