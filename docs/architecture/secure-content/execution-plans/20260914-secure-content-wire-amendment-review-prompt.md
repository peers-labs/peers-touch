# Secure Content W1 Wire Amendment - Review Prompt

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-14 | **Updated**: 2026-09-14
> **Owner**: Architecture Team

---

You are an independent security-protocol and distributed-systems reviewer.
Review the proposed `SC-D14` amendment that closes the W1 generated-contract
boundary.

## Upstream Product Sources

- `docs/architecture/social/product-definition.md`
- `docs/architecture/social/experience-contract.md`
- `docs/architecture/social/product-state-model.md`
- `docs/architecture/social/acceptance-matrix.md`

## Architecture Sources

- `docs/architecture/secure-content/decisions.md`, especially `SC-D14`
- `docs/architecture/secure-content/data-model.md`, sections 5-7 and 12-13
- `docs/architecture/secure-content/security.md`
- `docs/architecture/secure-content/integration.md`

## Review Questions

1. Does the video contract keep every private field encrypted while giving
   Native clients enough typed information to select and decrypt a variant?
2. Is the non-recursive rendered repost snapshot sufficient for deterministic
   rendering without permitting recursive decode or changing Social authority?
3. Does signed mention routing bind actor, encrypted-payload mention,
   authorization snapshot, resource, sender device, and signing key without
   exposing private text or offsets?
4. Are prepare, submit, point-read, comment-list, vote, and recovery responses
   complete, viewer-scoped, bounded, and exact-replay safe?
5. Can Go protobuf, prost, and protobuf-es generate and validate the proposed
   shapes without separate manually maintained contracts?
6. Do any fields leak recipient topology, private body content, object keys, or
   unrelated envelopes to Station or another viewer?
7. Does the amendment preserve `SC-A01..SC-A08` and `SC-D01..SC-D13` without
   introducing a new route, authority, persistence owner, or compatibility
   path?

## Required Output

```text
Overall: PASS | NEEDS_CHANGES

Findings:
- [severity] source:line - issue, consequence, required correction

Invariant checks:
- metadata minimization: PASS | FAIL
- bounded decoding: PASS | FAIL
- exact replay and command binding: PASS | FAIL
- viewer-scoped projection: PASS | FAIL
- cross-language proto-first generation: PASS | FAIL
- ownership and transaction boundary: PASS | FAIL

Decision:
- SC-D14 may be accepted: YES | NO
```

Do not review execution sequencing or implementation style. Reject any
suggestion that moves plaintext, content keys, audience authority, or outer
transaction ownership into the shared Secure Content kernel or Station.
